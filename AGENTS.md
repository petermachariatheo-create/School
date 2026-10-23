# AGENTS.md

Engineering rules for this repository. They are short on purpose: the detail
lives in [`docs/`](docs/), and this file only says what to do and where to
look.

## What this is

An offline-first school management system. One authoritative server on the
school's own network, and an installable web app that keeps working when the
network does not. There is no cloud, no licence server and no database
server, and nothing here may introduce one without a decision record.

## Before you start

1. Read [`docs/development/working-on-the-codebase.md`](docs/development/working-on-the-codebase.md).
   It has the module map, the conventions and the honest list of gaps.
2. Check [`docs/decisions/`](docs/decisions/). Several decisions look
   arbitrary until you know why they were made.
3. Reuse what is there. The entity registry, the schema-driven forms, the
   sync engine and the import pipeline are all generic on purpose: an entity
   type is a registry entry and a schema, not a new set of routes.

## The rules that matter

- **The server is authoritative.** Clients never decide the outcome of a
  conflict, and the server never trusts a client's revision, timestamps or
  identifiers.
- **The shared package has no I/O.** It must import cleanly in a browser, in
  the server and in a script. No filesystem, no network, no clock reads.
  `packages/shared/src/time.ts` returns the time rather than reading it.
- **One schema source.** Zod in `packages/shared` defines the domain, and the
  JSON Schema, the OpenAPI document, the CSV columns and the client forms are
  derived from it. Never write a second copy of a shape.
- **No per-entity code.** No `if (type === "student")`. If the registry cannot
  express it, extend the registry.
- **Comments explain why.** The code says what it does.
- **Errors carry a code, not a message.** Codes are a fixed table in
  `packages/shared/src/contracts/errors.ts`; the `detail` text is for a person.
- **Never break stored data.** A migration that has been applied is never
  edited. A correction is a new migration. Deleting a user's records to
  simplify the implementation is never acceptable.
- **Treat every input as untrusted.** Imported files, request bodies and
  remote payloads are validated against the schema before they are used.

## Verify before you claim

```bash
npm run verify
```

runs lint, format check, type check, the test suite, the contract check and
the build. It is the gate; a change is not finished until it passes.

| Task                   | Command                                          | Why                                                      |
| ---------------------- | ------------------------------------------------ | -------------------------------------------------------- |
| everything             | `npm run verify`                                 | The gate before calling a change done.                   |
| one package's tests    | `node --test "packages/<pkg>/test/**/*.test.ts"` | Faster while iterating.                                  |
| the published contract | `npm run contract:check`                         | The API and the shared schema must agree.                |
| performance            | `npm run perf`                                   | Needs a quiet machine; it asserts its own budgets.       |
| the Windows installer  | `npm run package`                                | Builds it and then checks the built artefact end to end. |

Run the narrowest check that proves the change, then the whole gate before
finishing.

## The Windows package is a separate deliverable

`npm run build:windows` produces `dist/windows/SchoolManager-Setup.exe`. It
bundles the server, copies the built client, ships the Node runtime and
compiles a launcher. It is not the same thing as the repository, and a change
can pass every test and still be missing from it.

So the package has its own check, `npm run check:package`, which starts the
packaged server exactly as the launcher does and asserts that it answers,
identifies itself, writes down its port, serves the client, stores a record,
and runs the background checkpointer. Run it after any change that touches
the server, the client build, the launcher or the build script.

## What to leave alone

- `node:sqlite` is a release candidate: it is isolated behind the repository
  layer in `packages/server/src/db/`, and the Node patch version is pinned.
- The write-ahead log is checkpointed from a worker thread. The worker script
  is loaded by path, so it must exist next to the server bundle in a package
  as well as in the source tree.
- The service worker caches the application shell only. API responses are
  never cached: the client's replica is its source of truth, and a second,
  disagreeing copy of the data is worse than no copy.

## Reporting

When a task is finished, say what changed, why that approach was chosen, what
verification actually ran, the trade-offs, and the next most valuable step.
Use measured numbers, not estimates. Do not invent a next step when the task
is complete.
