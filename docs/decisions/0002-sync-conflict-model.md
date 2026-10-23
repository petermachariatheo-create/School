# 0002 — Field-level last-writer-wins, evaluated on the server

**Status:** accepted

## Context

Two devices can edit the same student while both are offline. When they
reconnect, one of the two edits has to lose. The rule has to be:

- **deterministic**, so both devices agree on the result;
- **explainable**, so an administrator can be told what happened;
- **narrow**, so that an edit to one field does not discard an edit to
  another.

A whole-record last-writer-wins rule fails the third test: if the office
corrects a phone number while a teacher changes a class, the whole record is
replaced and the teacher's change is lost, even though the two edits touch
different fields.

## Decision

The server applies **field-level last-writer-wins**, in the order it applies
operations.

The client sends:

- `patch` — **only the fields it changed**;
- `baseRevision` — the revision the record was on when the client started
  editing.

The server then, for each field in the patch:

| The server changed this field since `baseRevision`? | The client changed it? | Outcome                                                                          |
| --------------------------------------------------- | ---------------------- | -------------------------------------------------------------------------------- |
| No                                                  | Yes                    | The client's value is applied.                                                   |
| Yes                                                 | No                     | Nothing — the client did not send the field.                                     |
| Yes                                                 | Yes                    | **Conflict.** The server's value stands, and the field is named in the response. |

To answer "did the server change this field?", the server recovers the record
**as it was at `baseRevision`** from the change history and compares the three
values.

The response names the conflicting fields:

```json
{
  "opId": "op-01ARZ...",
  "status": "conflict",
  "entityType": "student",
  "entityId": "01ARZ...",
  "revision": 4,
  "seq": 413,
  "conflictingFields": ["phone"]
}
```

The client applies the server's version on the next pull and can tell the user
that their change to `phone` was not kept.

## Consequences

**Good.**

- Concurrent edits to different fields both survive.
- The losing device is told _what_ it lost, so the edit is recoverable by hand
  rather than silently discarded.
- The rule needs no vector clocks, no operation identifiers beyond the `opId`
  that already exists for idempotency, and no merge algorithm on the client.
- The whole rule can be explained in one sentence to a school administrator.

**Bad, and accepted.**

- The server's value always wins a genuine conflict. There is no "both
  changes" state.
- The conflict history must be retained far enough back to recover a record at
  `baseRevision`. The change log is pruned once every client has caught up; a
  client whose cursor is older than the log takes a full snapshot instead, and
  a snapshot is not a conflict but a replacement.
- The comparison is field-by-field over JSON values, so a change from `1` to
  `1.0` is invisible even though it changes the serialised form. This is
  harmless for the field types in the domain model.

## Alternatives considered

**Whole-record last-writer-wins.** Rejected. It discards unrelated edits, which
is the common case rather than the rare one.

**An explicit merge UI.** Deferred. The field-level rule resolves the large
majority of conflicts without human involvement; the remaining cases are
reported clearly enough to be fixed by hand.

**Operational transformation or a CRDT.** Rejected. The complexity is not
justified for a system whose devices are all on one LAN and whose data model
is small and mostly scalar.
