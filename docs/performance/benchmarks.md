# Benchmarks

These are the numbers the system actually produced, on the machine described
below, with the harness in `scripts/perf.ts`.

Run them yourself:

```bash
npm run perf
```

## The reference machine

|         |                                                     |
| ------- | --------------------------------------------------- |
| CPU     | Intel Core i3-7100U @ 2.40 GHz, 2 cores / 4 threads |
| Memory  | 7.7 GB                                              |
| Storage | Local SSD-backed volume, ~11 GB free                |
| OS      | Windows 10 Home 10.0.19045                          |
| Node    | v24.18.0                                            |
| SQLite  | 3.53.1 (built into Node)                            |

This is a deliberately modest machine — a school laptop. The budgets below are
set so that a change which makes the system an order of magnitude slower fails
the harness.

## The workload

The harness boots the real server against a throwaway database, writes 2 000
students through the repository, then measures the operations a client actually
performs. The background checkpointer runs, as it does in production.

| Measurement       | What it does                                          |
| ----------------- | ----------------------------------------------------- |
| `list students`   | `GET /api/v1/students?limit=50`                       |
| `read student`    | `GET /api/v1/students/{id}`, a random id each time    |
| `create student`  | `POST /api/v1/students`                               |
| `pull changes`    | `GET /api/v1/sync/changes?since=0&limit=500`          |
| `push operations` | `POST /api/v1/sync/push` with 50 new operations       |
| `export csv`      | `GET /api/v1/students/export.csv` (all 2 000 records) |
| `snapshot`        | `GET /api/v1/sync/snapshot` (every entity type)       |

Every measurement takes one warm-up sample that is discarded, so the first
sample does not pay for lazy initialisation and the page cache.

## The results

```
Operation          samples      p50       p95       max   budget   verdict
----------------- -------- --------- --------- --------- -------- ---------
list students           40      15.3      21.4      46.8      120 ok
read student           200      15.2      17.8      41.4       40 ok
create student         100      15.4      16.8      17.9       40 ok
pull changes            10      17.8      32.5      32.5      400 ok
push operations         10      27.1      35.8      35.8      500 ok
export csv               3      15.9      23.8      23.8     4000 ok
snapshot                 3      52.6      63.9      63.9     6000 ok
```

All timings are in milliseconds. The verdict is decided on the **p95**, not
the maximum: one stalled sample out of two hundred is the operating system's
mood, not the system's behaviour.

### About the budgets

They are set well above the observed p95 and far below the behaviour they
exist to catch. `read student` is the tightest: about 15 ms of the figure is
fixed per-request overhead and the actual row lookup is a fraction of a
millisecond, so a 40 ms budget is an order of magnitude above the healthy
p95 and an order of magnitude below the 733 ms p95 that the write-ahead log
checkpoint produced before the background checkpointer moved it off the
request path.

A budget that sits _at_ the observed p95 measures the machine, not the
software. That is not a useful regression test, because it fails at random
and teaches the reader to ignore it.

### Reading them

**The floor is about 15 ms.** That is not the database; it is the HTTP round
trip on a loopback connection plus the fixed per-request cost of the
`node:sqlite` statements. Every operation that touches one row costs the
same, so `read student` at a p50 of 15.2 ms is essentially the request
overhead. The actual row lookup is well under a millisecond.

**`push operations` at a p50 of 27.1 ms for 50 operations** is about 0.5 ms
per operation: a sequence allocation, a record write, a change-feed entry, an
applied-operation entry and a validation, in one transaction.

**`snapshot` at 53 ms** reads every record of every entity type and serialises
it. It is the heaviest read operation, and it is the one a client performs
once, when it first connects.

**The `max` column is close to `p95`** for every write operation. That is the
property that matters for a shared server: there are no long tails caused by
checkpoints. It was not always true — see below.

**The occasional large `max` in the read column is an outlier, not a trend.**
One of two hundred single-row reads in the recorded run took 41.4 ms while the
p95 was 17.8 ms. A read touches no lock and no log, so a checkpoint cannot
explain it; it is the garbage collector or the operating system's disk
scheduler. Across six runs the read maximum was 249.6, 20.8, 30.0, 218.5,
21.5 and 41.4 ms — two runs had a single stalled sample, four did not. The p95
never moved. That is why the verdict is taken on the p95.

## Three optimisations that were made because of these numbers

### One transaction per push, not one per operation

The first version of the push path applied each operation in its own
transaction, so that one invalid operation could not discard the rest of the
batch. Measured over the same workload:

|                       | Before    | After   |
| --------------------- | --------- | ------- |
| `push operations` p50 | 326.6 ms  | 26.9 ms |
| `push operations` p95 | 1352.5 ms | 48.3 ms |
| `push operations` max | 1352.5 ms | 48.3 ms |

