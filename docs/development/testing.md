# Testing

```bash
npm test              # the whole suite
npm run test:watch    # the same, in watch mode
```

The suite runs on Node's built-in test runner. There is no test framework
dependency.

## What is covered

225 tests, in 33 suites, across three packages.

### `packages/shared/test/`

| File               | Covers                                                                                      |
| ------------------ | ------------------------------------------------------------------------------------------- |
| `ulid.test.ts`     | Monotonicity within a millisecond, the Crockford alphabet, the regex, timestamp extraction. |
| `domain.test.ts`   | The entity schemas: defaults, coercion, refusals, the money invariant, the display name.    |
| `registry.test.ts` | Registration, JSON Schema generation, the create and patch schemas, validation.             |
| `csv.test.ts`      | Quoting, embedded newlines, a byte order mark, CRLF and LF, the type coercion of cells.     |

### `packages/server/test/`

| File                   | Covers                                                                                          |
| ---------------------- | ----------------------------------------------------------------------------------------------- |
| `repository.test.ts`   | Upsert, soft delete, natural-key lookup, filtering, keyset pagination, revision increments.     |
| `sync.test.ts`         | The change feed, idempotent pushes, the conflict model, the log floor, pruning.                 |
| `schema.test.ts`       | The migration runner, the migrations, the schema's own invariants.                              |
| `interop.test.ts`      | The CSV and JSON exporters, the import preview, the import application.                         |
| `api.test.ts`          | The HTTP surface end to end, over a real socket.                                                |
| `checkpointer.test.ts` | The background checkpointer, the worker script it looks for, and how a failure is reported.     |
| `static.test.ts`       | The static file serving: content types, cache headers, and refusing to serve outside the build. |
| `config.test.ts`       | The environment configuration and its defaults.                                                 |
| `addresses.test.ts`    | The network addresses the server offers to other devices.                                       |

### `packages/web/test/`

| File             | Covers                                                                            |
| ---------------- | --------------------------------------------------------------------------------- |
| `client.test.ts` | The schema-driven form definitions, the value formatting, the offline CSV export. |

## The HTTP tests

`api.test.ts` starts the real router on an ephemeral `node:http` server and
talks to it with `fetch`. This is the only way to check the things a unit test
cannot:

- the status code of each operation, including `201` for a creation and `422`
  for a validation failure;
- the `content-type` of each response, including
  `application/problem+json` for an error;
- that a malformed JSON body is a `400` and not a `500`;
- that an unknown path is a `404`;
- that a CSV export has a `text/csv` content type and the right content;
- that the OpenAPI document is well formed and describes every entity route.

The server is started on port 0, so the test never collides with a
development server.

## The test database

Tests use a **real SQLite file** in a temporary directory, not an in-memory
database:

```ts
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "school-test-"));
const db = openDatabase({ file: path.join(directory, "test.db") });
migrate(db);
```

This is deliberate. WAL behaviour, transaction semantics and file-level
durability are part of what the system promises, and an in-memory database
does not exercise them. A test that passed against `:memory:` could still fail
in production.

The helper is in `packages/server/test/helpers.ts`:

```ts
const context = createTestContext();
// ... use context.db, context.repositories, context.sync ...
context.cleanup();
```

`cleanup()` closes the database and removes the temporary directory.

## The contract check

`npm run contract:check` is not a unit test but it belongs in the same
discipline. It builds the OpenAPI document and asserts that it agrees with the
shared contract — 136 assertions across the ten entity types. It catches a
schema change that was not propagated to the published contract.

See [`../integrations/openapi.md`](../integrations/openapi.md).

## The package check

`npm run check:package` checks the thing a school actually runs. It starts
the packaged server from `dist/windows/payload`, with the packaged Node
runtime, the way the launcher starts it, and asserts that it answers, says
which product it is, writes down the port it is listening on, serves the
client application, can store a record, and is running the background
checkpointer.

It exists because the package is a separate deliverable. The repository's
tests all pass while the package is broken: a file that was not bundled, a
path that only resolves in the source tree, a setting the launcher does not
pass on. That is not a hypothetical — the packaged server once referred to
the checkpoint worker by its source name, so the installed copy silently lost
the background checkpointer and every write paused while the log was copied.

Run it after any change that touches the server, the client build, the
launcher or the build script:

```bash
npm run package     # build the installer, then check it
```

## The performance harness

`npm run perf` boots the real server, fills a throwaway database and measures
the operations a client performs, against budgets. It is not part of
`npm test` — it takes about a minute and depends on the machine — but it runs
as part of a release check.

See [`../performance/benchmarks.md`](../performance/benchmarks.md).

## Writing a test

**Server tests** use `node:test` and `node:assert/strict`:

```ts
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createTestContext } from "./helpers.ts";

test("a student's revision increases on every write", () => {
  const context = createTestContext();
  try {
    const students = context.repositories.get("student");
    const first = students.upsert({
      id: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
      admissionNumber: "ADM-1",
      firstName: "Ada",
      lastName: "Lovelace",
    });
    assert.equal(first.record["revision"], 1);
  } finally {
    context.cleanup();
  }
});
```

**Client tests** are harder, because the client is a browser application with
IndexedDB. The pure parts — the form definitions, the CSV export, the field
normalisation — are plain functions and can be tested without a browser. The
IndexedDB and sync parts are not currently covered by automated tests; they are
exercised through the interface. Adding a browser-based test runner (Playwright)
is on the list of things to do.

## Conventions

- **Test names say what is true, not what is called.** "a student's revision
  increases on every write", not "test upsert".
- **Assert on behaviour, not on internals.** A test that asserts on the
  number of SQL statements will break for the wrong reason.
- **Every test cleans up.** Use `try`/`finally` with `context.cleanup()`.
- **Do not add a test framework.** `node:test` is enough, and a framework
  would be a dependency the whole project has to install.

## See also

- [Working on the codebase](working-on-the-codebase.md)
