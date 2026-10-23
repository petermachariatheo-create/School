import { parentPort, workerData } from "node:worker_threads";
import { DatabaseSync } from "node:sqlite";

/**
 * The checkpoint worker.
 *
 * Copying the write-ahead log into the database file is disk-bound work
 * whose duration depends on how quickly the operating system can flush
 * writes — on a busy or slow disk that can be well over a second. When
 * SQLite does this inside a write transaction, the request that happened
 * to trigger it waits for the whole copy, and because the database driver
 * is synchronous it holds the event loop while it waits.
 *
 * This worker holds its own connection and checkpoints on a timer, so the
 * copy happens while the server is serving requests.
 *
 * The checkpoint is PASSIVE: it copies as much of the log as it can
 * without waiting for readers or writers, and gives up quietly if a
 * reader is still using an old snapshot.
 */

interface CheckpointerConfig {
  readonly databaseFile: string;
  readonly intervalMs: number;
}

const config = workerData as CheckpointerConfig;

const db = new DatabaseSync(config.databaseFile);
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA busy_timeout = 5000");
db.exec("PRAGMA synchronous = NORMAL");

const timer = setInterval(() => {
  try {
    const result = db.prepare("PRAGMA wal_checkpoint(PASSIVE)").get() as {
      busy?: number;
      log?: number;
      checkpointed?: number;
    };
    parentPort?.postMessage({
      type: "checkpoint",
      busy: Number(result?.busy ?? -1),
      log: Number(result?.log ?? -1),
      checkpointed: Number(result?.checkpointed ?? -1),
    });
  } catch (error) {
    parentPort?.postMessage({ type: "error", message: String(error) });
  }
}, config.intervalMs);

// The timer must not keep the worker alive on its own.
timer.unref();

parentPort?.on("message", (message: unknown) => {
  if (message === "stop") {
    clearInterval(timer);
    try {
      db.close();
    } catch {
      // Already closed.
    }
    process.exit(0);
  }
});
