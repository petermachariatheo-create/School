# Working on the codebase

## The shape of the code

```
packages/shared/src/
  ids/ulid.ts            ULID generation and parsing
  time.ts                time helpers
  domain/                the entity schemas, one file per area
  contracts/             wire contracts: API, errors, sync
  interop/               CSV, JSON and NDJSON codecs
  registry.ts            the entity registry

packages/server/src/
  config.ts              environment configuration
  index.ts               the entry point
  cli/seed.ts            the seed command
  db/
    database.ts          connection, pragmas, transactions, statement cache
    migrate.ts           the migration runner
    migrations.ts        the migrations themselves
    repository.ts        the generic entity repository
    aggregates.ts        the totals the server keeps up to date
    sweep.ts             the daily sweep over the values that follow from the date
  http/
    router.ts            path matching and dispatch
    routes.ts            route registration
    respond.ts           response helpers, Problem Details
    validate.ts          request validation
    openapi.ts           OpenAPI generation
    static.ts            static file serving
  sync/engine.ts         the change feed, the push path, the conflict model
  interop/
    exporters.ts         CSV, JSON and NDJSON export
    importers.ts         the CSV import pipeline

packages/web/src/
  data/
    db.ts                the IndexedDB schema
    replica.ts           the local replica
    outbox.ts            the durable outbox
  sync/engine.ts         the client half of the sync protocol
  api/client.ts          the HTTP client
  app/
    store.tsx            application state
    fields.ts            schema-driven form definitions
    form.ts              form state, validation and patch collection
    catalog.ts           groups, icons and the sections of a form
    pagination.ts        paging over a list held in the browser
    hooks.ts             hooks that read the replica
    export.ts            offline CSV export
  ui/
    Button.tsx           the button
    icons.tsx            the icon set
  components/            the interface

scripts/
  check-contracts.ts     the published contract against the shared one
  check-package.ts       the built Windows package end to end
  build-windows.ts       the Windows installer
  perf.ts                the performance harness

tools/windows/
  Launcher.cs            starts the server and opens the browser
  Installer.cs           unpacks the payload, makes the certificate
```

## Conventions

**Comments explain why, not what.** The code says what it does. A comment is
for the thing a reader would otherwise have to reconstruct: why a savepoint is
used, why a field is nullable, why a checkpoint size was chosen.

**Types are explicit.** Interfaces are preferred over type aliases for object
shapes; `type` is used for unions and for aliases of inferred types.

**The shared package has no I/O.** It must be importable by the browser
bundle, by the server and by a script. Anything that touches the filesystem,
the network or the clock belongs elsewhere. `time.ts` is the boundary: it
exposes a function that _returns_ the current time rather than one that reads
it, so that callers stay testable.

**A rule that depends on the date is given the date.** A registry rule that
asks what day it is is handed the day it is applied for — the repository
passes the date of the write, the sweep the day it runs for — so that the
same rule can be applied for any date, and so that a test does not have to
wait for midnight.

**Server-managed fields are dropped, not rejected.** When a client sends
`revision` or `createdAt`, the server discards them rather than refusing the
request. A client that sends a whole record still works, and stays forward
compatible with newer field sets.

**Errors carry a code, not a message.** The error codes are a fixed table in
`packages/shared/src/contracts/errors.ts`. A client branches on the code; the
`detail` text is for a person and may change.

**Entity types are generic.** There is no per-entity SQL, no per-entity
route handler and no per-entity client form. If you find yourself writing
`if (type === "student")`, look for a way to express it in the registry
instead.

## Making a change

1. **Start at the schema.** If the change touches the shape of a record, it
   starts in `packages/shared/src/domain/`. The API, the client form, the
   CSV column list and the OpenAPI document all follow from there.
2. **Run the contract check.** `npm run contract:check` will tell you if the
   published contract and the shared one disagree.
3. **Write the test.** The server tests are in `packages/server/test/`, the
   shared ones in `packages/shared/test/`, the client's pure logic in
   `packages/web/test/`.
4. **Run the whole gate.** `npm run verify`.
5. **If the change touches the package, check the package.** The installer is
   a separate deliverable: the server is bundled, the client is copied, the
   Node runtime is shipped, and the launcher starts all of it. A change can
   pass every test and still be missing from it. `npm run check:package` runs
   the built artefact and asserts that it works.

## Adding a dependency

The dependency footprint is deliberately small, and the browser bundle is
watched closely.

- **The server** may take a dependency freely, but it must install without a
  compiler. A native module would break that.
- **The client** should take a dependency only with a good reason. The
  bundle is about 400 KB before gzip today (123 KB gzipped), of which Zod
  is a large part; that is the price of the single-source-of-truth
  guarantee and it is worth paying once rather than repeatedly. The
  interface's own code — the form's rules, the catalogue, the icon set —
  comes to about 15 KB of that, and it is written out rather than pulled
  in, so it grows slowly and stays readable.
- **The shared package** may only take a dependency that works in a browser.
  It must not depend on Node built-ins.

## Adding a route

Routes are registered in `packages/server/src/http/routes.ts`. A route carries
documentation, which is what the OpenAPI document is generated from:

```ts
router.post(
  "/api/v1/students",
  (context) => { ... },
  {
    summary: "Create a student",
    description: "...",
    tags: ["student"],
    requestSchema: registry.createSchema(definition.type),
    responseSchema: definition.schema,
    successStatus: 201,
  },
);
```

**Order matters.** The router matches routes in registration order, so a
literal path such as `/students/export.csv` must be registered before
`/students/:id`, or the parameterised route will swallow it.

`successStatus` sets the status code of a successful response. It defaults to
200; a creation should set 201.

## Adding a field to an entity

1. Add the field to the Zod schema in `packages/shared/src/domain/`.
2. Decide whether it is nullable and give it a default if it should be
   optional.
3. Run `npm run contract:check` — the JSON Schema and the Zod schema must
   still agree.
4. If the field changes a stored record's meaning, write a migration. A
   migration that has been applied is never edited; a correction is a new
   migration.

The client form, the CSV column list, the OpenAPI document and the import
coercion all follow automatically.

## What is not finished

Honest list of the known gaps, so nobody discovers them by surprise:

- **No authentication.** Every client that can reach the server can read and
  write every record. The error codes `unauthorized` and `forbidden` exist
  but nothing raises them. This is the most important gap: the system assumes
  it is on a trusted network.
- **The `outbox` table in the database is unused.** It is there for the
  external-system integrations described in
  [`../integrations/external-systems.md`](../integrations/external-systems.md),
  and nothing writes to or reads from it yet.
- **The `audit_log` table is never written to.** The repository has an
  `audit()` method, and nothing calls it. A record of who changed what is
  needed before the system handles fees.
- **No per-user identity**, so the client cannot tell one user from another
  and the conflict model has no notion of an author.
- **The client's sync interval is a constant**, not a setting.
- **No request logging**, deliberately — see
  [`../operations/monitoring.md`](../operations/monitoring.md).

## See also

- [Testing](testing.md)
- [Adding an entity type](adding-an-entity-type.md)
- [`../architecture/`](../architecture/)
