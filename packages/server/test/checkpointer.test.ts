import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ulid } from "@school/shared";
import { Checkpointer, resolveWorkerPath, WORKER_SCRIPT } from "../src/db/checkpointer.ts";
import { openDatabase } from "../src/db/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { RepositorySet } from "../src/db/repository.ts";

/**
 * The background checkpointer.
 *
 * Copying the write-ahead log into the database file is disk-bound work.
 * When SQLite does it inside a write transaction, the request that happens
 * to trigger it waits for the whole copy. The checkpointer moves that work
 * into a worker thread so it overlaps with serving requests.
 */

function temporaryDatabase(): { file: string; directory: string } {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "school-checkpoint-"));
  return { file: path.join(directory, "test.db"), directory };
}

/**
 * Wait for a condition, rather than sleeping for a fixed time.
 *
 * A fixed sleep makes the test fail on a busy machine: the worker may not
 * have had a chance to run yet.
 */
async function waitFor(condition: () => boolean, timeoutMs = 5_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return condition();
}

describe("the background checkpointer", () => {
  test("finds the worker script that is actually there", () => {
    // The worker is a TypeScript file in the repository and a bundle in a
    // packaged build. The server has to start whichever is present: a
    // packaged server that looked only for the TypeScript file would lose
    // the checkpointer without saying so.
    assert.ok(fs.existsSync(WORKER_SCRIPT), `the worker script was not found: ${WORKER_SCRIPT}`);

    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "school-worker-"));
    try {
      const bundled = path.join(directory, "checkpointer-worker.mjs");
      fs.writeFileSync(bundled, "// worker\n");
      assert.equal(resolveWorkerPath(directory), bundled);

      fs.rmSync(bundled);
      const source = path.join(directory, "checkpointer-worker.ts");
      fs.writeFileSync(source, "// worker\n");
      assert.equal(resolveWorkerPath(directory), source);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  test("reports a worker that cannot start", async () => {
    // A worker that cannot run is not fatal, but it is not silent either:
    // without it the server pauses while the log is copied, and that is
    // worth a line in the log.
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "school-worker-"));
    const errors: Error[] = [];
    const checkpointer = new Checkpointer({
      databaseFile: path.join(directory, "test.db"),
      workerPath: path.join(directory, "there-is-no-worker-here.mjs"),
      onError: (error) => errors.push(error),
    });
    checkpointer.start();

    const reported = await waitFor(() => errors.length > 0);
    assert.ok(reported, "the failure to start the worker was not reported");
    assert.equal(checkpointer.failed, true);

    await checkpointer.stop();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  test("starts a worker and stops it cleanly", async () => {
    const { file, directory } = temporaryDatabase();
    const db = openDatabase({ file });
    migrate(db);

    const checkpointer = new Checkpointer({ databaseFile: file, intervalMs: 200 });
    checkpointer.start();
    assert.equal(checkpointer.running, true);
    assert.equal(checkpointer.failed, false);

    await checkpointer.stop();
    assert.equal(checkpointer.running, false);

    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  test("copies the log into the database file", async () => {
    const { file, directory } = temporaryDatabase();
    const db = openDatabase({ file });
    migrate(db);
    const repositories = new RepositorySet(db);
    const students = repositories.get("student");

    const outcomes: { busy: number; log: number; checkpointed: number }[] = [];
    const checkpointer = new Checkpointer({
      databaseFile: file,
      intervalMs: 150,
      onCheckpoint: (outcome) => outcomes.push(outcome),
    });
    checkpointer.start();

    for (let index = 0; index < 50; index++) {
      students.upsert({
        id: ulid(),
        admissionNumber: `ADM-${index}`,
        firstName: "First",
        lastName: "Last",
        middleName: null,
        dateOfBirth: "2013-01-01",
        gender: "female",
        email: `s${index}@example.edu`,
        phone: null,
        address: null,
        status: "active",
        admissionDate: "2026-01-10",
        notes: null,
      });
    }

    // Give the worker a few ticks to run.
    const reported = await waitFor(() => outcomes.length > 0);

    assert.ok(reported, "the worker did not report a checkpoint");
    const last = outcomes[outcomes.length - 1];
    assert.equal(last?.busy, 0, "the checkpoint was blocked");
    assert.ok((last?.checkpointed ?? 0) > 0, "no frames were copied");

    await checkpointer.stop();
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  test("does not start for an in-memory database", () => {
    const checkpointer = new Checkpointer({ databaseFile: ":memory:" });
    checkpointer.start();
    assert.equal(checkpointer.running, false);
    assert.equal(checkpointer.failed, false);
  });

  test("the write-ahead log stays bounded once the log is checkpointed", async () => {
    const { file, directory } = temporaryDatabase();
    const db = openDatabase({ file });
    migrate(db);
    const repositories = new RepositorySet(db);
    const students = repositories.get("student");

    const write = (index: number, prefix: string): void => {
      students.upsert({
        id: ulid(),
        admissionNumber: `${prefix}-${index}`,
        firstName: "First",
        lastName: "Last",
        middleName: null,
        dateOfBirth: "2013-01-01",
        gender: "female",
        email: `${prefix}${index}@example.edu`,
        phone: null,
        address: null,
        status: "active",
        admissionDate: "2026-01-10",
        notes: null,
      });
    };

    const walSize = (): number => {
      try {
        return fs.statSync(`${file}-wal`).size;
      } catch {
        return 0;
      }
    };

    const outcomes: { busy: number; log: number; checkpointed: number }[] = [];
    const checkpointer = new Checkpointer({
      databaseFile: file,
      intervalMs: 150,
      onCheckpoint: (outcome) => outcomes.push(outcome),
    });
    checkpointer.start();

    for (let index = 0; index < 100; index++) {
      write(index, "A");
    }
    const checkpointed = await waitFor(() => outcomes.length > 0);
    assert.ok(checkpointed, "the worker did not report a checkpoint");
    const afterFirstBatch = walSize();

    for (let index = 0; index < 100; index++) {
      write(index, "B");
    }
    await waitFor(() => outcomes.length > 1);
    const afterSecondBatch = walSize();

    // The second batch adds the same amount of data as the first. If the
    // log were not being checkpointed it would have doubled.
    assert.ok(
      afterSecondBatch < afterFirstBatch * 1.6,
      `the log grew from ${afterFirstBatch} to ${afterSecondBatch} bytes`,
    );

    await checkpointer.stop();
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
});
