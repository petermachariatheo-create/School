# Tuning

The defaults are chosen for a school: a few thousand students, a handful of
devices, one server on one laptop. This document says what each knob does and
when to move it.

## Server settings

| Variable                        | Default       | Move it when                                       |
| ------------------------------- | ------------- | -------------------------------------------------- |
| `SCHOOL_SQLITE_SYNCHRONOUS`     | `NORMAL`      | See [Durability](#durability).                     |
| `SCHOOL_WAL_AUTOCHECKPOINT`     | `4000`        | See [Write pauses](#write-pauses).                 |
| `SCHOOL_CHECKPOINT_INTERVAL_MS` | `5000`        | See [Write pauses](#write-pauses).                 |
| `SCHOOL_SYNC_BATCH_SIZE`        | `500`         | See [Sync batch size](#sync-batch-size).           |
| `SCHOOL_CLIENT_RETENTION_DAYS`  | `30`          | See [Change-log retention](#change-log-retention). |
| `SCHOOL_PORT`                   | `8080`        | The port is taken.                                 |
| `SCHOOL_DATA_DIR`               | `<repo>/data` | The data belongs on a different volume.            |

## Durability

`SCHOOL_SQLITE_SYNCHRONOUS` controls what survives a power cut.

| Value              | Survives an application crash | Survives a power cut                   | Cost                            |
| ------------------ | ----------------------------- | -------------------------------------- | ------------------------------- |
| `NORMAL` (default) | Yes                           | No — the last transactions can be lost | One storage sync per checkpoint |
| `FULL`             | Yes                           | Yes                                    | One storage sync per commit     |

`NORMAL` is the right default. In WAL mode, `NORMAL` does not sync on every
commit, only on a checkpoint, so the write path stays fast. The exposure is
the window between the last checkpoint and the power cut — on the reference
machine, a few seconds of writes.

A school on a laptop with a battery and a power supply is not going to lose
power often. If the machine is on a desktop without a UPS and the school's
data is irreplaceable, set `FULL` and accept the write cost. The measured
effect of `FULL` is not in the benchmarks — it was not measured, so do not
assume it is small.

## Write pauses

A checkpoint copies the write-ahead log into the database file. That copy is
disk-bound, and on slow storage it can take a second. SQLite performs the
checkpoint inside whichever write happened to trigger it, so that write — and,
because the driver is synchronous, every other request — waits for the copy.

**The server avoids this by checkpointing from a worker thread.**
`packages/server/src/db/checkpointer.ts` opens its own connection to the
database and runs a `PASSIVE` checkpoint every five seconds. A passive
checkpoint copies whatever it can without waiting for readers or writers, and
gives up quietly if a reader is still using an old snapshot. The result is
that the copy happens in the background, overlapping with the requests being
served, and no single request pays for it.

Measured over the same workload, the long pauses disappear:

|                                | p50          | p95          | max     |
| ------------------------------ | ------------ | ------------ | ------- |
| Checkpoint on the request path | 26.9 ms      | 733 ms       | 733 ms  |
| Background checkpointer        | 15.8–19.2 ms | 31.3–48.3 ms | 48.3 ms |

`SCHOOL_WAL_AUTOCHECKPOINT` is now a **safety net**, not the primary mechanism.
It is the size of the write-ahead log, in pages, at which SQLite checkpoints
on its own if the background worker is not running. The default of 4 000 pages
(16 MiB) means that in the worst case — the worker failed to start — the log
is still bounded, at the cost of an occasional long pause.

| Value    | Log size   | Behaviour                                                                                                                |
| -------- | ---------- | ------------------------------------------------------------------------------------------------------------------------ |
| 256      | 1 MiB      | Very frequent checkpoints; the worker rarely has to do anything, but the safety net interferes with the background copy. |
| 512      | 2 MiB      | The old default. Reasonable when the worker is disabled.                                                                 |
| **4000** | **16 MiB** | **The default.** The worker does the copying; this is the fallback.                                                      |
| 1000+    | 4 MiB+     | Reasonable only if the worker is known to be working and you want a tighter bound on the log.                            |

**Lower it** if the worker has failed and long pauses are worse than slower
writes. **Raise it** if the storage is slow and you want the safety net to
stay out of the way of the background copy.

The log size between checkpoints is proportional to the write rate: about
30 KB of log per write on the reference workload, because each write touches
several index pages. At 4 000 pages the safety net is reached after roughly
500 writes between worker runs.

If the worker fails to start, the server logs it at start-up and continues
with the safety net. Check [monitoring](../operations/monitoring.md) for how
the log reports it.

`SCHOOL_CHECKPOINT_INTERVAL_MS` is how often the worker runs. The default of
5 000 ms is a compromise: more often means a smaller log and less to copy at
once; less often means fewer interruptions to the write path.

- **Lower it** to 1 000–2 000 on slow storage, where a large copy holds the
  write lock longer.
- **Raise it** to 15 000 or more when the disk is fast and the write rate is
  high, to reduce the total amount of copying.

## Sync batch size

`SCHOOL_SYNC_BATCH_SIZE` is the largest number of changes one pull returns.
The default of 500 is a compromise: a bigger batch means fewer round trips but
a larger response and a longer time before the first change is applied.

A client on a fast LAN wants a big batch; a client on a slow link wants a
small one, because it can apply the first page and show progress while the
rest is still arriving. The client asks for 500 explicitly in its pull
request, so this setting is the server's default for clients that do not
specify.

Raising it above 500 saves round trips on a large initial sync. Lowering it to
100 makes the change feed more responsive on a bad connection.

## Change-log retention

`SCHOOL_CLIENT_RETENTION_DAYS` is how long an inactive client's progress is
remembered. The change log is only pruned below the oldest cursor among
clients that have checked in within that window.

- **Raise it** if devices are used intermittently — a shared tablet that is
  used once a term still gets the full history.
- **Lower it** to reclaim space faster, at the cost of forcing a client that
  has been away to take a full snapshot rather than catching up
  incrementally.

A snapshot is not expensive: 47 ms for the whole school on the reference
machine. The real cost of a snapshot is bandwidth on a slow link, not server
time.

## Client settings

The client's sync interval is a constant in
`packages/web/src/app/store.tsx` — 30 seconds — and is not configurable at
runtime. A school with unreliable Wi-Fi would benefit from a longer interval
and a more aggressive retry on the `online` event.

## When a school outgrows the defaults

In rough order of the effort involved:

1. **More records.** Nothing needs to change. The per-operation costs do not
   depend on the table size.

2. **Filtered queries over many records.** The business fields live in a JSON
   column, so a filter cannot use an index. Promote the hot fields to real
   columns in a migration, or add a generated column with an index on it.

3. **Many concurrent clients.** The server is single-threaded. A p50 of 14 ms
   leaves a lot of headroom, but a school with several hundred simultaneous
   users would want the server on a machine with more cores and the database
   on a faster disk.

4. **A change log that grows without bound.** Check that the clients are
   reporting their progress. A decommissioned device keeps the log alive; see
   [monitoring](../operations/monitoring.md#which-clients-are-behind).

5. **Larger snapshots.** A snapshot is a single JSON document. A school large
   enough for that to be a problem would want the snapshot to page as well.

## Things not to do

- **Do not raise `wal_autocheckpoint` to a very large value** to "avoid
  checkpoints". The log grows, and a checkpoint then copies the whole thing at
  once, which is exactly the pause that was being avoided. The background
  checkpointer already avoids the pause; this only moves it back.

- **Do not set `synchronous = OFF`.** It makes the database vulnerable to
  corruption after a crash, not just to a lost transaction.

- **Do not delete the `-wal` file** while the server is running. It is the
  write-ahead log, and removing it discards committed transactions.

- **Do not put the database on a network share.** SQLite's locking does not
  work over NFS or SMB. The database belongs on the server's local disk.
