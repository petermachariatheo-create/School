import { Worker } from "node:worker_threads";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The background checkpointer.
 *
 * A school server is often a laptop whose disk is busy with other work, and
 * flushing the write-ahead log can take a noticeable fraction of a second.
 * Doing that inside a write transaction would stall the request that
 * triggered it — and, because the database driver is synchronous, every
 * other request as well.
 *
 * The checkpointer runs in a worker thread with its own connection, so the
 * disk work overlaps with serving requests. If the worker cannot start, the
 * server still works: the safety-net auto-checkpoint in `openDatabase`
 * bounds the log, at the cost of an occasional long pause.
 */

/**
 * The worker script, next to this file.
 *
 * Two layouts exist. In the repository the worker is a TypeScript file that
 * Node runs directly; in a packaged build it is a bundle written next to the
 * server. The file that is actually there is the one that must be started,
 * and looking for it — rather than assuming one name — is what keeps the
 * packaged server from silently losing the checkpointer.
 */
export function resolveWorkerPath(moduleDirectory: string): string {
  const candidates = ["checkpointer-worker.mjs", "checkpointer-worker.ts"];
  for (const candidate of candidates) {
    const file = path.join(moduleDirectory, candidate);
    if (fs.existsSync(file)) {
      return file;
    }
  }
  // Nothing is there. Report the name that was looked for first, so that
  // the message points at the file a reader expects to find.
  return path.join(moduleDirectory, candidates[0] as string);
}

const WORKER_PATH = resolveWorkerPath(path.dirname(fileURLToPath(import.meta.url)));

/** The worker script this server will start. Exported so that it can be checked. */
export const WORKER_SCRIPT = WORKER_PATH;

/** How often the log is copied into the database file. */
const DEFAULT_INTERVAL_MS = 5_000;

export interface CheckpointerOptions {
  /** The database file to checkpoint. */
  readonly databaseFile: string;
  /** How often to checkpoint, in milliseconds. */
  readonly intervalMs?: number;
  /** Called with the outcome of each checkpoint attempt. */
  readonly onCheckpoint?: (outcome: { busy: number; log: number; checkpointed: number }) => void;
  /**
   * The worker script to start.
   *
   * It defaults to the script next to this file. It is only set by tests,
   * which use it to exercise the failure path: a worker that cannot start
   * has to be reported, not ignored.
   */
  readonly workerPath?: string;
  /**
   * Called when the worker cannot run.
   *
   * The checkpointer is optional, so a failure is not fatal. It is not
   * silent either: without the worker the server pauses while the log is
   * copied, and that is worth saying out loud, because it is the reason a
   * request can take a second.
   */
  readonly onError?: (error: Error) => void;
}

export class Checkpointer {
  readonly #options: CheckpointerOptions;
  #worker: Worker | null = null;
  #failed = false;
  #stopping = false;

  constructor(options: CheckpointerOptions) {
    this.#options = options;
  }

  /** True when the worker is running. */
  get running(): boolean {
    return this.#worker !== null;
  }

  /** True when the worker could not be started. */
  get failed(): boolean {
    return this.#failed;
  }

  /** Start the worker. Failure is not fatal. */
  start(): void {
    if (this.#worker !== null || this.#options.databaseFile === ":memory:") {
      return;
    }

    try {
      const worker = new Worker(this.#options.workerPath ?? WORKER_PATH, {
        workerData: {
          databaseFile: this.#options.databaseFile,
          intervalMs: this.#options.intervalMs ?? DEFAULT_INTERVAL_MS,
        },
      });
      worker.on("error", (error: Error) => {
        this.#failed = true;
        this.#options.onError?.(error);
      });
      worker.on("message", (message: unknown) => {
        if (
          typeof message === "object" &&
          message !== null &&
          (message as { type?: string }).type === "checkpoint"
        ) {
          const outcome = message as { busy: number; log: number; checkpointed: number };
          this.#options.onCheckpoint?.(outcome);
        }
      });
      worker.on("exit", (code: number) => {
        this.#worker = null;
        // A worker that stops on its own did not stop because it was asked
        // to. That is worth reporting: the log would no longer be copied in
        // the background, and every write would pause for it.
        if (!this.#stopping) {
          this.#failed = true;
          this.#options.onError?.(
            new Error(`the checkpoint worker stopped with exit code ${code}`),
          );
        }
      });
      worker.unref();
      this.#worker = worker;
    } catch (error) {
      this.#failed = true;
      this.#options.onError?.(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /** Stop the worker and wait for it to exit. */
  async stop(): Promise<void> {
    const worker = this.#worker;
    if (worker === null) {
      return;
    }
    this.#worker = null;
    this.#stopping = true;
    try {
      worker.postMessage("stop");
      await worker.terminate();
    } catch {
      // The worker has already gone.
    }
  }
}
