import { DatabaseSync, type StatementSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

/**
 * SQLite connection management.
 *
 * The server uses the SQLite module built into Node (`node:sqlite`), so the
 * database driver adds no dependency, no native compilation step and no
 * install footprint. It is currently a release-candidate API, so every
 * access to it is confined to this module and the repository layer.
 */

export interface OpenOptions {
  readonly file: string;
  readonly synchronous?: "NORMAL" | "FULL";
  /** Open the database read-only, for inspection tooling. */
  readonly readonly?: boolean;
}

export function openDatabase(options: OpenOptions): DatabaseSync {
  const { file, synchronous = "NORMAL", readonly = false } = options;

  if (file !== ":memory:" && !readonly) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
  }

  const db = new DatabaseSync(file, { readOnly: readonly });

  if (!readonly) {
    // WAL keeps readers running while a write is in flight. It is the right
    // choice for a school server that serves reads while the UI writes.
    db.exec("PRAGMA journal_mode = WAL");
    // NORMAL is durable against an application crash; FULL additionally
    // protects against power loss but adds a storage sync per commit.
    db.exec(`PRAGMA synchronous = ${synchronous}`);
    db.exec("PRAGMA foreign_keys = ON");
    db.exec("PRAGMA busy_timeout = 5000");
    db.exec("PRAGMA temp_store = MEMORY");
    // Negative values express a cache size in KiB rather than pages.
    db.exec("PRAGMA cache_size = -8000");
    // Checkpoints are normally run by the background checkpointer
    // (`db/checkpointer.ts`) so that the copy of the log into the database
    // file never happens inside a request. This setting is the safety net
    // for the case where that worker cannot run: the log is bounded, at the
    // cost of an occasional long pause.
    const autocheckpoint = Number.parseInt(process.env["SCHOOL_WAL_AUTOCHECKPOINT"] ?? "4000", 10);
    db.exec(
      `PRAGMA wal_autocheckpoint = ${Number.isFinite(autocheckpoint) ? autocheckpoint : 4000}`,
    );
  }

  return db;
}

const transactionDepth = new WeakMap<DatabaseSync, number>();

/**
 * Run `fn` inside a transaction, rolling back if it throws.
 *
 * Nested calls join the outer transaction rather than starting a new one,
 * so a repository method can be transactional in its own right and still be
 * composed into a larger transaction.
 */
export function transaction<T>(db: DatabaseSync, fn: () => T): T {
  const depth = transactionDepth.get(db) ?? 0;
  if (depth > 0) {
    transactionDepth.set(db, depth + 1);
    try {
      return fn();
    } finally {
      transactionDepth.set(db, depth);
    }
  }

  db.exec("BEGIN IMMEDIATE");
  transactionDepth.set(db, 1);
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // The transaction was already rolled back by SQLite.
    }
    throw error;
  } finally {
    transactionDepth.set(db, 0);
  }
}

/** True when the database file exists and is readable. */
export function databaseExists(file: string): boolean {
  return file !== ":memory:" && fs.existsSync(file);
}

/**
 * A cache of prepared statements.
 *
 * `node:sqlite` compiles a statement every time `prepare` is called, and
 * the hot paths — the sync feed and the entity upsert — run the same
 * handful of statements over and over. Keeping the compiled statements
 * removes that compilation from the request path.
 *
 * The cache is bounded: a statement whose SQL varies with its parameters
 * (the filtered list query) would otherwise grow without limit.
 */
export class StatementCache {
  readonly #db: DatabaseSync;
  readonly #statements = new Map<string, StatementSync>();
  readonly #limit: number;

  constructor(db: DatabaseSync, limit = 64) {
    this.#db = db;
    this.#limit = limit;
  }

  /** Get a prepared statement, compiling it the first time it is seen. */
  get(sql: string): StatementSync {
    const cached = this.#statements.get(sql);
    if (cached !== undefined) {
      return cached;
    }
    if (this.#statements.size >= this.#limit) {
      // Drop the oldest entry. Statement order is insertion order, so the
      // first key is the least recently added.
      const oldest = this.#statements.keys().next();
      if (oldest.done !== true) {
        this.#statements.delete(oldest.value);
      }
    }
    const statement = this.#db.prepare(sql);
    this.#statements.set(sql, statement);
    return statement;
  }
}

/** SQLite version bundled with this Node build, for diagnostics. */
export function sqliteVersion(db: DatabaseSync): string {
  const row = db.prepare("SELECT sqlite_version() AS version").get() as
    | { version?: string }
    | undefined;
  return row?.version ?? "unknown";
}
