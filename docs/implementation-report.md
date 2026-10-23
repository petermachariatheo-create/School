# Implementation report

This is the report on the system as it now stands: what was built, how it is
put together, what was measured, how it was verified, and what was
deliberately left out.

## Summary

An offline-first school management system, delivered as three workspaces
around one shared domain model.

|                     |                                                                                                               |
| ------------------- | ------------------------------------------------------------------------------------------------------------- |
| Entity types        | 11, driven from a single registry                                                                             |
| API                 | 97 operations over 67 paths: 9 per entity type (90), plus 7 for health, metadata, OpenAPI and synchronisation |
| Tests               | 276 in 40 suites, all passing                                                                                 |
| Contract assertions | 152 across 11 entity types, checked against the live server                                                   |
| Package assertions  | 17 against the built Windows installer, checked by running it                                                 |
| Source              | ~10 000 lines of TypeScript and TSX                                                                           |
| Runtime             | Node 24, no build step on the server, no external services                                                    |
| Verification        | `npm run verify` — lint, format, type check, tests, contract check, build                                     |

There is no cloud dependency, no per-seat licence, no database server, no
container to orchestrate, and no separate front-end deployment. A school runs
`node packages/server/src/index.ts` on a laptop, and every device on the
network opens the same address.

## What was built

### One domain model, shared by both sides

`packages/shared` holds the domain: Zod schemas for students, guardians,
student-guardian links, classes, enrolments, attendance, assessments,
assessment results, invoices and payments, plus the wire contracts, the CSV,
JSON and NDJSON codecs, and a local ULID implementation.

The entity registry (`packages/shared/src/registry.ts`) is the single table
that maps each entity type to its storage table, its validation schema, its
REST path and its business key. Both the client and the server read it. Adding
an entity type means adding one entry to the registry and one schema file —
the API routes, the sync feed, the import/export pipeline, the OpenAPI
document and the client forms all follow from it. There is no generated-client
step and no hand-written DTO layer, so a schema change cannot be half-applied.

The registry also says which fields the **server works out**. An invoice's
total is the sum of its line items, so a client is never asked for it: the
create and patch schemas leave it out, the sync engine drops it from a
client's patch, the server computes it on every write, and the client shows
it as a figure it cannot type — worked out there with the same rule, so an
offline device shows the total the invoice will have. A file that states a
total which disagrees with its own line items is reported to the person who
made it rather than quietly corrected.

It also says which fields are **totals of other records**. An invoice's amount
paid is the sum of the payments received against it, and only the server sees
every payment, so the server keeps that figure right: it recomputes it after
every write — of the invoice, and of any payment — inside the same
transaction, so a payment and the new figure reach the clients together.
Neither the total nor the amount paid may be stated by a client or by a
file.

And it says which fields are **decided by the server, except where a person
has chosen**. An invoice's status is a draft or a void one because the
school said so, and that decision stands; whether the money has arrived and
whether the invoice is late follow from the payments and the date, and the
server works them out. The rule is applied on every write, and once a day by
a sweep, because an invoice that fell due yesterday is overdue today and no
write happened to say so. The shared package never reads a clock: the rule
is handed the day it is applied for, so the same rule can be applied for any
date and tested without waiting for one.

### The server

`packages/server` is a single Node process.

- **`src/http/`** — a small router, request validation, RFC 9457 Problem
  Details for every error, static file serving for the built client, and
  OpenAPI 3.1 generation from the registry.
- **`src/db/`** — migrations, one generic repository that serves every entity
  type, a prepared-statement cache, the totals the server keeps up to date,
  the background checkpointer and the daily sweep.
- **`src/sync/`** — the change feed, the idempotent push path and the
  conflict model.
- **`src/interop/`** — CSV, JSON and NDJSON export, and CSV import with a
  preview-then-apply workflow.

### The client

`packages/web` is a React 19 progressive web application.

- **`src/data/`** — the IndexedDB schema, the local replica and the durable
  outbox.
