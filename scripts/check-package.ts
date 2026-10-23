import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Package check.
 *
 * The installer is what a school actually runs, and it is not the same thing
 * as the repository: the server is bundled, the client is copied, the Node
 * runtime is shipped alongside, and the launcher starts all of it. A change
 * can pass every test in the repository and still be missing from the
 * package — a file that was not bundled, a path that only works in the
 * source tree, a setting the launcher does not pass on.
 *
 * That is not a hypothetical. The bundled server once referred to the
 * checkpoint worker by its source name, so the packaged copy silently lost
 * the background checkpointer and every write paused while the log was
 * copied. Nothing in the repository could have caught it.
 *
 * This script starts the packaged server the way the launcher starts it and
 * checks the things a user depends on: that it answers, that it says which
 * product it is, that it writes down its port, that it serves the client
 * application, that it can store a record, and that the background
 * checkpointer is running.
 *
 * It is separate from `npm run verify` because it needs the package to have
 * been built, and building the package needs a C# compiler. Run it with:
 *
 *   npm run build:windows && npm run check:package
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGE = path.join(ROOT, "dist", "windows", "payload");
const RUNTIME = path.join(PACKAGE, "runtime");

interface Failure {
  readonly where: string;
  readonly message: string;
}

const failures: Failure[] = [];
let passed = 0;

function check(where: string, condition: boolean, message: string): void {
  if (condition) {
    passed += 1;
    return;
  }
  failures.push({ where, message });
}

async function freePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

async function waitForServer(url: string, deadline: number): Promise<Response | null> {
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      if (response.ok) {
        return response;
      }
    } catch {
      // Not up yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return null;
}

// ---- the package has to be there ---------------------------------------------

check(
  "package",
  fs.existsSync(path.join(RUNTIME, "node.exe")),
  "the package does not contain the Node runtime; run `npm run build:windows`",
);
check(
  "package",
  fs.existsSync(path.join(RUNTIME, "server", "index.mjs")),
  "the package does not contain the server; run `npm run build:windows`",
);
check(
  "package",
  fs.existsSync(path.join(RUNTIME, "server", "checkpointer-worker.mjs")),
  "the package does not contain the checkpoint worker; the server will checkpoint inside a write",
);
check(
  "package",
  fs.existsSync(path.join(RUNTIME, "web", "index.html")),
  "the package does not contain the client application",
);
check(
  "package",
  fs.existsSync(path.join(PACKAGE, "payload-manifest.json")),
  "the package has no manifest; run `npm run build:windows`",
);

if (failures.length > 0) {
  report();
  process.exit(1);
}

// ---- start it the way the launcher starts it ----------------------------------

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "school-package-"));
const port = await freePort();
const portFile = path.join(dataDir, "server.port");
const logFile = path.join(dataDir, "server.log");

const child = spawn(path.join(RUNTIME, "node.exe"), [path.join(RUNTIME, "server", "index.mjs")], {
  env: {
    ...process.env,
    SCHOOL_HOST: "127.0.0.1",
    SCHOOL_PORT: String(port),
    SCHOOL_DATA_DIR: dataDir,
    SCHOOL_PORT_FILE: portFile,
    SCHOOL_WEB_ROOT: path.join(RUNTIME, "web"),
    SCHOOL_LOG_FILE: logFile,
  },
  stdio: ["ignore", "pipe", "pipe"],
});

const serverOutput: string[] = [];
child.stdout.on("data", (chunk: Buffer) => serverOutput.push(chunk.toString()));
child.stderr.on("data", (chunk: Buffer) => serverOutput.push(chunk.toString()));

function report(): void {
  for (const failure of failures) {
    process.stdout.write(`FAIL  ${failure.where}: ${failure.message}\n`);
  }
  process.stdout.write(`\nPackage check: ${passed} passed, ${failures.length} failed\n`);
}

try {
  const base = `http://127.0.0.1:${port}`;
  const health = await waitForServer(`${base}/api/v1/health`, Date.now() + 30_000);

  check("startup", health !== null, "the packaged server did not answer within 30 seconds");
  if (health !== null) {
    const body = (await health.json()) as { status?: string; product?: string };
    check("health", body.status === "ok", `the health answer was ${JSON.stringify(body)}`);
    check(
      "health",
      body.product === "school-manager",
      `the health answer did not identify the product: ${JSON.stringify(body)}`,
    );
  }

  // The launcher relies on this file to find the server.
  check(
    "port file",
    fs.existsSync(portFile),
    "the packaged server did not write down the port it is listening on",
  );
  if (fs.existsSync(portFile)) {
    const written = Number.parseInt(fs.readFileSync(portFile, "utf8").trim(), 10);
    check("port file", written === port, `the port file says ${written}, expected ${port}`);
  }

  // The client application has to be served by the same process.
  const shell = await fetch(`${base}/`).catch(() => null);
  check("client", shell !== null, "the packaged server did not serve the client application");
  if (shell !== null) {
    const html = await shell.text();
    check(
      "client",
      html.includes('<div id="root"'),
      "the client application shell is not the built one",
    );
  }

  const manifest = await fetch(`${base}/manifest.webmanifest`).catch(() => null);
  check(
    "client",
    manifest !== null && (manifest.headers.get("content-type") ?? "").includes("manifest"),
    "the web manifest was not served with the right content type",
  );

  // A record has to be able to be stored and read back.
  const created = await fetch(`${base}/api/v1/students`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      admissionNumber: "PKG-0001",
      firstName: "Package",
      lastName: "Check",
    }),
  });
  check(
    "api",
    created.status === 201,
    `creating a student answered ${created.status}, expected 201`,
  );
  if (created.status === 201) {
    const record = (await created.json()) as { id?: string };
    const read = await fetch(`${base}/api/v1/students/${record.id ?? ""}`);
    check("api", read.status === 200, `reading the student back answered ${read.status}`);
  }

  // The checkpointer has to be running: without it every write pauses while
  // the write-ahead log is copied into the database file.
  await new Promise((resolve) => setTimeout(resolve, 2_000));
  const log = fs.existsSync(logFile) ? fs.readFileSync(logFile, "utf8") : "";
  check(
    "checkpointer",
    !log.includes("the background checkpointer could not run"),
    "the background checkpointer did not start; see the server log for the reason",
  );
  check(
    "checkpointer",
    !log.includes("could not start"),
    "the background checkpointer did not start; the server log says so",
  );
} finally {
  child.kill();
  // Wait for the process to go, so that the files it had open are released
  // before the directory is removed.
  await new Promise<void>((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve();
      return;
    }
    const done = (): void => resolve();
    child.once("exit", done);
    setTimeout(done, 5_000).unref();
  });
  if (!child.killed) {
    child.kill("SIGKILL");
  }
  try {
    fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  } catch {
    // Windows may still hold the database file for a moment. The directory
    // is in the system's temporary folder, so leaving it behind is untidy
    // rather than a failure of the check.
  }
}

if (failures.length > 0) {
  process.stdout.write(serverOutput.join(""));
  report();
  process.exit(1);
}

report();
