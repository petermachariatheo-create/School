# Synchronisation

The synchronisation protocol is defined once, in
`packages/shared/src/contracts/sync.ts`, and implemented twice: on the server in
`packages/server/src/sync/engine.ts` and on the client in
`packages/web/src/sync/engine.ts`.

## The two directions

### Pull — the change feed

```
GET /api/v1/sync/changes?since=<cursor>&limit=<n>
```

```json
{
  "changes": [
    {
      "entityType": "student",
      "entityId": "01ARZ3NDEKTSV4RRFFQ69G5FAV",
      "operation": "upsert",
      "seq": 412,
      "changedAt": "2026-10-20T08:30:00.000Z",
      "revision": 3,
      "record": { "id": "01ARZ...", "admissionNumber": "ADM-001", "...": "..." }
    }
  ],
  "cursor": 412,
  "hasMore": false,
  "logFloor": 1,
  "requiresSnapshot": false,
  "serverTime": "2026-10-20T08:30:01.000Z"
}
```

The server assigns a **global monotonic sequence number** to every change. A
client stores the highest sequence number it has applied and sends it as
`since` next time, so each change is transferred exactly once.

A `delete` change carries `record: null`; the client keeps the last known
content and marks the record as deleted, which is why deletion is a soft delete
on the server too.

### Push — client operations

```
POST /api/v1/sync/push
```

```json
{
  "operations": [
    {
      "opId": "op-01ARZ3NDEKTSV4RRFFQ69G5FB",
      "entityType": "student",
      "entityId": "01ARZ3NDEKTSV4RRFFQ69G5FAV",
      "operation": "upsert",
      "patch": { "firstName": "Augusta" },
      "baseRevision": 2,
      "clientTime": "2026-10-20T08:29:55.000Z"
    }
  ]
}
```

Each operation carries a client-generated `opId`. The server records the
outcome of every operation it applies, so a push that is retried after a
timeout returns the original result rather than applying the change twice.
That is what makes "push, lose the response, retry" safe.

The response reports one result per operation:

| Status      | Meaning                                                                                                             |
| ----------- | ------------------------------------------------------------------------------------------------------------------- |
| `applied`   | The server applied the change.                                                                                      |
| `duplicate` | The server had already applied this `opId`; nothing was done twice.                                                 |
| `conflict`  | Some fields were changed on the server at the same time; the server's values stand. `conflictingFields` lists them. |
| `rejected`  | The server refused the change. `errors` explains why.                                                               |

## The conflict model

Field-level last-writer-wins, evaluated in the order the server applies
operations. The full reasoning is in
[`../decisions/0002-sync-conflict-model.md`](../decisions/0002-sync-conflict-model.md);
in short:

1. The client sends **only the fields it changed**, plus the `baseRevision`
   its edit was based on.
2. If the server's current revision equals `baseRevision`, nothing changed
   underneath the client and the patch is applied as-is.
3. Otherwise the server recovers the record **as it was at `baseRevision`**
   from the change history and compares field by field:
   - the server did **not** change the field → the client's value is applied;
   - the server **did** change the field and the client did too → the field
     **conflicts**, and the server's value stands;
   - the server changed the field and the client did not → the client's value
     is not sent, so nothing happens.

The response names the conflicting fields, so the client can tell the user what
was overwritten rather than silently losing an edit.

## What a client may state

A patch may not contain a field the server owns: the revision, the
timestamps, the soft-delete marker, a field the server works out from other
fields — an invoice's total — or a total the server keeps up to date — an
invoice's amount paid. Such a field is **dropped from the patch** rather
than refused, so a client that sends a whole record still succeeds and stays
forward compatible with newer field sets. The list is
`registry.serverOwnedFields(type)`, so the routes, the sync engine and the
contract check all answer the question the same way.

When a payment is pushed, the server recomputes the invoice's amount paid
and writes it in the same transaction, so the client that pushed the payment
pulls the new figure in the same batch.

See [`../decisions/0009-server-derived-fields.md`](../decisions/0009-server-derived-fields.md)
and
[`../decisions/0010-server-kept-totals.md`](../decisions/0010-server-kept-totals.md).

## Atomicity of a batch

A push is applied in **one transaction**. Either the whole batch is applied or
none of it is. This matters because a client that retries after a timeout must
not end up with half a batch applied twice.

Each operation still gets its own **savepoint**, so an operation the server
refuses is rejected on its own and does not discard the rest of the batch.

## Durability of the client's queue

The client writes an operation into an IndexedDB **outbox** _before_ the
interface acknowledges the edit. The outbox entry survives a tab crash, a
reload and a power cut. The sync engine removes an entry only when the server
has confirmed it.

An entry the server **rejected** is kept and marked failed, so a rejection is
visible to the user instead of disappearing. A rejection is not retried
automatically: a change the server refuses will not be accepted on a second
attempt either.

## Detecting a gap

The change log is pruned once every registered client has caught up. A client
that was offline for a long time can therefore end up with a cursor older than
the log.

Every pull response carries:

- `logFloor` — the lowest sequence number still retained;
- `requiresSnapshot` — `true` when the client's cursor is older than that.

When `requiresSnapshot` is `true` the client replaces its replica with
`GET /api/v1/sync/snapshot` and continues from the snapshot's cursor. The
snapshot pages through every record of every entity type, so it is never a
truncated copy.

## Client registration

After a successful sync the client posts its cursor to
`POST /api/v1/sync/clients`. The server uses the oldest cursor among clients
that have checked in recently to decide how far the change log may be pruned,
with a safety margin of 1000 entries. A device that stops reporting keeps the
log intact for it.

Registration is best effort: if it fails, the log is simply not pruned as
aggressively.

## The end-to-end sequence

```
Client                            Server
  │                                  │
  │  POST /api/v1/sync/push          │
  │  (pending outbox entries)        │
  │─────────────────────────────────►│  one transaction,
  │                                  │  one savepoint per operation
  │  { results: [...] }              │
  │◄─────────────────────────────────│
  │                                  │
  │  apply accepted results to the   │
  │  replica, clear the outbox       │
  │                                  │
  │  GET /api/v1/sync/changes        │
  │  ?since=<cursor>                 │
  │─────────────────────────────────►│
  │  { changes, cursor, hasMore,     │
  │    logFloor, requiresSnapshot }   │
  │◄─────────────────────────────────│
  │                                  │
  │  apply changes to the replica,   │
  │  store the new cursor            │
  │                                  │
  │  POST /api/v1/sync/clients       │
  │─────────────────────────────────►│
  └──────────────────────────────────┘
```