- **`src/sync/engine.ts`** — the client half of the synchronisation protocol.
- **`src/app/`** — application state, schema-driven form definitions, the
  form's rules, the catalogue of entity groups, paging, and offline CSV
  export.
- **`src/ui/`** — the button and the icon set.
- **`src/components/`** — the interface, which is itself schema-driven.

A record is edited on a page of its own, the record workspace, rather than
in a panel over the table: a form is a page, and a form crammed into a
drawer is a form that gets abandoned. The rules of the form live in
`src/app/form.ts` as plain functions, so they can be tested without a
browser, and the sections of the form come from the catalogue in
`src/app/catalog.ts`.

The service worker caches the application shell only. API responses are never
cached, because the replica is the client's source of truth, and a stale API
response would be a second, disagreeing copy of the data.

## How the offline path works

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

Every client read comes from the IndexedDB replica, never from the network.
Every client write is durable before the interface acknowledges it.

The server is authoritative. Conflicts are resolved per field, last change
wins, and the server tells the client exactly which fields it kept — a rule
an administrator can explain in one sentence. See
[decision 0001](../decisions/0001-server-authoritative.md) and
[decision 0002](../decisions/0002-sync-conflict-model.md).

## The Windows package

`npm run build:windows` produces `dist/windows/SchoolManager-Setup.exe` — one
file that a school downloads and runs. It contains the server bundled into a
single JavaScript file, the built client, the Node runtime, a launcher that
starts the server and opens the browser, and an installer that copies the
files, creates the shortcuts, makes a certificate for the machine's addresses
and starts the application.

| Artefact                     | Size    | What it is                                         |
| ---------------------------- | ------- | -------------------------------------------------- |
| `SchoolManager-Setup.exe`    | 33.7 MB | The installer. One file, nothing to install first. |
| `SchoolManager-portable.zip` | 33.4 MB | The same payload, unpacked by hand.                |

The package is a separate deliverable from the repository, and it has its own
check: `npm run check:package` starts the packaged server with the packaged
Node runtime, exactly as the launcher starts it, and asserts that it answers,
identifies itself, writes down its port, serves the client application, stores
a record and is running the background checkpointer.

That check exists because of a defect that no repository test could have
found. See below.

## The engineering that was not obvious

Five things in this build took more than they appeared to, and each is
documented where an engineer would look for it.

### The push path applies a batch in one transaction, with a savepoint per operation

The first version ran each operation in its own transaction, so that one
invalid operation could not discard the rest of the batch. That cost 12× on
the write path: a p50 of 326.6 ms and a p95 of 1 352 ms for a 50-operation
batch.

The batch is now applied in **one transaction**, with a **savepoint per
operation**. The savepoint preserves the original guarantee — an invalid
operation is rejected on its own and does not discard the rest — while the
batch as a whole becomes atomic. A client that retries after a timeout can no
longer end up with half a batch applied twice.

Measured, same workload:

|                       | Before     | After   |
| --------------------- | ---------- | ------- |
| `push operations` p50 | 326.6 ms   | 26.9 ms |
| `push operations` p95 | 1 352.5 ms | 48.3 ms |

### A prepared-statement cache

`node:sqlite` compiles a statement on every `prepare` call, and the hot paths
ran the same handful of statements over and over. Caching the compiled
statements roughly halved the cost of a write: 0.65–0.93 ms per pushed
operation became 0.21–0.44 ms.

### The write-ahead log was moved off the request path

This was the largest remaining source of latency and the hardest to diagnose,
because the symptom did not look like a checkpoint at all.

Copying the write-ahead log into the database file is disk-bound work whose
duration depends on how quickly the operating system flushes writes. On the
reference machine that varies from a few milliseconds to well over a second.
SQLite performs the checkpoint inside whichever write happened to trigger it,
so that write waits for the whole copy — and because `node:sqlite` is
synchronous, it holds the event loop while it waits, so every other request
waits too.

