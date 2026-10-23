# The OpenAPI document

```
GET /api/v1/openapi.json
```

The document is **generated**, not written by hand. It is built from the route
table and the entity registry at request time, so it cannot describe an API
that the server does not implement.

## What it contains

- `openapi: "3.1.0"` — OpenAPI 3.1, which uses JSON Schema 2020-12.
- `info.version` — the contract version, the same `CONTRACT_VERSION` the rest
  of the system reports.
- `servers` — the URL the server was configured with.
- `paths` — every registered route, with its parameters, its request body
  schema and its responses.
- `components.schemas` — one schema per entity type, plus the request and
  response bodies of the routes that declare them. The request bodies are
  named after the entity they belong to (`InvoiceRequest`, `InvoicePatch`),
  so a consumer can tell them apart.
- `x-contract-version` and `x-api-version` — extension fields carrying the two
  version numbers, so a consumer can check compatibility without parsing the
  title.

## How it is generated

`packages/server/src/http/openapi.ts` walks the router's route templates. A
route contributes an operation only if it carries documentation:

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

The `requestSchema` and `responseSchema` are Zod schemas, converted to JSON
Schema with `z.toJSONSchema`. The entity schemas come straight from the
registry, so the published schema is the schema the server validates with.

Route templates are converted to OpenAPI paths by replacing `:id` with `{id}`.

## The contract check

`npm run contract:check` runs `scripts/check-contracts.ts`, which builds the
document and asserts that it agrees with the shared contract. It checks 136
things today, including:

- `info.version`, `x-contract-version` and `x-api-version` all equal
  `CONTRACT_VERSION` / `API_VERSION`;
- `CONTRACT_VERSION` is listed in `SUPPORTED_CONTRACT_VERSIONS`;
- every entity has `GET` and `POST` on its collection path and `GET`, `PATCH`
  and `DELETE` on its item path;
- every entity has a component schema, and it is **byte-for-byte** the
  registry's JSON Schema;
- the JSON Schema's property list equals the Zod schema's field list — this is
  what catches a field that was added to one and not the other;
- the create schema exposes exactly the business fields plus `id`, and no
  server-managed field, no field the server works out and no total the server
  keeps;
- the patch schema makes every field optional;
- every derived field names a field of its own type to be computed from;
- every total names records that exist and fields that exist on them, and
  no two totals are a total of each other;
- every decided field names a field of its own type, and every value a
  person may choose is a value of that field;
- the sync pull response still carries `changes`, `cursor`, `hasMore`,
  `logFloor`, `requiresSnapshot` and `serverTime`.

The check runs before the build in `npm run verify`, so a contract change that
was not propagated fails the pipeline rather than shipping.

## Using the document

The document is a normal OpenAPI 3.1 file, so it can be fed to a client
generator, an API explorer or a linter:

```bash
curl -s http://localhost:8080/api/v1/openapi.json > openapi.json
npx @redocly/cli lint openapi.json
```

It is served with `content-type: application/json; charset=utf-8` and
`cache-control: no-store`, because it changes whenever the server's routes or
schemas change.

## Limitations

- The document describes the **shape** of the API but not its behaviour. The
  conflict model, the soft-delete semantics and the import workflow are
  documented in [`../architecture/synchronisation.md`](../architecture/synchronisation.md)
  and [`csv-interchange.md`](csv-interchange.md), and are not expressible in
  OpenAPI.
- Response schemas are declared per route but are not validated against live
  responses by a test. The HTTP integration test
  (`packages/server/test/api.test.ts`) checks the status codes, the content
  types and the error format, which is where a mismatch is most likely to
  matter.
- Authentication is not described, because there is no authentication yet. See
  the roadmap in [`../development/working-on-the-codebase.md`](../development/working-on-the-codebase.md).
