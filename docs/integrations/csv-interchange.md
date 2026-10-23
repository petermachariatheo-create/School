# CSV interchange

CSV is the format a school office actually has: it comes out of a spreadsheet,
and it has to come back in. The pipeline is deliberately explicit about the
ambiguities that spreadsheet workflows depend on.

## Export

```
GET /api/v1/<entity>/export.csv
GET /api/v1/<entity>/export.csv?includeDeleted=true
```

Content type: `text/csv; charset=utf-8`. Line endings are CRLF, per RFC 4180.

The **column list is derived from the entity's JSON Schema**, which is derived
from the same Zod schema the server validates with. It can therefore never
drift from the data model. Two fields are excluded, because they are internal
bookkeeping rather than school data:

- `revision` — the concurrency token;
- `deletedAt` — the soft-delete marker.

Everything else appears, including `id`, `createdAt` and `updatedAt`, so that
an export can be re-imported and keep its identity.

### How values are written

| Value type      | Cell                                               |
| --------------- | -------------------------------------------------- |
| `null` / absent | empty                                              |
| boolean         | `true` / `false`                                   |
| number          | its decimal form                                   |
| date            | `YYYY-MM-DD`                                       |
| instant         | full ISO-8601 UTC, e.g. `2026-10-20T08:30:00.000Z` |
| object / array  | JSON text                                          |

The JSON encoding of nested structures is what stops a round trip through a
spreadsheet from losing data silently: an invoice's line items survive as a
JSON cell rather than being flattened into columns that no longer exist.

A field containing a comma, a quote or a newline is quoted, and embedded
quotes are doubled. This is the `stringifyCsv` implementation in
`packages/shared/src/interop/csv.ts`.

### Client-side export

The client exports from its **local replica**, not from the server, so a device
with no connection can still hand over its data. It uses the same column list
and the same encoder, so the file is identical to what the server would
produce.

## Import

```
POST /api/v1/<entity>/import                → preview only
POST /api/v1/<entity>/import?apply=true     → apply
```

Content type: `text/csv` (a JSON body of the form `{"csv": "..."}` is also
accepted).

The import runs in **two steps on purpose**.

### Step 1 — preview

The server parses and validates every row and reports what it _would_ do,
without changing anything:

```json
{
  "applied": false,
  "preview": {
    "entityType": "student",
    "columns": ["admissionNumber", "firstName", "lastName"],
    "totalRows": 3,
    "validRows": 1,
    "invalidRows": 1,
    "duplicateRows": 1,
    "rows": [
      { "row": 1, "status": "valid",     "record": { ... }, "problems": [], "duplicateOf": null },
      { "row": 2, "status": "invalid",   "record": null, "problems": ["lastName: Too small: expected string to have >=1 characters"], "duplicateOf": null },
      { "row": 3, "status": "duplicate", "record": { ... }, "problems": [], "duplicateOf": "01ARZ..." }
    ],
    "problems": [
      { "row": 2, "column": "lastName", "message": "Too small: expected string to have >=1 characters" }
    ]
  }
}
```

A mis-picked file therefore cannot silently rewrite a school's data: the
operator sees exactly which rows will be created and which will be refused.

### Step 2 — apply

`?apply=true` performs the import. Every record is written in **one
transaction**: either the whole import lands or nothing does, so a failure
part-way through cannot leave the records half-imported.

Add `?updateExisting=true` to update a record whose business key already
exists instead of skipping it as a duplicate.

## Row handling

Each row is processed independently:

1. **Unknown columns are ignored**, and reported once in `problems` with row
   `0`. A file exported from an older version of the system still imports.
2. **Each cell is coerced** to the type the schema expects, using the JSON
   Schema: `true`/`false`/`yes`/`1` for booleans, an integer for `integer`, a
   number for `number`, JSON for objects and arrays, `YYYY-MM-DD` for dates.
   An empty cell means "not set", which lets the schema apply its own default.
3. **The row is checked against the school's own rules.** A file that states
   an invoice's total must agree with the sum of its line items; a file that
   disagrees is reported as an invalid row, because the server will use its
   own figure and the file holds a mistake. A file that leaves the total out
   is fine: the server works it out.
4. **The row is validated** as a creation: the identifier may come from the
   file, the server-owned fields are not required, a field the server works
   out is not asked for, and a total the server keeps is not taken from the
   file at all. An invoice's amount paid is the sum of the payments, so the
   payments decide it — a file that states one is ignored. The same is true of
   the values of an invoice's status that follow from the money and the date:
   a file that states an invoice is paid is told otherwise, and the preview
   shows the status the record will have.
5. **The row is matched against the business key.** A match is reported as a
   `duplicate` and carries the identifier of the existing record.

A row that fails coercion or validation does not stop the file. It is reported
with its row number and its problems, and the other rows are still imported.

## Business keys

The business key is what an import uses to recognise a record it has already
seen:

| Entity                | Business key                     |
| --------------------- | -------------------------------- |
| Student               | `admissionNumber`                |
| Guardian              | `firstName`, `lastName`, `email` |
| Student-guardian link | `studentId`, `guardianId`        |
| Class                 | `name`, `academicYear`           |
| Enrolment             | `studentId`, `classId`           |
| Attendance            | `studentId`, `classId`, `date`   |
| Assessment            | `classId`, `title`, `date`       |
| Assessment result     | `assessmentId`, `studentId`      |
| Invoice               | `invoiceNumber`                  |
| Payment               | `paymentNumber`                  |

A key with a member that is null cannot match anything, so a record with an
incomplete key is never reported as a duplicate of an unrelated record.

## Practical notes

- The importer accepts UTF-8 with or without a byte order mark.
- Only a comma is accepted as the delimiter. The codec supports others, but
  the endpoint does not expose the choice; a file with semicolons needs to be
  converted first.
- The header row is required.
- A CSV file cannot express a nested record cleanly. It round trips through
  the JSON cell representation, so a line item survives, but it is not
  pleasant to edit in a spreadsheet. Use the JSON export for anything
  structured.
