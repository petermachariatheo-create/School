# School Manager

An offline-first, modular school management system. A school runs one server on
its own network; teachers and administrators use an installable web app on their
phones, tablets and laptops that keeps working when the network does not.

```
┌──────────────┐        HTTPS / LAN        ┌────────────────────────────┐
│  PWA client  │ ────────────────────────► │  School server             │
│  (browser)   │ ◄──────────────────────── │  Node 24 + node:sqlite     │
│              │   cursor-based change feed│                            │
│  IndexedDB   │                           │  SQLite (authoritative)    │
│  replica +   │                           │                            │
│  durable      │                           │  REST API + OpenAPI 3.1    │
│  outbox      │                           │  CSV / JSON / NDJSON I/O   │
└──────────────┘                           └────────────────────────────┘
```

## What it does today

- **Ten entity types** — students, guardians, student-guardian links, classes,
  enrolments, attendance, assessments, assessment results, invoices and
  payments — all driven from one registry, so the API, the sync engine, the
  import/export pipeline, the OpenAPI document and the client forms are all
  generated from a single schema source.
- **A complete offline path.** Every client read comes from an IndexedDB
  replica. Every client write goes into a durable outbox before the interface
  acknowledges it. The service worker caches the application shell only; API
  responses are never cached, because the replica is the client's source of
  truth.
- **Server-authoritative synchronisation.** Clients pull a cursor-based change
  feed and push idempotent, client-minted operations. Conflicts are resolved
  per field, and the server reports exactly which fields it kept.
- **Interoperability.** CSV import with a preview-then-apply workflow, CSV,
  JSON and NDJSON export, and a generated OpenAPI 3.1 document.
- **A Windows installer.** One file that a school downloads and runs. It
  carries the Node runtime, the server and the client, creates the shortcuts,
  makes a certificate for the machine's addresses, and starts the
  application.

## Getting started

```bash
npm install
npm run seed          # optional: a plausible school to look at
npm run dev:server    # http://localhost:8080
npm run dev:web       # http://localhost:5173 (proxies /api to the server)
```

For a production-shaped run, build the client and let the server host it:

```bash
npm run build
npm start -w @school/server   # one process, one port, API + app
```

For the Windows installer:

```bash
npm run package       # builds dist/windows/SchoolManager-Setup.exe, then checks it
```

Full instructions are in [`docs/development/getting-started.md`](docs/development/getting-started.md).

## Verification

```bash
npm run verify
```

runs, in order: lint, format check, type check, the test suite, the contract
check and the build. The individual pieces can be run on their own; see
[`docs/development/testing.md`](docs/development/testing.md).

The Windows package has its own check, `npm run check:package`, which starts
the built artefact and asserts that it works. It is separate from `verify`
because it needs the package to have been built.

## Layout

| Path              | Contents                                                                     |
| ----------------- | ---------------------------------------------------------------------------- |
| `packages/shared` | Domain model, Zod schemas, wire contracts, CSV/JSON codecs.                  |
| `packages/server` | HTTP API, sync engine, SQLite repositories, migrations.                      |
| `packages/web`    | React PWA: IndexedDB replica, durable outbox, sync client, UI.               |
| `scripts`         | Contract check, package check, Windows build, performance harness.           |
| `tools/windows`   | The launcher and the installer.                                              |
| `docs/`           | Architecture, decisions, integrations, operations, performance, development. |

## Documentation

- [`docs/implementation-report.md`](docs/implementation-report.md) — what was built, what was measured, what was left out.
- [`docs/architecture/`](docs/architecture/) — how the system is put together.
- [`docs/decisions/`](docs/decisions/) — the decisions and their reasons.
- [`docs/integrations/`](docs/integrations/) — CSV, JSON, NDJSON, OpenAPI, external systems.
- [`docs/operations/`](docs/operations/) — installing, running, backing up, troubleshooting.
- [`docs/performance/`](docs/performance/) — measured numbers and how to tune them.
- [`docs/development/`](docs/development/) — working on the codebase.
