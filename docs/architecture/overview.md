# Architecture

## The shape of the system

The school runs **one authoritative server** on its own network and **any number
of clients**. There is no cloud dependency and no per-seat licence. The server
holds the only copy of the data that matters; clients hold a _replica_ that they
can read and write without it.

```
                    ┌───────────────────────────────────────────┐
                    │            School server                  │
   ┌────────┐      │  ┌─────────────┐   ┌──────────────────┐  │
   │ Phone  │◄────►│  │ HTTP router │   │  Static handler  │  │
   ├────────┤      │  └──────┬──────┘   └──────────────────┘  │
   │ Tablet │◄────►│         │                                 │
   ├────────┤      │  ┌──────▼──────┐   ┌──────────────────┐  │
   │ Laptop │◄────►│  │ Sync engine│   │  Entity registry │  │
   └────────┘      │  └──────┬──────┘   └──────────────────┘  │
                    │         │                                 │
                    │  ┌──────▼──────────────────────────────┐ │
                    │  │ Repository layer (node:sqlite)      │ │
                    │  └──────┬──────────────────────────────┘ │
                    │         │                                 │
                    │  ┌──────▼──────┐                         │
                    │  │   SQLite    │  school.db (+ WAL)       │
                    │  └─────────────┘                         │
                    └───────────────────────────────────────────┘
```

A background worker thread holds a second connection to the same database and
checkpoints the write-ahead log every five seconds, so the copy of the log
into the database file happens off the request path. See
[the write path](../performance/tuning.md#write-pauses).

Both clients and the server share `packages/shared`, so a change to a domain
schema is immediately visible on both sides of the network. There is no
generated-client step and no hand-written DTO layer.

## Components

### `packages/shared` — the canonical model

Pure domain logic with no I/O. It contains:

- **Entity schemas** (`src/domain/`): Zod schemas for students, guardians,
  classes, enrolments, attendance, assessments, invoices, payments and the
  links between them.
- **The entity registry** (`src/registry.ts`): the single table that maps an
  entity type to its storage table, its validation schema, its REST path and
  its business key. It also says which fields the server works out, so a
  client is never asked for a value that follows from other values.
- **Wire contracts** (`src/contracts/`): request and response shapes, the
  error format and the synchronisation protocol.
- **Interop codecs** (`src/interop/`): RFC 4180 CSV, JSON and NDJSON.
- **Identifiers** (`src/ids/ulid.ts`): a local ULID implementation, so
  identifiers can be minted on an offline device and still sort by creation
  time.

### `packages/server` — the authoritative side

- **`src/http/`** — a small router, request validation, RFC 9457 Problem
  Details responses, static file serving and OpenAPI generation.
- **`src/sync/engine.ts`** — the change feed, the idempotent push path and the
  conflict model.
- **`src/db/`** — migrations, the generic entity repository, the statement
  cache and the background checkpointer.
- **`src/interop/`** — the export and import pipelines.

### `packages/web` — the client

- **`src/data/`** — the IndexedDB schema, the local replica and the durable
  outbox.
- **`src/sync/engine.ts`** — the client half of the synchronisation protocol.
- **`src/app/`** — application state, schema-driven form definitions, the
  form's rules, the catalogue of entity groups, paging and offline CSV
  export.
- **`src/components/`** — the interface.

## Data flow

### A read

The interface never waits on the network for data. It reads from the
IndexedDB replica, which the sync engine keeps up to date in the background.

### A write

```
User edits a form
      │
      ▼
Replica updated optimistically ── the interface shows the change at once
      │
      ▼
Outbox entry written ─────────── durable: survives a crash, a reload, a power cut
      │
      ▼
Sync engine pushes the operation ── POST /api/v1/sync/push
      │
      ├── accepted  → the outbox entry is removed
      ├── duplicate → the outbox entry is removed (the server already had it)
      ├── conflict  → the outbox entry is removed; the next pull brings the
      │                server's version of the conflicting fields
      └── rejected  → the outbox entry is marked failed and shown to the user
```

### The pull

After pushing, the client pulls `GET /api/v1/sync/changes?since=<cursor>` and
applies every change to the replica. The server tells the client when its
cursor is older than the retained change log; the client then takes a fresh
snapshot instead of assuming it can catch up incrementally.

## Storage

Every entity type uses the same table shape:

| Column       | Purpose                                                                    |
| ------------ | -------------------------------------------------------------------------- |
| `id`         | ULID, primary key. Sorts by creation time, so it is a valid keyset cursor. |
| `revision`   | Optimistic-concurrency token, incremented on every write.                  |
| `created_at` | When the record was first written.                                         |
| `updated_at` | When the record last changed.                                              |
| `deleted_at` | Soft-delete marker; `NULL` for a live record.                              |
| `seq`        | The change-feed sequence number at the time of the write.                  |
| `data`       | The business fields, as JSON.                                              |

Identity, revision and timestamps are separate columns so that they can be
indexed and filtered in SQL without parsing JSON; the business fields live in
`data` so that one repository serves every entity type. The repository is the
only writer and keeps the two representations consistent.

## Why the server is authoritative

A school has one set of books, one admission register and one set of fees.
Letting every device hold an equal claim to be the source of truth would mean
every offline conflict becomes a merge problem that a school administrator
would have to resolve by hand.

Making the server authoritative means:

- There is exactly one place where a record's revision is decided.
- A device that has been offline for a week can be brought up to date with one
  snapshot.
- Conflicts are resolved by a rule that can be explained in one sentence to
  an administrator: _the last change to a field wins, and the device that lost
  is told which fields it lost_.

See [`../decisions/0001-server-authoritative.md`](../decisions/0001-server-authoritative.md).

## Why the server computes the totals

An invoice's total is the sum of its line items. If a client states it, the
school has two answers to one question and no way to tell which one the
office meant. So the server works such a value out, and a client is never
asked for it: the create and patch schemas leave it out, the sync engine
drops it from a client's patch, the repository computes it on every write,
and the client shows it as a figure it cannot type.

An invoice's amount paid is a total of other records — the payments received
against it. Only the server sees every payment, so the server keeps that
figure right, and the client shows the server's last one rather than a guess
of its own.

An invoice's status is a decision and a consequence at once. A draft and a
void invoice are a decision the school made and the decision stands; whether
the money has arrived and whether the invoice is late are consequences, and
the server works them out. A value that follows from the passage of time
rather than from a write is worked out again once a day, so that an invoice
that fell due yesterday is overdue today.

See [`../decisions/0009-server-derived-fields.md`](../decisions/0009-server-derived-fields.md),
[`../decisions/0010-server-kept-totals.md`](../decisions/0010-server-kept-totals.md)
and
[`../decisions/0011-server-decided-statuses.md`](../decisions/0011-server-decided-statuses.md).

## Related documents

- [The domain model](data-model.md)
- [Synchronisation](synchronisation.md)
- [The client](client.md)
