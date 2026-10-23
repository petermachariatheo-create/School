import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { ulid } from "@school/shared";
import { openDatabase } from "../packages/server/src/db/database.ts";
import { Checkpointer } from "../packages/server/src/db/checkpointer.ts";
import { migrate } from "../packages/server/src/db/migrate.ts";
import { RepositorySet } from "../packages/server/src/db/repository.ts";
import { createRouter } from "../packages/server/src/http/routes.ts";
import { dispatch } from "../packages/server/src/http/router.ts";
import { SyncEngine } from "../packages/server/src/sync/engine.ts";

/**
 * Performance harness.
 *
 * Boots the real server against a throwaway database, fills it with a
 * realistic amount of data and measures the operations a client actually
 * performs. The thresholds are deliberately loose: the point is to catch a
 * change that makes the system an order of magnitude slower, not to
 * benchmark it.
 */

interface Measurement {
  readonly name: string;
  readonly unit: string;
  readonly samples: number;
  readonly p50: number;
  readonly p95: number;
  readonly max: number;
  readonly budget: number;
}

const STUDENT_COUNT = Number.parseInt(process.env["SCHOOL_PERF_STUDENTS"] ?? "2000", 10);
/**
 * The budgets are the p95 latency each operation must stay under.
 *
 * They are set well above the observed p95 so that they measure the system
 * rather than the machine's mood, and far below the behaviour they exist to
 * catch. A single-row read costs about 15 ms of fixed per-request overhead
 * plus a fraction of a millisecond of actual database work, so its budget is
 * 40 ms: still an order of magnitude above the healthy p95, and still an
 * order of magnitude below the 733 ms p95 that the write-ahead log
 * checkpoint produced before the background checkpointer moved it off the
 * request path.
 */
const BUDGETS: Record<string, number> = {
  "list students": 120,
  "read student": 40,
  "create student": 40,
  "pull changes": 400,
  "push operations": 500,
  "export csv": 4000,
  snapshot: 6000,
};

function percentile(values: readonly number[], fraction: number): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.floor(sorted.length * fraction));
  return sorted[index] ?? 0;
}

async function measure(
  name: string,
  unit: string,
  samples: number,
  budget: number,
  run: () => Promise<void>,
): Promise<Measurement> {
  const timings: number[] = [];
  // One warm-up run so that the first sample does not pay for lazy
  // initialisation and the page cache.
  await run();
  for (let index = 0; index < samples; index++) {
    const started = performance.now();
    await run();
    timings.push(performance.now() - started);
  }
  return {
    name,
    unit,
    samples,
    p50: percentile(timings, 0.5),
    p95: percentile(timings, 0.95),
    max: Math.max(...timings),
    budget,
  };
}

// ---- set-up -------------------------------------------------------------------

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "school-perf-"));
const databaseFile = path.join(directory, "perf.db");
const db = openDatabase({ file: databaseFile });
migrate(db);

// The server runs a background checkpointer; the harness measures the
// configuration that is actually deployed.
const checkpointer = new Checkpointer({ databaseFile, intervalMs: 1_000 });
checkpointer.start();

const repositories = new RepositorySet(db);
const sync = new SyncEngine({ db, repositories, batchSize: 500, clientRetentionDays: 30 });
const router = createRouter({
  db,
  repositories,
  sync,
  serverUrl: "http://localhost",
  sqliteVersion: "perf",
  nodeVersion: "perf",
});