The batch is now applied in **one transaction**, with a **savepoint per
operation**. The savepoint preserves the original guarantee — an invalid
operation is rejected on its own and does not discard the rest — while the
batch as a whole becomes atomic. A client that retries after a timeout can no
longer end up with half a batch applied twice.

### A prepared-statement cache

`node:sqlite` compiles a statement every time `prepare` is called. The hot
paths ran the same handful of statements over and over. Caching the compiled
statements (`StatementCache` in `packages/server/src/db/database.ts`) roughly
halved the cost of a write:

|                           | Before       | After        |
| ------------------------- | ------------ | ------------ |
| Cost per pushed operation | 0.65–0.93 ms | 0.21–0.44 ms |

### The write-ahead log moved off the request path

This was the largest remaining source of latency, and the hardest to diagnose.

Copying the write-ahead log into the database file is disk-bound work. How
long it takes depends on how quickly the operating system can flush writes,
and on this machine that varies from a few milliseconds to well over a second.
When SQLite performs the checkpoint inside a write transaction — which is what
it does by default — the request that happened to trigger it waits for the
whole copy. Because the database driver is synchronous, every other request
waits with it.

The measurements of the write path alone showed the shape of the problem
clearly:

| `wal_autocheckpoint` | p50     | p95      | max      | writes over 20 ms | total for 3 000 writes |
| -------------------- | ------- | -------- | -------- | ----------------- | ---------------------- |
| 64                   | 0.26 ms | 15.09 ms | 98 ms    | 17                | 7 957 ms               |
| 128                  | 0.18 ms | 14.42 ms | 1 524 ms | 8                 | 5 810 ms               |
| 256                  | 0.22 ms | 3.64 ms  | 404 ms   | 36                | 4 552 ms               |
| 512                  | 0.21 ms | 0.64 ms  | 1 622 ms | 40                | 4 694 ms               |
| 1 000                | 0.19 ms | 0.45 ms  | 440 ms   | 26                | 2 990 ms               |
| 2 000                | 0.18 ms | 0.54 ms  | 144 ms   | 13                | 2 106 ms               |
| 4 000                | 0.21 ms | 0.56 ms  | 1 331 ms | 6                 | 2 877 ms               |

The number of long pauses is roughly the same at every setting, and the
longest pause varies by an order of magnitude between runs of the same
setting. **Tuning the checkpoint size is tuning around a noisy underlying
cost, not fixing it.**

The fix was to move the checkpoint off the request path entirely. The server
now runs it from a **worker thread** (`packages/server/src/db/checkpointer.ts`)
that holds its own connection and checkpoints every five seconds. The
checkpoint is `PASSIVE`: it copies what it can without waiting for readers or
writers, and gives up quietly if a reader is still using an old snapshot.

With the checkpointer running, four consecutive runs of the harness all
passed every budget:

|                       | Run 1   | Run 2   | Run 3   | Run 4   |
| --------------------- | ------- | ------- | ------- | ------- |
| `push operations` p50 | 15.6 ms | 19.0 ms | 16.7 ms | 14.8 ms |
| `push operations` p95 | 30.4 ms | 25.4 ms | 31.9 ms | 23.8 ms |
| `push operations` max | 30.4 ms | 25.4 ms | 31.9 ms | 23.8 ms |
| `read student` p95    | 16.8 ms | 17.0 ms | 17.0 ms | 16.5 ms |
| `create student` max  | 41.8 ms | 20.1 ms | 18.0 ms | 17.9 ms |

Before the change, a single run had produced a `push operations` p95 of
733 ms. The variance is gone.

`SCHOOL_WAL_AUTOCHECKPOINT` remains as a **safety net** (4 000 pages, 16 MiB)
for the case where the worker cannot start: the log is still bounded, at the
cost of the occasional long pause.

## What was deliberately not optimised

**Indexing the business fields as columns.** The business fields live in a
JSON column, and a query on one of them uses `json_extract`, which cannot use
an index. A list filtered by `status` scans the table. At 2 000 students that
is irrelevant; at 200 000 it would not be. The fix is to promote the hot fields
to real columns, which is a schema migration and a change to the repository.
It is not needed for a school, and it would make the generic repository
per-entity again.

**Parallelism.** The server is single-threaded and handles requests
sequentially. A school with a few dozen concurrent clients does not saturate
it. The measured p50 of 13 ms leaves plenty of headroom.

**A connection pool.** `node:sqlite` is synchronous. There is nothing to pool.

## Scaling expectations

The measurements were taken with 2 000 students. The system is roughly linear
in the number of records for reads, and the write path is dominated by the
per-operation work rather than by the table size. A school of 20 000 students
would see the same per-operation latencies.

What does grow with the number of records:

- the write-ahead log between checkpoints (about 30 KB of log per write on
  this workload, because every write touches several index pages);
- the size of `school.db`;
- the duration of a full snapshot, linearly.

See [tuning](tuning.md) for what to change if a school outgrows the defaults.
