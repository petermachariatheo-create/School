# Troubleshooting

## The application says it could not start, but it is running

This is the launcher reporting that the server did not answer in time. The
server may be running perfectly well: the launcher starts it, waits for it,
and opens the browser.

Look in the `data` folder next to the application:

- `data/launcher.log` — what the launcher did, with the port it was waiting
  for.
- `data/server.log` — what the server said.

If the server log ends at "listening on http://0.0.0.0:8080" and the
application works when opened in a browser by hand, the server is fine and
only the launcher's check was too impatient. The usual cause is a machine
that is busy, or a write-ahead log that is being copied into the database
file at the moment the launcher asked.

## The server will not start

### `Error: Cannot find module 'node:sqlite'`

The Node version is too old. `node:sqlite` was added in Node 22 and is only
stable enough to depend on from Node 24.

```bash
node --version
```

Upgrade to Node 24 or later.

### `EADDRINUSE: address already in use :::8080`

Another server is already on that port.

```bash
# Windows
netstat -ano | findstr :8080
# Linux
ss -ltnp | grep 8080
```

Either stop the other process or start on a different port with
`SCHOOL_PORT`.

### `SQLITE_CANTOPEN: unable to open database file`

The data directory does not exist and cannot be created, or is not writable by
the user the server runs as.

```bash
ls -ld /var/lib/school
sudo chown school:school /var/lib/school
```

## A client cannot connect

### The page loads but every request fails

The client was served by the server, so it uses the same origin. If the
requests fail, the server is not serving correctly.

Check the health endpoint from the client machine:

```bash
curl -v http://<server-address>:8080/api/v1/health
```

- **Connection refused** — the server is not running, or it is bound to
  `127.0.0.1` rather than `0.0.0.0`. Set `SCHOOL_HOST=0.0.0.0`.
- **Connection timed out** — a firewall between the client and the server.
  Check that the port is allowed on the school network.
- **A 404 on `/api/v1/health`** — the request went to the static handler, not
  the API. This happens when the server was started from a build without the
  API, or when a reverse proxy is routing `/api` incorrectly.

### The client works but the service worker does not

A service worker only registers on a secure origin: `https://`, or `http://`
on `localhost`. A school server reached over `http://192.168.1.10:8080` is
**not** a secure origin, so the client will not install and will not work
offline.

This is a browser rule, not a limitation of this application. The options are:

1. Serve the school server over HTTPS with a local certificate. A self-signed
   certificate has to be installed on every client device, which is work a
   school will not enjoy.
2. Accept that the client requires a network connection on a plain-HTTP LAN,
   while still using the same code and the same offline storage.
3. Put the server behind a TLS-terminating reverse proxy.

The data model, the sync protocol and the client are unaffected either way.

## A client shows changes that are not syncing

Open the **outbox** panel in the client. It lists every local change that has
not reached the server, and a rejected change with the server's reason.

### "The server could not be reached"

The client is offline. The changes are safe in the outbox and will be sent
when the connection returns. Nothing needs to be done.

### The outbox is empty but the cursor does not move

The client has no pending changes and the server has nothing new to send.
Check that the server's cursor is moving:

```bash
curl -s http://localhost:8080/api/v1/health | grep cursor
```

If the server's cursor is moving and the client's is not, the client is not
pulling. The client syncs on start-up, every 30 seconds, and when the browser
reports that it is back online. Check the browser console for errors.

### A change is marked as refused

The server rejected the operation. The outbox panel shows the reason. The
common reasons are:

- **"The record was deleted on the server and cannot be modified."** Somebody
  deleted the record on another device after this device had edited it. The
  edit is genuinely gone; re-create the record if it is still needed.
- **A validation failure.** The edited value does not satisfy the schema — an
  empty required field, a malformed email address, a date in the wrong form.
  The message names the field.

A refused change is not retried automatically, because the server will refuse
it again. Delete it from the outbox and edit the record again.

## A conflict was reported

A conflict means the server changed a field at the same time as the client,
and the server's value stands. The client applies the server's version on the
next pull, and the conflicting fields are listed in the operation's result.

Nothing is lost: the value the client tried to set is in the outbox entry's
history until the entry is removed, and it can be re-entered if it was right.

## The database is locked

`SQLITE_BUSY: database is locked` means a writer held the lock for longer
than the busy timeout (5 seconds).

The server is the only process that writes to the database, so this happens
only when a write is genuinely slow — a very large import, or a checkpoint
during a heavy write burst. The busy timeout means the server waits rather
than failing immediately.

If it happens repeatedly, check the free disk space and the size of the
write-ahead log.

A checkpoint normally happens in the background, not inside a write. If the
server logged that the background checkpointer could not start, the checkpoint
falls back to happening inside the write that triggered it, and this is the
most likely cause. See
[monitoring](monitoring.md#is-the-background-checkpointer-running).

## An import says every row is invalid

The preview reports the reason for each row. The usual causes:

- **The header does not match the schema.** The column names must be the
  field names of the entity. Check the export from the same entity type for
  the correct list.
- **A value has the wrong type.** A date must be `YYYY-MM-DD`, a number must
  be a number, a boolean must be `true` or `false`.
- **A required field is empty.** The preview names it.

An exported file always imports cleanly, so exporting a known-good file and
comparing is the fastest way to find the difference.

## A client cannot see a record another device created

The client pulls changes on a schedule. If the other device's change has not
arrived yet, force a sync with the **Sync now** button.

If a sync does not bring it, the client's cursor may be older than the retained
change log — the server tells the client this and the client takes a fresh
snapshot automatically. If the record still does not appear, check that it was
not deleted, and check the server directly:

```bash
curl -s http://localhost:8080/api/v1/students/ADM-001
```

## The database is growing

Check the change log:

```sql
SELECT COUNT(*), MIN(seq), MAX(seq) FROM changes;
```

If the log is large, the clients are not reporting their progress. The prune
only runs below the oldest cursor among clients that checked in recently:

```sql
SELECT client_id, cursor, last_seen_at FROM sync_clients ORDER BY last_seen_at;
```

A device that has been decommissioned should be deleted from `sync_clients`.

To reclaim space after a large deletion:

```bash
sqlite3 /var/lib/school/school.db "VACUUM INTO '/var/lib/school/backups/rebuilt.db'"
# stop the service, replace school.db with rebuilt.db, start the service
```

## Getting a diagnostic bundle

```bash
curl -s http://localhost:8080/api/v1/health
curl -s http://localhost:8080/api/v1/meta
sqlite3 /var/lib/school/school.db "PRAGMA integrity_check;"
sqlite3 /var/lib/school/school.db "SELECT version, name, applied_at FROM schema_migrations;"
sqlite3 /var/lib/school/school.db "SELECT client_id, cursor, last_seen_at FROM sync_clients;"
journalctl -u school --since "1 hour ago"
```

Include the client-side symptoms: what the outbox panel shows, and the browser
console output.
