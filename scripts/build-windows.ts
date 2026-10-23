import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

/**
 * Build the Windows installer.
 *
 * The result is a single file, `SchoolManager-Setup.exe`, that a user
 * downloads and runs. It contains:
 *
 *   - the server, bundled into one JavaScript file;
 *   - the Node runtime, so that nothing has to be installed separately;
 *   - the built client application;
 *   - a launcher that starts the server and opens the school in a browser.
 *
 * Nothing in the payload depends on the repository, a package manager, or a
 * toolchain: a school machine only needs Windows.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "dist", "windows");
const PAYLOAD = path.join(OUT, "payload");
const RUNTIME = path.join(PAYLOAD, "runtime");

const PRODUCT_NAME = "School Manager";
const FRAMEWORK = "C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319";

function run(command: string, args: string[], label: string, cwd: string = ROOT): void {
  process.stdout.write(`[windows] ${label}\n`);
  const result = spawnSync(command, args, { stdio: "inherit", cwd });
  if (result.error) {
    throw new Error(`${label} failed: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`${label} failed with exit code ${result.status}`);
  }
}

function copyTree(from: string, to: string): void {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const source = path.join(from, entry.name);
    const target = path.join(to, entry.name);
    if (entry.isDirectory()) {
      copyTree(source, target);
    } else {
      fs.copyFileSync(source, target);
    }
  }
}

function cscPath(): string {
  const configured = process.env["SCHOOL_CSC"];
  if (configured) {
    return configured;
  }
  const candidate = path.join(FRAMEWORK, "csc.exe");
  if (!fs.existsSync(candidate)) {
    throw new Error(
      "The C# compiler was not found. Install the .NET Framework 4 developer " +
        "pack, or set SCHOOL_CSC to the path of csc.exe.",
    );
  }
  return candidate;
}

/**
 * Bundle the server.
 *
 * Two files are produced, and both are needed. The second is the checkpoint
 * worker: the server starts it by path, so it has to exist next to the
 * server rather than inside the server's bundle. Leaving it out does not
 * stop the server, but it does put the write-ahead log back on the request
 * path, which is the thing that was deliberately moved off it.
 */
async function buildServer(): Promise<void> {
  process.stdout.write("[windows] bundling the server\n");
  const shared = {
    bundle: true,
    platform: "node" as const,
    format: "esm" as const,
    target: "node24",
    sourcemap: false,
    minify: false,
    legalComments: "none" as const,
    logLevel: "warning" as const,
  };
  const source = path.join(ROOT, "packages", "server", "src");

  await build({
    ...shared,
    entryPoints: [path.join(source, "index.ts")],
    outfile: path.join(RUNTIME, "server", "index.mjs"),
  });

  await build({
    ...shared,
    entryPoints: [path.join(source, "db", "checkpointer-worker.ts")],
    outfile: path.join(RUNTIME, "server", "checkpointer-worker.mjs"),
  });
}

function buildClient(): void {
  const dist = path.join(ROOT, "packages", "web", "dist");
  process.stdout.write("[windows] building the client\n");
  // The client is built in its own package: the Vite configuration and the
  // entry point both live there, and the build is run from that directory
  // so that the paths in it resolve the same way they do in development.
  run(
    process.execPath,
    [path.join(ROOT, "node_modules", "vite", "bin", "vite.js"), "build"],
    "building the client",
    path.join(ROOT, "packages", "web"),
  );
  if (!fs.existsSync(path.join(dist, "index.html"))) {
    throw new Error("the client build did not produce an index.html");
  }
  process.stdout.write("[windows] copying the client\n");
  copyTree(dist, path.join(RUNTIME, "web"));
}

function copyRuntime(): void {
  process.stdout.write("[windows] copying the Node runtime\n");
  fs.mkdirSync(RUNTIME, { recursive: true });
  fs.copyFileSync(process.execPath, path.join(RUNTIME, "node.exe"));
}

function compileLauncher(): void {
  process.stdout.write("[windows] compiling the launcher\n");
  run(
    cscPath(),
    [
      "/nologo",
      "/target:winexe",
      "/optimize+",
      "/platform:anycpu",
      `/out:${path.join(PAYLOAD, `${PRODUCT_NAME}.exe`)}`,
      "/reference:System.Windows.Forms.dll",
      "/reference:System.Drawing.dll",
      "/reference:System.IO.Compression.dll",
      "/reference:System.IO.Compression.FileSystem.dll",
      path.join(ROOT, "tools", "windows", "Launcher.cs"),
    ],
    "compiling the launcher",
  );
}

