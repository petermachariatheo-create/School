# Monitoring

The server is a single process with a single database file. Monitoring it is
mostly a matter of watching a few numbers and knowing what they mean.

## Health

```
GET /api/v1/health
```

Returns `200` with `status: "ok"` when the server is up and can reach the
database. It reads the change cursor, so it also detects a database that has
become unreadable.

Use it as the service check for systemd, a load balancer or an uptime monitor:

```bash
curl -fsS http://localhost:8080/api/v1/health
```

## What the server logs

The server writes to standard output, one line per event:

```
[db] applied migrations: 2
[school] listening on http://0.0.0.0:8080
[school] database /var/lib/school/school.db
[school] change cursor 4182
[db] the background checkpointer could not run: <the reason>
[sync] pruned 1200 change log entries
[school] received SIGTERM, shutting down
```

There is no request log. Adding one is easy — the router has a single
dispatch point — but it is deliberately absent: a school server's request log
would contain every record id and query, which is more personal data than a
log file needs to hold.

Under systemd, the output goes to the journal:

```bash
journalctl -u school -f
```

## What to watch

| What             | Where                          | Why it matters                                                                    |
| ---------------- | ------------------------------ | --------------------------------------------------------------------------------- |
| Process is alive | `systemctl is-active school`   | Everything else is moot if it is not.                                             |
| `status` is `ok` | the health endpoint            | The database is reachable.                                                        |
| Change cursor    | the health endpoint's `cursor` | A cursor that never moves means no writes are reaching the database.              |
| Database size    | `du -h school.db`              | Grows with the school's history. See [backup and restore](backup-and-restore.md). |
| Free disk space  | `df -h`                        | The most common cause of a school server stopping.                                |
| Client catch-up  | `sync_clients` table           | See below.                                                                        |

### Is the background checkpointer running?

The server copies the write-ahead log into the database file from a background
worker, so that the copy never happens inside a request. If that worker
cannot run, the server says so, with the reason:

```
[db] the background checkpointer could not run: Cannot find module .../checkpointer-worker.mjs
```

The server keeps working — the log is still bounded by
`SCHOOL_WAL_AUTOCHECKPOINT` — but writes will occasionally be slow, because
the checkpoint then happens inside the write that triggered it. See
[the write path](../performance/tuning.md#write-pauses).

In a packaged installation the worker script has to be next to the server
bundle. If it is missing, this is the line that says so, and
`npm run check:package` is the command that catches it before a school does.

The worker's health can also be seen from the log file itself:

```bash
ls -l school.db-wal
```

A `-wal` file that keeps growing between a few megabytes and tens of
megabytes, and never settles, means the checkpointer is not doing its job.

### Which clients are behind?

The `sync_clients` table records every client's cursor and when it was last
seen:

```sql
SELECT client_id, cursor, last_seen_at
FROM sync_clients
ORDER BY last_seen_at DESC;
```

A client whose `last_seen_at` is old is a device that has not been used
recently. It keeps the change log from being pruned, which is correct but
means the log grows. A device that has been decommissioned should be removed:

```sql
DELETE FROM sync_clients WHERE client_id = 'client-01ARZ...';
```

### The change log

```sql
SELECT COUNT(*) AS entries, MIN(seq) AS oldest, MAX(seq) AS newest FROM changes;
```

A large `entries` count with a `oldest` far below the oldest client cursor
means the log is not being pruned. Check that the clients are reporting, and
that the hourly prune is running.

## Disk space

The change log is the main thing that grows over time, and it is pruned
automatically. The entity tables grow slowly — a school adds and removes
records in small numbers.

Watch for:

- **The write-ahead log.** `-wal` can grow to a few megabytes between
  checkpoints. It is bounded by the background checkpointer and by
  `SCHOOL_WAL_AUTOCHECKPOINT`; see [tuning](../performance/tuning.md).
- **The database file.** SQLite does not shrink automatically after a delete.
  `VACUUM` reclaims the space; `VACUUM INTO` to a new file and back is safer
  on a live system.

## Metrics

The server does not expose a Prometheus endpoint. The numbers above are
available through the health endpoint and through SQL against the database,
which is enough for a school deployment. If metrics are needed, the natural
place to add them is the router's dispatch point, where the request method,
path, status and duration are all known.

## Logs for clients

The client's own state is visible in the interface: the sync bar shows the
cursor, the number of changes waiting, the number of changes the server
refused, and the time of the last successful sync. The outbox panel lists the
individual changes that have not reached the server, with the reason for a
failure.

When a client reports that changes are not syncing, the first question is
whether the server is reachable at all, and the second is what the outbox
panel says.

## See also

- [Troubleshooting](troubleshooting.md)
- [Deployment](deployment.md)