const server = http.createServer((req, res) => {
  void dispatch(router, req, res);
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
const { port } = server.address() as AddressInfo;
const base = `http://127.0.0.1:${port}`;

process.stdout.write(`[perf] seeding ${STUDENT_COUNT} students…\n`);
const students = repositories.get("student");
const ids: string[] = [];
for (let index = 0; index < STUDENT_COUNT; index++) {
  const record = students.upsert({
    id: ulid(),
    admissionNumber: `ADM-${String(100000 + index)}`,
    firstName: `First${index}`,
    lastName: `Last${index % 97}`,
    middleName: null,
    dateOfBirth: `201${index % 9}-0${(index % 9) + 1}-1${index % 9}`,
    gender: index % 3 === 0 ? "female" : index % 3 === 1 ? "male" : "undisclosed",
    email: `student${index}@example.edu`,
    phone: `+254700${String(100000 + index).slice(-6)}`,
    address: `${index} Performance Road, Example Town`,
    status: "active",
    admissionDate: `2026-0${(index % 9) + 1}-10`,
    notes: null,
  });
  ids.push(String(record.record["id"]));
}

// ---- measurements ---------------------------------------------------------------

async function get(route: string): Promise<Response> {
  const response = await fetch(`${base}${route}`);
  await response.arrayBuffer();
  return response;
}

const measurements: Measurement[] = [];

measurements.push(
  await measure("list students", "ms", 40, BUDGETS["list students"] ?? 200, async () => {
    await get("/api/v1/students?limit=50");
  }),
);

measurements.push(
  await measure("read student", "ms", 200, BUDGETS["read student"] ?? 50, async () => {
    const id = ids[Math.floor(Math.random() * ids.length)] as string;
    await get(`/api/v1/students/${id}`);
  }),
);

measurements.push(
  await measure("create student", "ms", 100, BUDGETS["create student"] ?? 80, async () => {
    const index = Math.floor(Math.random() * 1_000_000);
    const response = await fetch(`${base}/api/v1/students`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        admissionNumber: `ADM-PERF-${index}`,
        firstName: "Perf",
        lastName: "Test",
      }),
    });
    await response.arrayBuffer();
  }),
);

measurements.push(
  await measure("pull changes", "ms", 10, BUDGETS["pull changes"] ?? 1000, async () => {
    await get("/api/v1/sync/changes?since=0&limit=500");
  }),
);

measurements.push(
  await measure("push operations", "ms", 10, BUDGETS["push operations"] ?? 1000, async () => {
    const operations = Array.from({ length: 50 }, (_, index) => ({
      opId: `perf-${Date.now()}-${index}-${Math.random().toString(36).slice(2)}`,
      entityType: "student",
      entityId: ulid(),
      operation: "upsert",
      patch: {
        admissionNumber: `ADM-PERF-PUSH-${index}-${Math.random()}`,
        firstName: "P",
        lastName: "Q",
      },
      baseRevision: 0,
      clientTime: new Date().toISOString(),
    }));
    const response = await fetch(`${base}/api/v1/sync/push`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ operations }),
    });
    await response.arrayBuffer();
  }),
);

measurements.push(
  await measure("export csv", "ms", 3, BUDGETS["export csv"] ?? 10000, async () => {
    await get("/api/v1/students/export.csv");
  }),
);

measurements.push(
  await measure("snapshot", "ms", 3, BUDGETS["snapshot"] ?? 20000, async () => {
    await get("/api/v1/sync/snapshot");
  }),
);

// ---- report ---------------------------------------------------------------------

server.close();
await once(server, "close");
await checkpointer.stop();
db.close();
fs.rmSync(directory, { recursive: true, force: true });

process.stdout.write(
  "\nOperation          samples      p50       p95       max   budget   verdict\n",
);
process.stdout.write(
  "----------------- -------- --------- --------- --------- -------- ---------\n",
);

let failed = false;
for (const measurement of measurements) {
  const verdict = measurement.p95 <= measurement.budget ? "ok" : "OVER BUDGET";
  if (verdict !== "ok") {
    failed = true;
  }
  process.stdout.write(
    `${measurement.name.padEnd(17)} ${String(measurement.samples).padStart(8)} ` +
      `${measurement.p50.toFixed(1).padStart(9)} ${measurement.p95.toFixed(1).padStart(9)} ` +
      `${measurement.max.toFixed(1).padStart(9)} ${String(measurement.budget).padStart(8)} ${verdict}\n`,
  );
}

process.stdout.write("\n");
if (failed) {
  process.stderr.write("[perf] one or more operations exceeded their budget.\n");
  process.exit(1);
}
process.stdout.write("[perf] every operation was within budget.\n");
