# Getting started

## Requirements

- **Node.js 24 or later.** The server executes TypeScript directly and uses the
  built-in `node:sqlite` module. Check with `node --version`.
- **npm 10 or later** (it ships with Node 24).

Nothing else. There is no compiler to install, no database server to provision
and no container runtime.

## Install

```bash
git clone <repository> school
cd school
npm install
```

`npm install` installs the workspace: the shared package, the server and the
web client. It does not install a native module, because the database driver
is built into Node.

## Run it

Two terminals, or two background processes:

```bash
# terminal 1 — the API and the database
npm run dev:server

# terminal 2 — the client, with hot reloading
npm run dev:web
```

Open <http://localhost:5173>. The development server proxies `/api` to the
server on port 8080.

The server creates the database and applies the migrations on first start:

```
[school] listening on http://0.0.0.0:8080
[school] database C:\school\data\school.db
[school] change cursor 0
```

## Fill it with something

The database starts empty, which is not much fun to look at. The seed script
writes a plausible school:

```bash
npm run seed
```

It creates 120 students, guardians, links, five classes, enrolments, a term of
attendance, assessments with results, and twenty invoices with part payments.
It refuses to run twice unless given `--force`.

```bash
npm run seed -- --students 500 --force
```

## The production shape

Build the client and let the server host it — one process, one port:

```bash
npm run build
npm start -w @school/server
```

Open <http://localhost:8080>.

## The tests

```bash
npm test
```

225 tests across the shared package, the server and the client. See
[testing](testing.md) for what they cover and how to write more.

## The full check

```bash
npm run verify
```

Lint, format check, type check, tests, contract check, build. This is the gate
that has to pass before anything is committed.

## The Windows installer

```bash
npm run package
```

builds `dist/windows/SchoolManager-Setup.exe` and then checks the built
artefact: it starts the packaged server with the packaged Node runtime, the
way the launcher starts it, and asserts that it answers, serves the client
and stores a record.

The build needs the .NET Framework C# compiler. If `csc.exe` is somewhere
unusual, point `SCHOOL_CSC` at it. See
[deployment](../operations/deployment.md#installing-on-a-schools-windows-machine)
for what the installer does on a school's machine.

## The workspace layout

```
school/
├── package.json          workspace root; every script the project has
├── packages/
│   ├── shared/           domain model, schemas, contracts, codecs
│   ├── server/           API, sync engine, SQLite, CLI
│   └── web/              React PWA
├── scripts/
│   ├── check-contracts.ts
│   ├── check-package.ts
│   ├── build-windows.ts
│   └── perf.ts
├── tools/windows/        the launcher and the installer, in C#
└── docs/
```

Every package is an npm workspace, so a change to `packages/shared` is picked
up by the server and the client without a build step.

## Useful scripts

| Command                  | What it does                                                |
| ------------------------ | ----------------------------------------------------------- |
| `npm run dev:server`     | The server with file watching.                              |
| `npm run dev:web`        | The client with hot reloading.                              |
| `npm run build`          | Type check the shared package and server, build the client. |
| `npm test`               | The whole test suite.                                       |
| `npm run test:watch`     | The same, in watch mode.                                    |
| `npm run typecheck`      | Type check every package.                                   |
| `npm run lint`           | `oxlint`.                                                   |
| `npm run lint:fix`       | `oxlint --fix`.                                             |
| `npm run format`         | `oxfmt`.                                                    |
| `npm run format:check`   | `oxfmt --check`.                                            |
| `npm run contract:check` | Assert that the published contract matches the shared one.  |
| `npm run perf`           | The performance harness.                                    |
| `npm run verify`         | All of the above, in order.                                 |
| `npm run build:windows`  | Build the Windows installer.                                |
| `npm run check:package`  | Check the built installer end to end.                       |
| `npm run package`        | Build the installer, then check it.                         |
| `npm run seed`           | Populate the database with a plausible school.              |

## Points of friction

**Node must be on the PATH as `node`.** The workspace has no version pinning
beyond the `engines` field, and npm does not enforce it by default.

**`node:sqlite` emits an experimental warning on some Node builds.** It is
expected; the module reached stability 1.2 in Node 24.

**The client needs a server to be useful.** The interface renders from the
local replica, which is empty until the first sync. The **Sync now** button
forces one.

## Where to go next

- [Working on the codebase](working-on-the-codebase.md)
- [Testing](testing.md)
- [Adding an entity type](adding-an-entity-type.md)
