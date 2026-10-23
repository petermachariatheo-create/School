# 0003 — The built-in `node:sqlite` module, not a driver dependency

**Status:** accepted

## Context

The server needs a SQL database. It runs on the school's own hardware, which
is usually a modest laptop, and it must be installable by a non-specialist.

The choices were a native driver (`better-sqlite3`, `sqlite3`), a pure-JavaScript
engine (SQL.js, which keeps the whole database in memory and writes it out
periodically), or the SQLite module built into Node.

## Decision

Use `node:sqlite`, the SQLite binding built into Node, and confine every
access to it behind the repository layer in `packages/server/src/db/`.

The server requires Node 24 or later.

## Consequences

**Good.**

- No native compilation step, so installation is `npm install` on any machine
  with a supported Node, with no build tools and no compiler.
- No native module to rebuild when Node is upgraded.
- SQLite is a single file. A school can copy the database onto a USB stick.
- `node:sqlite` is synchronous, which matches SQLite's own model and keeps the
  transaction handling straightforward: there is no await point inside a
  transaction that could let another writer interleave.

**Bad, and accepted.**

- `node:sqlite` is **Stability 1.2, Release Candidate**. The API may still
  change. This is the main reason every call to it lives in
  `packages/server/src/db/`: the blast radius of an API change is one
  directory, and the repository interface is the seam where a different driver
  could be substituted.
- The Node patch version must be pinned in deployment, because a release
  candidate's behaviour can change between releases. The operations guide
  records the version the system was verified against.
- The API is synchronous, so a long write blocks the event loop. For a school
  server this is the right trade — writes are short, and the alternative is a
  connection pool and a set of concurrency bugs.

## Consequences for testing

Tests use a real SQLite **file** in a temporary directory, not an in-memory
database, so that WAL behaviour, transaction semantics and file-level
durability are exercised as they are in production. See
`packages/server/test/helpers.ts`.

## Alternatives considered

**`better-sqlite3`.** Rejected. It is faster and more mature, but it needs a
native build on every install, and it fails on machines without a compiler —
which is exactly the machine a school administrator will use.

**SQL.js.** Rejected. The whole database lives in memory and is written out on
a schedule, which would lose the last few seconds of work on a power cut and
make the database size bounded by RAM.

**PostgreSQL.** Rejected. It needs a separate service to install, maintain and
back up. The whole point of this system is that it runs from one process on one
machine.
