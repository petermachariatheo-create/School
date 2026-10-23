# 0008 — Soft deletes, so that a deletion reaches offline devices

**Status:** accepted

## Context

A student leaves the school. Their record must be deleted — but several
devices are offline, and each of them holds a copy of the student that it will
one day offer to edit.

If the deletion is a hard delete, the server removes the row. An offline
device that later syncs will pull a change feed that does not mention the
student at all, so it will keep showing the student forever, and if the user
edits that record the server will happily create it again.

## Decision

**Deletion is a soft delete.** The row stays, `deleted_at` is set, and the
change feed records a `delete` operation for it.

- A `delete` change carries `record: null`; the client keeps the last known
  content and marks the record as deleted.
- The client shows deleted records struck through, with a "Deleted" badge, so
  that a deletion is visible rather than merely absent.
- A client that edits a record the server has deleted is **rejected**, not
  resurrected: the server reports that the record was deleted and cannot be
  modified.
- Unique indexes on business keys are **partial** — they exclude soft-deleted
  rows — so an admission number freed by a departure can be issued again.

## Consequences

**Good.**

- A deletion propagates to every device through exactly the same mechanism as
  an insertion or an update. There is no second path to get wrong.
- The change history keeps the deleted record's content, so a conflict can
  still be reasoned about, and an accidental deletion can be investigated.
- Business keys can be reused after a deletion, which they could not be with a
  hard delete and a global unique index.

**Bad, and accepted.**

- Deleted rows are still stored. The tables grow with the school's history.
  This is bounded in practice — a school deletes a handful of records a year —
  and a purge tool would be a straightforward addition.
- Every query has to filter `deleted_at IS NULL`. The repository does this
  centrally, so a query that forgets it would be a bug in the repository rather
  than in each call site. `includeDeleted: true` exists for the cases that
  genuinely need the history.
- The unique index is partial, so the uniqueness guarantee is "among live
  records" rather than "among all records". That is the intended semantics.

## Alternatives considered

**Hard delete plus a tombstone table.** Rejected. It needs a second write path
and a second read path for the same information.

**Hard delete, and let a full snapshot reconcile it.** Rejected. A snapshot is
a heavyweight operation to run on every sync, and the tombstone is the same
information carried more cheaply.
