# JSON and NDJSON interchange

CSV is for spreadsheets. JSON is for programs, backups and anything that needs
to be self-describing. NDJSON is for large transfers that should be processed
one record at a time.

All three are produced from the same source as the CSV export, so they agree
with each other and with the API.

## JSON export

```
GET /api/v1/<entity>/export.json
```

Content type: `application/json; charset=utf-8`.

The payload is a **self-describing envelope**:

```json
{
  "contractVersion": "1.0.0",
  "entityType": "student",
  "exportedAt": "2026-10-20T08:30:00.000Z",
  "items": [
    {
      "id": "01ARZ3NDEKTSV4RRFFQ69G5FAV",
      "revision": 3,
      "createdAt": "2026-01-10T09:00:00.000Z",
      "updatedAt": "2026-10-20T08:12:00.000Z",
      "deletedAt": null,
      "admissionNumber": "ADM-001",
      "firstName": "Ada",
      "lastName": "Lovelace",
      "gender": "female",
      "status": "active"
    }
  ]
}
```

`contractVersion` tells a consumer which payload shape it is looking at, so an
incompatible change is detectable rather than a surprise. It is the same
`CONTRACT_VERSION` the API reports at `GET /api/v1/meta` and in the OpenAPI
document.

## NDJSON export

```
GET /api/v1/<entity>/export.ndjson
```

Content type: `application/x-ndjson; charset=utf-8`.

One JSON object per line:

```
{"id":"01ARZ...","admissionNumber":"ADM-001","firstName":"Ada","...":"..."}
{"id":"01ARZ...","admissionNumber":"ADM-002","firstName":"Alan","...":"..."}
```

NDJSON is the right choice for a large export because a consumer can process it
a line at a time without holding the whole file in memory. `jq` reads it
directly:

```bash
curl -s http://localhost:8080/api/v1/students/export.ndjson \
  | jq -r 'select(.status == "active") | .admissionNumber'
```

The parser in `packages/shared/src/interop/json.ts` reports a malformed line
rather than aborting the whole parse, so a partially corrupt file still yields
the records that are intact.

## The full snapshot

For a backup or a transfer to another system, the server also offers the
complete dataset across every entity type:

```
GET /api/v1/sync/snapshot
```

```json
{
  "cursor": 4182,
  "serverTime": "2026-10-20T08:30:00.000Z",
  "entities": {
    "student": [ ... ],
    "guardian": [ ... ],
    "enrollment": [ ... ]
  }
}
```

The snapshot **pages through every record of every entity type**. It is not
capped at one page: a client that took a truncated snapshot would silently be
missing students.

`cursor` is the change-feed sequence number the snapshot corresponds to. A
client that stores it can later pull only the changes that happened after the
snapshot.

## Round-tripping

An export can be imported again:

- **JSON → CSV → JSON** preserves every value, including nested structures,
  because a nested value is a JSON cell in the CSV.
- **NDJSON** is the format to use for a large bulk load: split it into
  per-entity files and import each through the CSV endpoint, or write a small
  script that pushes the records through `POST /api/v1/sync/push`.
- The `id` is exported, so a re-import keeps the identity of each record. The
  server accepts a client-supplied identifier on creation, which is what makes
  an offline device's identifier survive the trip to the server.

## Limits

The export endpoints return at most 10 000 records per entity type by default.
A school with more records than that should use the snapshot endpoint, which
pages through everything.

Exports include soft-deleted records only when `?includeDeleted=true` is
passed.

## See also

- [CSV interchange](csv-interchange.md)
- [The OpenAPI document](openapi.md)
