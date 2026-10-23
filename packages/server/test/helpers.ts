import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { openDatabase } from "../src/db/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { RepositorySet } from "../src/db/repository.ts";
import { SyncEngine } from "../src/sync/engine.ts";

/**
 * Test fixtures.
 *
 * Tests use a real SQLite file in a temporary directory rather than an
 * in-memory database, so that WAL behaviour, transaction semantics and
 * file-level durability are exercised as they are in production.
 */

export interface TestContext {
  readonly db: DatabaseSync;
  readonly repositories: RepositorySet;
  readonly sync: SyncEngine;
  readonly directory: string;
  cleanup(): void;
}

export function createTestContext(): TestContext {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "school-test-"));
  const file = path.join(directory, "test.db");
  const db = openDatabase({ file });
  migrate(db);
  const repositories = new RepositorySet(db);
  const sync = new SyncEngine({
    db,
    repositories,
    batchSize: 500,
    clientRetentionDays: 30,
  });

  return {
    db,
    repositories,
    sync,
    directory,
    cleanup() {
      try {
        db.close();
      } catch {
        // Already closed.
      }
      fs.rmSync(directory, { recursive: true, force: true });
    },
  };
}

/** A valid student record, ready for the repository. */
export function studentFixture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    admissionNumber: "ADM-001",
    firstName: "Ada",
    lastName: "Lovelace",
    gender: "female",
    status: "active",
    ...overrides,
  };
}
