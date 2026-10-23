# Adding an entity type

An entity type is a thing the school keeps records of — a school bus, a
subject, a fee category. Adding one is a small, contained change: the
registry is the only place that has to know about it.

This is the payoff of the single-source-of-truth design. Everything generic —
the REST API, the sync engine, the import and export pipelines, the OpenAPI
document and the client form — is derived from the registry.

## 1. Write the schema

Add the Zod schema to the right file in `packages/shared/src/domain/`.

```ts
// packages/shared/src/domain/academic.ts

export const SchoolBus = EntityMeta.extend({
  /** Registration number of the bus. */
  registrationNumber: z.string().min(1).max(32),
  name: z.string().min(1).max(120),
  capacity: z.int().min(1).max(200),
  driverName: z.string().max(120).nullable().default(null),
  phone: z.string().max(40).nullable().default(null),
  active: z.boolean().default(true),
});
export type SchoolBus = z.infer<typeof SchoolBus>;
```

Extend `EntityMeta`, not `z.object`. Every entity carries `id`, `revision`,
`createdAt`, `updatedAt` and `deletedAt`.

Two rules that the rest of the system depends on:

- **Give optional fields a default** (`null` or a literal) so that a record
  created without them is still valid. A field with no default and no
  `nullable` is required, which is right for a name and wrong for a note.
- **Money is an integer in minor units.** `z.int().min(0)`, never a float.

## 2. Register it

Add one entry to the registry in `packages/shared/src/registry.ts`:

```ts
{
  type: "school_bus",
  table: "school_buses",
  restPath: "school-buses",
  schema: SchoolBus,
  label: "School bus",
  naturalKey: ["registrationNumber"],
},
```

| Field        | Meaning                                                                          |
| ------------ | -------------------------------------------------------------------------------- |
| `type`       | The stable name used in sync payloads, import files and the API. Use snake_case. |
| `table`      | The physical table name.                                                         |
| `restPath`   | The URL segment. Use kebab-case.                                                 |
| `schema`     | The Zod schema.                                                                  |
| `label`      | The human-readable name used in messages and the interface.                      |
| `naturalKey` | The business key that an import uses to recognise an existing record.            |
| `invariant`  | Optional. A cross-field rule that a single-field schema cannot express.          |
| `derived`    | Optional. Fields the server works out from other fields.                         |
| `aggregates` | Optional. Fields the server keeps up to date from other records.                 |
| `refined`    | Optional. Fields the server decides, except where a person has chosen.           |

If the type needs a cross-field rule, add it the way the invoice does:

```ts
const busInvariant = (record: Record<string, unknown>): string | null => {
  const capacity = record["capacity"];
  const route = record["route"];
  if (typeof capacity === "number" && typeof route === "string" && route.length === 0) {
    return "a bus with a route must have a capacity";
  }
  return null;
};
```

### A field the server works out

Some values are not facts a client states but consequences of other facts: an
invoice's total is the sum of its line items. Say so in the registry, and the
rest of the system follows:

```ts
{
  type: "invoice",
  // ...
  derived: [
    { field: "totalAmount", from: "lineItems", compute: invoiceTotal },
  ],
}
```

A derived field is then:

- left out of the create and patch schemas, so a client is never asked for it;
- dropped from a client's sync patch, so it cannot state it;
- worked out by the server on every write, and stored;
- shown in the client form as a value it cannot type, worked out there with
  the same rule, so an offline device shows the figure it will have;
- checked by the CSV importer, so a file that states a different figure is
  reported rather than quietly corrected.

`compute` returns `undefined` when the source cannot be used, which leaves the
field as the client sent it so that the schema reports the real problem
instead of a confusing one.

### A total the server keeps

A value that follows from _other records_ is kept by the server rather than
computed from the record itself. An invoice's amount paid is the sum of the
payments received against it:

```ts
aggregates: [
  {
    field: "paidAmount",
    source: "payment",
    via: "invoiceId",
    sumOf: "amount",
    match: { currency: "currency" },
  },
],
```

| Part     | Meaning                                                      |
| -------- | ------------------------------------------------------------ |
| `field`  | The field on this entity that holds the total.               |
| `source` | The entity type whose records are totalled.                  |
| `via`    | The field of a source record that holds this record's id.    |
| `sumOf`  | The field of a source record that is added up.               |
| `match`  | Optional. Source fields that must equal the same field here. |

