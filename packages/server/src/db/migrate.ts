import type { DatabaseSync } from "node:sqlite";
import { transaction } from "./database.ts";
import { MIGRATIONS } from "./migrations.ts";

/**
 * Migration runner.
 *
 * Each migration runs inside its own transaction, so a failure leaves the
 * database at the last successfully applied version rather than half
 * migrated.
 */

export interface MigrationResult {
  readonly applied: readonly number[];
  readonly version: number;
}

export function migrate(db: DatabaseSync): MigrationResult {
  // The migration table is created by the first migration itself, so the
  // runner only checks whether it exists rather than creating it.
  let version = currentVersion(db);
  const applied: number[] = [];

  for (const migration of MIGRATIONS) {
    if (migration.version <= version) {
      continue;
    }
    transaction(db, () => {
      db.exec(migration.sql);
      db.prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)").run(
        migration.version,
        migration.name,
        new Date().toISOString(),
      );
    });
    applied.push(migration.version);
    version = migration.version;
  }

  return { applied, version };
}

/** The highest applied migration version, or zero when the database is empty. */
export function currentVersion(db: DatabaseSync): number {
  const table = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'")
    .get();
  if (table === undefined) {
    return 0;
  }
  const row = db
    .prepare("SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations")
    .get() as { version?: number } | undefined;
  return row?.version ?? 0;
}
