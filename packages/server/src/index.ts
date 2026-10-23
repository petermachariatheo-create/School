import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import { loadConfig } from "./config.ts";
import { openDatabase, sqliteVersion } from "./db/database.ts";
import { Checkpointer } from "./db/checkpointer.ts";
import { migrate } from "./db/migrate.ts";
import { RepositorySet } from "./db/repository.ts";
import { Sweeper } from "./db/sweep.ts";
import { createRouter } from "./http/routes.ts";
import { dispatch } from "./http/router.ts";
import { createStaticHandler } from "./http/static.ts";
import { logError, logInfo } from "./log.ts";
import { networkAddresses } from "./net/addresses.ts";
import { SyncEngine } from "./sync/engine.ts";

/**
 * Server entry point.
 *
 * The school server hosts the API, the synchronisation endpoints and the
 * client application from a single process and a single port, so that the
 * whole system can be installed on one machine and reached by any device
 * on the school network.
 */

const config = loadConfig();

const db = openDatabase({ file: config.databaseFile, synchronous: config.synchronous });
const migration = migrate(db);

if (migration.applied.length > 0) {
  logInfo(`[db] applied migrations: ${migration.applied.join(", ")}\n`);
}

const repositories = new RepositorySet(db);
const sync = new SyncEngine({
  db,
  repositories,
  batchSize: config.syncBatchSize,
  clientRetentionDays: config.clientRetentionDays,
});

/**
 * The ports the server ends up on.
 *
 * They are held in one object because they are not known until the server
 * is listening: when the port it was given is already taken, it moves to
 * the next one. A client asking where to connect is told the answer.
 */
const network: { port: number; securePort: number | null } = {
  port: config.port,
  securePort: config.tls?.port ?? null,
};

const router = createRouter({
  db,
  repositories,
  sync,
  serverUrl: `http://localhost:${config.port}`,
  sqliteVersion: sqliteVersion(db),
  nodeVersion: process.version,
  network,
});

const serveStatic = createStaticHandler({ root: config.webRoot });

/**
 * The request handler, shared by the plain and the encrypted listener.
 *
 * A browser only allows a web application to be installed and to work
 * offline when it is served from a secure origin, so a phone on the school
 * network needs the encrypted listener. The plain one is kept for the
 * computer the server runs on, and for devices that have not been given the
 * certificate.
 */
function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

  if (url.pathname === "/certificate.cer") {
    serveCertificate(res);
    return;
  }

  if (url.pathname.startsWith("/api/")) {
    void dispatch(router, req, res);
    return;
  }

  if (serveStatic(req, res, url.pathname)) {
    return;
  }

  res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
  res.end("Not found\n");
}

/**
 * Publish the certificate another device needs.
 *
 * A phone cannot run the application offline from a plain web address,
 * because a browser only allows that from a secure origin. The device has
 * to trust the school's certificate, and the easiest way to give it one is
 * to let it download it from the server.
 */