A total is left out of the create and patch schemas, dropped from a client's
sync patch, and recomputed by the server after every write — of the record
that holds it, and of any record it is a total of. The client shows the
server's last figure rather than working one out for itself, because its own
copy of the school may be missing a record.

The `match` clause is what keeps money honest: only records in the same
currency are added up.

### A value the server decides

Some values are a decision somebody made and a consequence at the same time.
An invoice's status is a draft or a void one because the school said so, and
partly paid or overdue because of the money and the date. Say which is which
in the registry, and the rest of the system follows:

```ts
refined: [
  {
    field: "status",
    choices: ["draft", "issued", "void"],
    decide: invoiceStatus,
  },
],
```

| Part      | Meaning                                                        |
| --------- | -------------------------------------------------------------- |
| `field`   | The field the rule decides.                                    |
| `choices` | The values a person may choose.                                |
| `decide`  | The rule that decides the value, given the record and the day. |

The rule is applied by the server on every write, so a record is right the
moment it is written, and by the daily sweep in
`packages/server/src/db/sweep.ts`, so that a value which follows from the
passage of time is right even when nothing was written. The sweep asks the
registry which fields are decided, so it needs no code of its own for a new
one.

A rule that depends on the date is given the date: `decide` receives a
context holding the day it is applied for, and the shared package never
reads a clock. The repository passes the date of the write, the sweep the
day it runs for, and the importer the day the file is imported on.

The client may still state the values in `choices`. The others are the
server's to work out, and a client that states one has it replaced by what
the rule says. The interface lists them, so that a person is not left
wondering why the server disagreed.

## 3. Add the table

Add the table to `ENTITY_TABLES` in `packages/server/src/db/migrations.ts`:

```ts
{ table: "school_buses", naturalKey: ["registrationNumber"], unique: true },
```

And add a **new migration**. A migration that has been applied is never
edited; a correction is a new migration.

```ts
{
  version: 3,
  name: "school_buses",
  sql: "CREATE TABLE school_buses (...); CREATE INDEX ...;",
}
```

The migration runner applies whatever has not been applied yet and records it
in `schema_migrations`. See `packages/server/src/db/migrate.ts` for the exact
form the runner expects — in particular, whether the entity tables are
generated from `ENTITY_TABLES` (they are: migration 2 calls
`renderEntityTables()`) or written out by hand.

**If the tables are generated**, adding to `ENTITY_TABLES` and adding a
migration that calls `renderEntityTables()` again would try to create the
existing tables a second time. Look at how migration 2 is written and follow
the same pattern for the new table.

## 4. Check the contract

```bash
npm run contract:check
```

It will verify that the new type has the right routes, a component schema, a
create schema that excludes the server-managed fields, the fields the server
works out and the totals it keeps, and a patch schema whose fields are all
optional.

## 5. Test it

```ts
test("a school bus can be created and listed", () => {
  const context = createTestContext();
  try {
    const buses = context.repositories.get("school_bus");
    const created = buses.upsert({
      id: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
      registrationNumber: "KDA 123B",
      name: "Nyamira",
      capacity: 45,
    });
    assert.equal(created.record["registrationNumber"], "KDA 123B");
  } finally {
    context.cleanup();
  }
});
```

## 6. Check it end to end

```bash
npm run verify
npm run dev:server
```

```bash
curl -s http://localhost:8080/api/v1/school-buses
curl -s -X POST http://localhost:8080/api/v1/school-buses \
  -H 'content-type: application/json' \
  -d '{"registrationNumber":"KDA 123B","name":"Nyamira","capacity":45}'
```

The client picks the type up with no client change at all: it reads the
registry, so the new type appears in the sidebar with a generated form.

## What you do not have to write

- A SQL table (well — one line in `ENTITY_TABLES`).
- A repository.
- A REST handler.
- A sync handler.
- An importer or an exporter.
- An OpenAPI entry.
- A client form.
- A client-side store.

All of it is derived from the registry.

## Things to watch

**The natural key must be stable.** It is what an import uses to match an
existing record. If it is something the user can change, an import will
create a duplicate instead of updating.

**A natural key with nullable members cannot match.** If a member is null the
key is not used for duplicate detection at all. This is deliberate — a
partially null key would match unrelated records.

**A unique natural key is enforced by a partial unique index**, which ignores
soft-deleted rows. So an admission number freed by a departure can be issued
again, but two live records cannot share one.

**Field names become API names.** A field named `firstName` appears as
`firstName` in the API, the CSV header and the client form. There is no
mapping layer, and that is on purpose.