Measuring the write path alone across seven checkpoint sizes showed the
shape of the problem clearly:

| `wal_autocheckpoint` | p50     | p95      | max      | writes over 20 ms | total for 3 000 writes |
| -------------------- | ------- | -------- | -------- | ----------------- | ---------------------- |
| 64                   | 0.26 ms | 15.09 ms | 98 ms    | 17                | 7 957 ms               |
| 128                  | 0.18 ms | 14.42 ms | 1 524 ms | 8                 | 5 810 ms               |
| 256                  | 0.22 ms | 3.64 ms  | 404 ms   | 36                | 4 552 ms               |
| 512                  | 0.21 ms | 0.64 ms  | 1 622 ms | 40                | 4 694 ms               |
| 1 000                | 0.19 ms | 0.45 ms  | 440 ms   | 26                | 2 990 ms               |
| 2 000                | 0.18 ms | 0.54 ms  | 144 ms   | 13                | 2 106 ms               |
| 4 000                | 0.21 ms | 0.56 ms  | 1 331 ms | 6                 | 2 877 ms               |

The number of long pauses is roughly constant across every setting, and the
longest pause varies by an order of magnitude between runs of the _same_
setting. **Tuning the checkpoint size is tuning around a noisy underlying
cost, not fixing it.**

The fix was to move the work off the request path. The server now runs the
checkpoint from a **worker thread** (`packages/server/src/db/checkpointer.ts`)
that holds its own connection and issues a `PASSIVE` checkpoint every five
seconds. A passive checkpoint copies what it can without waiting for readers
or writers, and gives up quietly if a reader is still using an old snapshot.

`SCHOOL_WAL_AUTOCHECKPOINT` remains as a safety net (4 000 pages, 16 MiB) for
the case where the worker cannot start: the log is still bounded, at the cost
of the occasional long pause.

The effect, four consecutive runs of the harness:

|                       | Run 1   | Run 2   | Run 3   | Run 4   |
| --------------------- | ------- | ------- | ------- | ------- |
| `push operations` p50 | 15.6 ms | 19.0 ms | 16.7 ms | 14.8 ms |
| `push operations` p95 | 30.4 ms | 25.4 ms | 31.9 ms | 23.8 ms |
| `push operations` max | 30.4 ms | 25.4 ms | 31.9 ms | 23.8 ms |

Before the change, a single run had produced a `push operations` p95 of
733 ms. The variance is gone.

### The business fields live in a JSON column

Identity, revision, timestamps and the change-feed sequence are real columns,
so they can be indexed and filtered in SQL without parsing JSON. The business
fields are a JSON column, so one repository serves every entity type.

