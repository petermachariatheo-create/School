# 0004 — Zod schemas are the single source of truth

**Status:** accepted

## Context

The same shape — a student, an invoice, a sync operation — has to be described
in several places: the server has to validate it, the client has to render a
form for it, the OpenAPI document has to publish it, and the import pipeline
has to coerce CSV cells into it.

If those are written separately they drift. A field added to the database but
not to the published schema produces a client that sends a field the server
silently drops — one of the hardest kinds of bug to notice.

## Decision

**One Zod schema per entity, in `packages/shared`.** Everything else is derived
from it.

- The registry turns a Zod schema into a **JSON Schema** (draft 2020-12) with
  `z.toJSONSchema`.
- The **OpenAPI document** publishes that JSON Schema as a component.
- The **client form** reads the same JSON Schema and derives its fields.
- The **CSV exporter** derives its column list from the JSON Schema's
  properties.
- The **CSV importer** uses the JSON Schema to coerce each cell to the right
  type.
- The **server** validates with the Zod schema itself.

The registry adds the two things JSON Schema cannot express: the storage
table, the REST path, the business key, and cross-field invariants.

## Consequences

**Good.**

- Adding a field to an entity changes the database, the API, the OpenAPI
  document, the client form and the CSV column list at once.
- The client form and the server validation cannot disagree, because they come
  from the same object.
- The contract check (`npm run contract:check`) can assert that the published
  OpenAPI schema is byte-for-byte the registry's schema, and that the JSON
  Schema's fields match the Zod fields. It runs 131 assertions across the ten
  entity types today.

**Bad, and accepted.**

- Zod is a runtime dependency of both the server and the browser bundle. It
  costs about 50 KB gzipped in the client. That is acceptable for the
  guarantee it buys, and it is the only large dependency in the client.
- JSON Schema cannot express every Zod refinement. A cross-field rule such as
  "an invoice's total must equal the sum of its line items" has to be written
  as an `invariant` or a `derived` entry in the registry. The registry keeps
  those rules next to the schemas, and the contract check cannot verify them
  automatically.
- `z.toJSONSchema` is a young API. It is pinned to Zod 4 and its output is
  checked by the contract test, so a change in its behaviour would be caught
  rather than shipped.

## Alternatives considered

**JSON Schema as the source, with a validator.** Rejected. Zod's inferred
TypeScript types are what give the client and the server compile-time
checking; deriving types from JSON Schema would mean a separate type
generation step.

**Hand-written OpenAPI and hand-written client forms.** Rejected. This is the
drift the decision exists to prevent.

**A code generator.** Rejected. It would add a build step and a generated-code
directory for a system whose whole point is that it installs with `npm install`.