function compileInstaller(): void {
  process.stdout.write("[windows] compiling the installer\n");
  run(
    cscPath(),
    [
      "/nologo",
      "/target:winexe",
      "/optimize+",
      "/platform:anycpu",
      `/out:${path.join(OUT, "Setup.stub.exe")}`,
      "/reference:System.Windows.Forms.dll",
      "/reference:System.Drawing.dll",
      "/reference:System.IO.Compression.dll",
      "/reference:System.IO.Compression.FileSystem.dll",
      path.join(ROOT, "tools", "windows", "Installer.cs"),
    ],
    "compiling the installer",
  );
}

/**
 * Create the zip archive of the payload.
 *
 * The .NET zip writer is used rather than a hand-rolled one, because the
 * installer reads the archive with the .NET zip reader and the two agree on
 * the details that matter.
 */
function createArchive(): string {
  process.stdout.write("[windows] creating the archive\n");
  const archive = path.join(OUT, "payload.zip");
  if (fs.existsSync(archive)) {
    fs.rmSync(archive);
  }
  const script = [
    "Add-Type -AssemblyName System.IO.Compression.FileSystem;",
    `[System.IO.Compression.ZipFile]::CreateFromDirectory('${PAYLOAD.replace(/'/g, "''")}', '${archive.replace(/'/g, "''")}', [System.IO.Compression.CompressionLevel]::Optimal, $false);`,
  ].join(" ");
  execFileSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], {
    stdio: "inherit",
    cwd: ROOT,
  });
  return archive;
}

/**
 * Append the archive to the installer.
 *
 * The last eight bytes of the finished file hold the length of the archive,
 * so that the installer can find it without guessing.
 */
function appendArchive(archive: string): string {
  process.stdout.write("[windows] assembling the installer\n");
  const target = path.join(OUT, "SchoolManager-Setup.exe");
  fs.copyFileSync(path.join(OUT, "Setup.stub.exe"), target);

  const payload = fs.readFileSync(archive);
  const trailer = Buffer.alloc(8);
  trailer.writeBigInt64LE(BigInt(payload.length), 0);

  fs.appendFileSync(target, payload);
  fs.appendFileSync(target, trailer);

  const portable = path.join(OUT, "SchoolManager-portable.zip");
  fs.copyFileSync(archive, portable);

  return target;
}

function sizeOf(file: string): string {
  return `${(fs.statSync(file).size / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Write down what was built.
 *
 * The manifest answers the question that matters when something goes wrong
 * on a school machine: which build is installed? It lists every file with
 * its size and hash, so a copy can be matched against the build that made
 * it, and it records the Node version the package was assembled with.
 */
function writeManifest(): void {
  const files: { path: string; bytes: number; sha256: string }[] = [];
  const walk = (directory: string, prefix: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      const relative = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) {
        walk(full, relative);
        continue;
      }
      const content = fs.readFileSync(full);
      files.push({
        path: relative,
        bytes: content.length,
        sha256: createHash("sha256").update(content).digest("hex"),
      });
    }
  };
  walk(PAYLOAD, "");

  const manifest = {
    product: PRODUCT_NAME,
    version: JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version as string,
    builtAt: new Date().toISOString(),
    node: process.version,
    files: files.sort((a, b) => a.path.localeCompare(b.path)),
  };
  fs.writeFileSync(
    path.join(PAYLOAD, "payload-manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
}

async function main(): Promise<void> {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(PAYLOAD, { recursive: true });

  await buildServer();
  buildClient();
  copyRuntime();
  compileLauncher();
  compileInstaller();
  writeManifest();

  const archive = createArchive();
  const installer = appendArchive(archive);

  process.stdout.write("\n");
  process.stdout.write(`[windows] installer   ${installer} (${sizeOf(installer)})\n`);
  process.stdout.write(`[windows] portable    ${path.join(OUT, "SchoolManager-portable.zip")}\n`);
  process.stdout.write(
    "[windows] The installer contains the Node runtime, so the machine it is " +
      "installed on needs nothing else.\n",
  );
}

await main();
