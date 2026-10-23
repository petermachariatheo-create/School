import { fileURLToPath } from "node:url";
import path from "node:path";

/**
 * Server configuration.
 *
 * Everything is overridable through the environment so that the same build
 * can run on a school laptop, in a container, or in CI without code changes.
 */

export interface ServerConfig {
  /** Interface to bind. `0.0.0.0` allows other devices on the LAN to connect. */
  readonly host: string;
  readonly port: number;
  /** Directory holding the database, backups and generated artefacts. */
  readonly dataDir: string;
  readonly databaseFile: string;
  readonly backupDir: string;
  /**
   * Directory holding the built client application.
   *
   * In the repository this is `packages/web/dist`. In an installed copy it is
   * wherever the installer put it, so the server has to be told rather than
   * assume a repository layout.
   */
  readonly webRoot: string;
  /**
   * `NORMAL` survives an application crash; `FULL` also survives a power
   * cut at the cost of one storage sync per commit.
   */
  readonly synchronous: "NORMAL" | "FULL";
  /** Maximum number of changes returned by a single sync pull. */
  readonly syncBatchSize: number;
  /** How long the client registry remembers an inactive client, in days. */
  readonly clientRetentionDays: number;
  /**
   * How often the background checkpointer copies the write-ahead log into the
   * database file, in milliseconds.
   */
  readonly checkpointIntervalMs: number;
  /**
   * How often the server re-decides the values that depend on the date, in
   * milliseconds.
   *
   * An invoice that falls due today is overdue today, and nothing about the
   * record changed, so the server has to go and look for it. Once a day is
   * enough for a school: a status that is a day late is still right.
   */
  readonly sweepIntervalMs: number;
  /**
   * TLS certificate and key, when the server should also serve HTTPS.
   *
   * A browser only allows a web application to work offline — and only
   * treats it as an installable app — when it is served from a secure
   * origin. On a school network that means the server needs a certificate
   * the devices trust. The certificate is optional: without it the server
   * serves HTTP only.
   *
   * Two forms are accepted: a `.pfx` bundle with a passphrase, which is
   * what Windows produces, or a certificate and key in PEM form.
   */
  readonly tls:
    | {
        readonly kind: "pfx";
        readonly certFile: string;
        readonly passphrase: string;
        readonly port: number;
      }
    | {
        readonly kind: "pem";
        readonly certFile: string;
        readonly keyFile: string;
        readonly port: number;
      }
    | null;
  /**
   * A certificate file to publish, so that another device can download it
   * and trust it. Without this step a phone shows a warning and cannot run
   * the application offline.
   */
  readonly publishedCertificate: string | null;
  /**
   * A file the server writes the port it ended up on to.
   *
   * The port is not known until the server is listening: when the one it
   * was given is already taken, it moves to the next one. A launcher has
   * to know where the server is, and a file that says so is quicker and
   * far more certain than looking for it.
   */
  readonly portFile: string | null;
  /** The same, for the encrypted listener. */
  readonly securePortFile: string | null;
}

const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url));

/**
 * The repository root.
 *
 * This file lives at `<repo>/packages/server/src/config.ts`, so the root is
 * three levels up: `src` -> `server` -> `packages` -> the repository.
 */
export const REPO_ROOT = path.resolve(SERVER_DIR, "..", "..", "..");

function readInt(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const raw = env[key];
  if (raw === undefined || raw === "") {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const dataDir = path.resolve(env["SCHOOL_DATA_DIR"] ?? path.join(REPO_ROOT, "data"));
  const synchronous = env["SCHOOL_SQLITE_SYNCHRONOUS"] === "FULL" ? "FULL" : "NORMAL";
  const webRoot = path.resolve(
    env["SCHOOL_WEB_ROOT"] ?? path.join(REPO_ROOT, "packages", "web", "dist"),
  );
  const pfxFile = env["SCHOOL_TLS_PFX"];
  const passphrase = env["SCHOOL_TLS_PASSPHRASE"] ?? "";
  const certFile = env["SCHOOL_TLS_CERT"];
  const keyFile = env["SCHOOL_TLS_KEY"];
  const tlsPort = readInt(env, "SCHOOL_TLS_PORT", 8443);

  let tls: ServerConfig["tls"] = null;
  if (pfxFile !== undefined && pfxFile !== "") {
    tls = { kind: "pfx", certFile: path.resolve(pfxFile), passphrase, port: tlsPort };
  } else if (certFile !== undefined && certFile !== "" && keyFile !== undefined && keyFile !== "") {
    tls = {
      kind: "pem",
      certFile: path.resolve(certFile),
      keyFile: path.resolve(keyFile),
      port: tlsPort,
    };
  }

  const published = env["SCHOOL_TLS_CERTIFICATE"];
  const portFile = env["SCHOOL_PORT_FILE"];
  const securePortFile = env["SCHOOL_SECURE_PORT_FILE"];

  return {
    host: env["SCHOOL_HOST"] ?? "0.0.0.0",
    port: readInt(env, "SCHOOL_PORT", 8080),
    dataDir,
    databaseFile: path.join(dataDir, "school.db"),
    backupDir: path.join(dataDir, "backups"),
    webRoot,
    synchronous,
    syncBatchSize: readInt(env, "SCHOOL_SYNC_BATCH_SIZE", 500),
    clientRetentionDays: readInt(env, "SCHOOL_CLIENT_RETENTION_DAYS", 30),
    checkpointIntervalMs: readInt(env, "SCHOOL_CHECKPOINT_INTERVAL_MS", 5_000),
    sweepIntervalMs: readInt(env, "SCHOOL_SWEEP_INTERVAL_MS", 86_400_000),
    tls,
    publishedCertificate:
      published === undefined || published === "" ? null : path.resolve(published),
    portFile: portFile === undefined || portFile === "" ? null : path.resolve(portFile),
    securePortFile:
      securePortFile === undefined || securePortFile === "" ? null : path.resolve(securePortFile),
  };
}