The cost is that a filter on a business field — `status`, `admission_date` —
uses `json_extract` and cannot use an index. At 2 000 students that is
irrelevant. At 200 000 it would not be, and the fix is to promote the hot
fields to real columns in a migration. This is recorded in
[tuning](performance/tuning.md#when-a-school-outgrows-the-defaults) as the
first thing to change if a school outgrows the defaults.

### The interface is now navigable by phone

The browser's back button — and the swipe-back gesture on a phone — now works
throughout the application. The place the user is in (which list, which record,
which panel) is kept in the browser's history, so back means back. Opening a
record, switching the entity type, opening a panel all add a history entry, and
the back gesture returns to the previous one.

The values a person chooses from are now shown as words: "Partially paid"
rather than "partially_paid", "Mobile money" rather than "mobile_money". A
value in capitals is a code (KES, USD) and is left as it is.

The invoice table now shows the amount paid and the due date, and a column
that points at another record — the student, the class, the invoice — says
which record it is, using the name the person knows rather than the
identifier the database uses.

On a phone the topbar keeps to one row: the cursor, the time and the subtitle
are hidden so the brand and the actions stay in one row. The sidebar is a
single scrolling strip of entity types rather than a tall list of groups.

### The student list is a list of cards

The student and the guardian are shown as **cards in a grid** rather than as
columns in a table, because a person looking for a student is looking for a
name rather than a row. Each card has the same shape — the context and the
edit button above, the name, one status badge, a divider, and the facts
below — so that a page of people can be scanned down the middle instead of
read. The cards in a row are the same height, so their footers line up. One
card is shown on a phone, two on a tablet, and as many as the width allows
on a desktop. A dense table of the same people is one click away for
somebody who wants the columns instead.

The page itself now has a heading ("Students"), a sentence saying what the
page is for, and the count, with the primary action beside them; the search
sits across the width below, with the view controls and the overflow menu
grouped on the right.

The rules behind all of this are in
[`ui-ux-principles.md`](ui-ux-principles.md), and
`scripts/inspect-client.mjs` opens the client in a headless browser and takes
pictures of it at three widths, so that the layout can be checked without a
person in the loop.

### A timetable is a week, not a list of rows

A school week is the shape a school thinks in: five days, and the lessons that
fall in them. The lessons are their own records — a class does not keep its
timetable on itself, because the same class is taught by different teachers
in different subjects, and a teacher teaches several classes — so a class's
week and a teacher's week are read from the same lessons.

**Timetables** in the navigation shows the week as a grid, the way a
timetable is written on a wall: the days down the left, the times across the
top, and each lesson in the slot it belongs to. The classes are listed
collapsed, and choosing one opens its week; a teacher can be chosen instead,
which answers "what am I teaching". The day it is today is marked. On a
phone the grid keeps its shape and scrolls sideways, because a timetable
that folds up is not a timetable.

A class's profile shows its week, and a student's shows the week of the
classes they are enrolled in — which is what "what do I have today" means.

### A student is read before it is changed

The student, the guardian and the class lists open a **profile**: who the
record is, what state it is in, the facts in the groups the school thinks
in, and the records that point at it. Changing it is one click away, and a
new record opens straight into the form, ready to be typed into.

The form and the profile are built from the same pieces, so that every
record type looks and behaves the same. A field that points at another
record — a student, a class, an invoice — is asked for by name, with a
searchable list, rather than by an identifier: the client holds the whole
school, so it can offer the names. Leaving a form that holds unsaved work is
asked about, whichever way the person leaves, including the back gesture on
a phone.

The student is the first record type to have a profile; the audit of the
forms, and what has to be kept working, is in
[`development/forms-audit.md`](development/forms-audit.md).

## Verification

The Windows package bundles the server, copies the built client, ships the
Node runtime and compiles a launcher. A change can pass every test in the
repository and still be missing from it, and that is exactly what happened.

The packaged server referred to the checkpoint worker by its source name,
`checkpointer-worker.ts`. The bundle contained no such file, so the worker
could not start — and it could not start **quietly**: the server only checked
whether the worker had failed immediately after starting it, and the failure
arrives asynchronously, so the check was always false and nothing was
logged. The installed application fell back to checkpointing inside a write,
which is the pause the worker thread exists to remove.

The launcher's part was to make it look like the server was not running at
all. It waited for the server to answer, with a 400 ms budget, and the
server — copying a 263 KB write-ahead log into the database file on a
Windows laptop — sometimes took longer than that. The result was an
application that was running, serving requests, and had told the user it
could not start. The log said it all:

```
12:00:01.363  the server is already running on 8080
12:00:48.375  the server answered on port 0
12:00:48.375  the server did not answer in time
```

Three changes fix it, and two of them would have prevented it:

- **The worker script is bundled**, and the server looks for the file that is
  actually there rather than the one it expects. A packaged server and a
  source server now run the same code by the same route.
- **A failed worker is reported.** The checkpointer tells the server when it
  cannot run, and the server writes it to the log, where the person who can
  fix it will find it.
- **The launcher believes the port file.** The server writes down the port it
  is listening on once it is listening; a port file naming a port that
  answers is evidence, and a marker check that times out is not evidence
  against it. The readiness budget also went from 400 ms to 2 500 ms.

The launcher now reports the server two and a half seconds after starting it,
where before it reported failure after fifty.

`npm run check:package` exists so that the next defect of this kind is
caught by a command rather than by a school. It runs the built artefact, and
it fails if the worker is missing — verified by removing the file and
watching the check fail.

## Verification

`npm run verify` runs, in order: lint, format check, type check, the test
suite, the contract check and the build.

| Step                         | What it proves                                                                                                                               | Result |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| `oxlint`                     | No correctness errors, and the deliberate warnings are the only ones.                                                                        | pass   |
| `oxfmt --check`              | All 127 files are formatted consistently.                                                                                                    | pass   |
| `tsc --noEmit`               | All three packages type check under `strict`, `noUncheckedIndexedAccess`, `noUnusedLocals`, `noUnusedParameters` and `verbatimModuleSyntax`. | pass   |
| `node --test`                | 276 tests in 40 suites.                                                                                                                      | pass   |
| `scripts/check-contracts.ts` | 152 assertions across 11 entity types, checked against the running server.                                                                   | pass   |
| `npm run build`              | The client builds; the service worker precaches 12 entries.                                                                                  | pass   |

The package has a check of its own, outside `verify` because it needs the
package to have been built:

| Step                       | What it proves                                                                                                                                                 | Result |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| `scripts/check-package.ts` | 17 assertions against the built package: it answers, identifies itself, writes its port, serves the client, stores a record and checkpoints in the background. | pass   |

The contract check is worth singling out: it starts the real server and
asserts that each entity type's list, read, create, update, delete, export
and sync behaviour matches the published contract. A change that broke one
entity type's contract would fail it even if every unit test still passed.

The performance harness (`npm run perf`) is separate from `verify`, because it
needs a quiet machine to mean anything. It asserts its own budgets and exits
non-zero if any operation exceeds them.

## What is deliberately not there

- **Authentication and roles.** The server trusts the network. The
  authoritative model assumes the server runs on a network only the school
  can reach. Adding authentication is a well-understood piece of work, but it
  is a different product decision, and a half-built version of it is worse
  than none.
- **Request logging.** The router has a single dispatch point, so adding one
  is easy. It is absent on purpose: a school server's request log would
  contain every record id and query, which is more personal data than a log
  file needs to hold.
- **Prometheus metrics.** The health endpoint and direct SQL cover a school
  deployment. The natural place to add metrics is the router's dispatch point,
  where the method, path, status and duration are all known.
- **Promoting business fields to columns.** See above.
- **Parallelism and a connection pool.** The server is single-threaded and
  `node:sqlite` is synchronous, so there is nothing to pool. A p50 of 13 ms
  leaves plenty of headroom for a school.

## Where to look

| Question                       | Document                                                                      |
| ------------------------------ | ----------------------------------------------------------------------------- |
| How is it put together?        | [architecture/overview.md](architecture/overview.md)                          |
| How does synchronisation work? | [architecture/synchronisation.md](architecture/synchronisation.md)            |
| Why is it built this way?      | [decisions/](decisions/) — eleven numbered decisions                          |
| What are the numbers?          | [performance/benchmarks.md](performance/benchmarks.md)                        |
| How do I change a setting?     | [performance/tuning.md](performance/tuning.md)                                |
| How do I install it?           | [operations/deployment.md](operations/deployment.md)                          |
| How do I back it up?           | [operations/backup-and-restore.md](operations/backup-and-restore.md)          |
| What is wrong?                 | [operations/troubleshooting.md](operations/troubleshooting.md)                |
| How do I add an entity type?   | [development/adding-an-entity-type.md](development/adding-an-entity-type.md)  |
| How do I work on it?           | [development/getting-started.md](development/getting-started.md)              |
| What are the rules?            | [`../AGENTS.md`](../AGENTS.md) — for anyone working on the code, human or not |
