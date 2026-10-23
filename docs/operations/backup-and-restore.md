# Backup and restore

The database is one file. That is the single biggest operational advantage of
this design: backing up a school's data is copying a file, and restoring it is
copying a file back.

## What to back up

```
<data-dir>/
  school.db         the database
  school.db-wal     the write-ahead log (if the server is running)
  school.db-shm     the shared-memory index (if the server is running)
```

**The `-wal` file matters.** SQLite in WAL mode keeps recently committed
transactions in the log until a checkpoint moves them into the main database
file. Copying `school.db` while the server is running can produce a backup
that is missing the last few transactions.

## The safe way: `VACUUM INTO`

SQLite's `VACUUM INTO` writes a consistent, complete copy of the database to a
new file in a single transaction. It works while the server is running, it
includes everything from the write-ahead log, and the result is a single file
with no sidecars.

```bash
sqlite3 /var/lib/school/school.db \
  "VACUUM INTO '/var/lib/school/backups/school-$(date +%Y%m%d-%H%M%S).db'"
```

Or from Node, using the same driver the server uses:

```bash
node --input-type=module -e "
  import { DatabaseSync } from 'node:sqlite';
  const db = new DatabaseSync('/var/lib/school/school.db', { readOnly: true });
  db.exec(\"VACUUM INTO '/var/lib/school/backups/school-\$(date +%Y%m%d-%H%M%S).db'\");
  db.close();
"
```

The backup directory is created automatically by the server's data directory
setup; create `backups/` inside it if it does not exist.

### Restoring from a `VACUUM INTO` backup

```bash
sudo systemctl stop school
cp /var/lib/school/backups/school-20261020-083000.db /var/lib/school/school.db
rm -f /var/lib/school/school.db-wal /var/lib/school/school.db-shm
sudo systemctl start school
```

The `-wal` and `-shm` files must be removed. They belong to the database that
was replaced, and leaving them would make SQLite replay the old log over the
restored file.

## The quick way: stop the server and copy

```bash
sudo systemctl stop school
cp /var/lib/school/school.db /var/lib/school/backups/school-$(date +%Y%m%d-%H%M%S).db
sudo systemctl start school
```

Simple and safe, but it means the service is down for the duration of the copy.
For a database of a few megabytes that is a second or two.

## Automating it

A daily backup, with retention:

```bash
#!/usr/bin/env bash
set -euo pipefail

DATA_DIR="${SCHOOL_DATA_DIR:-/var/lib/school}"
BACKUP_DIR="$DATA_DIR/backups"
KEEP_DAYS=30

mkdir -p "$BACKUP_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
TARGET="$BACKUP_DIR/school-$STAMP.db"

sqlite3 "$DATA_DIR/school.db" "VACUUM INTO '$TARGET'"
gzip -9 "$TARGET"

find "$BACKUP_DIR" -name 'school-*.db.gz' -mtime "+$KEEP_DAYS" -delete
```

Run it from cron:

```
17 2 * * * /usr/local/bin/school-backup >> /var/log/school-backup.log 2>&1
```

The time is deliberately not on the hour: a school server is usually also
doing its nightly checkpoint around then.

## Off-site copies

A backup on the same disk as the database protects against a mistake, not
against a fire. Copy the backups somewhere else:

```bash
rsync -avz --delete /var/lib/school/backups/ user@offsite:/backups/school/
```

An encrypted, off-site copy is the only one that survives the loss of the
machine.

## Restoring onto a different machine

1. Install Node 24 and the application.
2. Put the backup at `<data-dir>/school.db`.
3. Remove any `school.db-wal` and `school.db-shm` files.
4. Start the server. It will open the database, find the schema version in
   `schema_migrations` and apply only the migrations that are newer.

## Verifying a backup

A backup that has never been restored is a hypothesis, not a backup.

```bash
sqlite3 backups/school-20261020-083000.db "PRAGMA integrity_check;"
sqlite3 backups/school-20261020-083000.db "SELECT COUNT(*) FROM students;"
```

`integrity_check` should print `ok`. The record counts should be plausible.

To restore onto a copy and start the server against it, without touching the
live database:

```bash
cp backups/school-20261020-083000.db /tmp/check.db
SCHOOL_DATA_DIR=/tmp/check-dir node packages/server/src/index.ts
```

## What is not backed up

The **client replicas** are not backed up, and do not need to be: they are
derived data. A client that loses its replica takes a snapshot from the server
and is up to date again.

The **change log** is part of `school.db`, so it is backed up with everything
else. It is pruned automatically once every client has caught up.