function serveCertificate(res: http.ServerResponse): void {
  if (config.publishedCertificate === null) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("No certificate\n");
    return;
  }
  try {
    const body = fs.readFileSync(config.publishedCertificate);
    res.writeHead(200, {
      "content-type": "application/x-x509-ca-cert",
      "content-length": body.length,
      "content-disposition": 'attachment; filename="school-manager.cer"',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("No certificate\n");
  }
}

/**
 * Write down the port the server ended up on.
 *
 * The launcher has to know where to open the browser, and the port is only
 * known once the server is listening. Saying so in a file is quicker and
 * far more certain than looking for it: on a school machine a port that is
 * not in use is not always refused straight away, because the firewall can
 * drop the connection instead, which makes searching for a port slow.
 */
function writePortFile(file: string | null, port: number): void {
  if (file === null) {
    return;
  }
  try {
    fs.writeFileSync(file, `${port}\n`, "utf8");
  } catch (error) {
    logError(`[school] the port file could not be written: ${String(error)}\n`);
  }
}

const server = http.createServer(handleRequest);

/** How many ports to try before giving up. */
const PORT_ATTEMPTS = 50;

server.on("error", (error: NodeJS.ErrnoException) => {
  // Something else already has this port. Take the next one rather than
  // refusing to start: a school machine has other things running on it.
  if (error.code === "EADDRINUSE" && network.port < config.port + PORT_ATTEMPTS) {
    network.port += 1;
    logInfo(`[school] port ${network.port - 1} is in use; trying ${network.port}\n`);
    server.listen(network.port, config.host);
    return;
  }
  logError(`[school] the server could not start: ${String(error)}\n`);
  process.exit(1);
});

server.listen(config.port, config.host, () => {
  writePortFile(config.portFile, network.port);
  logInfo(`[school] listening on http://${config.host}:${network.port}\n`);
  logInfo(`[school] database ${config.databaseFile}\n`);
  logInfo(`[school] change cursor ${sync.currentCursor()}\n`);

  // Tell the administrator, on this machine and on the console, the address
  // to type into a phone. This is the question they always have to answer.
  const addresses = networkAddresses();
  if (addresses.length > 0) {
    logInfo(
      `[school] other devices on this network can open http://${addresses[0]?.address}:${network.port}\n`,
    );
    for (const entry of addresses.slice(1)) {
      logInfo(`[school] also reachable at http://${entry.address}:${network.port}\n`);
    }
  }
});

/**
 * The encrypted listener.
 *
 * It is optional. When there is no certificate the server simply does not
 * listen on the secure port, and the installation is no less usable — a
 * device that has been given the certificate is the only one that gains
 * the ability to work offline.
 */
let secureServer: https.Server | null = null;
if (config.tls !== null) {
  const tls = config.tls;
  try {
    const options =
      tls.kind === "pfx"
        ? {
            pfx: fs.readFileSync(tls.certFile),
            passphrase: tls.passphrase,
          }
        : {
            cert: fs.readFileSync(tls.certFile),
            key: fs.readFileSync(tls.keyFile),
          };
    secureServer = https.createServer(options, handleRequest);
    secureServer.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "EADDRINUSE" && network.securePort !== null) {
        network.securePort += 1;
        logInfo(`[school] secure port in use; trying ${network.securePort}\n`);
        secureServer?.listen(network.securePort, config.host);
        return;
      }
      logError(`[school] the secure listener failed: ${String(error)}\n`);
      secureServer = null;
    });
    secureServer.listen(tls.port, config.host, () => {
      writePortFile(config.securePortFile, network.securePort ?? tls.port);
      logInfo(`[school] also listening on https://${config.host}:${network.securePort}\n`);
    });
  } catch (error) {
    logError(`[school] the secure listener could not start: ${String(error)}\n`);
    secureServer = null;
  }
}

// Copy the write-ahead log into the database file from a background worker,
// so that the disk work never happens inside a request.
const checkpointer = new Checkpointer({
  databaseFile: config.databaseFile,
  intervalMs: config.checkpointIntervalMs,
  onError: (error) => {
    // The checkpointer is optional, so this is not fatal. It is reported
    // because the alternative is a server that pauses for a second on some
    // writes, with nothing in the log to explain why.
    logError(`[db] the background checkpointer could not run: ${error.message}\n`);
  },
});
checkpointer.start();
if (checkpointer.failed) {
  logInfo(
    "[db] the background checkpointer could not start; the write-ahead log will be checkpointed inside a write\n",
  );
}

// Prune the change log hourly, but only up to the oldest cursor reported
// by a recently active client.
const pruneTimer = setInterval(() => {
  try {
    const removed = sync.pruneChanges();
    if (removed > 0) {
      logInfo(`[sync] pruned ${removed} change log entries\n`);
    }
  } catch (error) {
    logError(`[sync] prune failed: ${String(error)}\n`);
  }
}, 3_600_000);
pruneTimer.unref();

/**
 * Re-decide the values that follow from the date.
 *
 * An invoice that falls due today is overdue today, and no write happened
 * to say so. The sweep looks for those records once a day, and again when
 * the server starts, so that a machine that was off overnight catches up.
 */
const sweeper = new Sweeper({ repositories });

function runSweep(): void {
  try {
    const result = sweeper.run(new Date().toISOString());
    if (result.changed > 0) {
      logInfo(`[db] the daily sweep changed ${result.changed} record(s)\n`);
    }
  } catch (error) {
    logError(`[db] the daily sweep failed: ${String(error)}\n`);
  }
}

runSweep();

const sweepTimer = setInterval(runSweep, config.sweepIntervalMs);
sweepTimer.unref();

function shutdown(signal: string): void {
  logInfo(`\n[school] received ${signal}, shutting down\n`);
  secureServer?.close();
  server.close(() => {
    void checkpointer.stop().finally(() => {
      try {
        db.close();
      } catch {
        // The database is already closed.
      }
      process.exit(0);
    });
  });
  // Do not hang forever on a stuck connection.
  setTimeout(() => process.exit(1), 5_000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
