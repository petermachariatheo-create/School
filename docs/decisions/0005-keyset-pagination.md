# 0005 — Keyset pagination, not offset pagination

**Status:** accepted

## Context

Every collection endpoint returns pages. The list of students in a school with
two thousand students is read a page at a time by the client, and by anyone
importing data through the API.

Offset pagination (`LIMIT 50 OFFSET 1000`) has two problems here:

1. **It is slow at depth.** SQLite has to count and discard the skipped rows.
2. **It is wrong under concurrent writes.** If a student is inserted between
   two requests, every subsequent page shifts by one and a record is returned
   twice or not at all. A client paging through students while the office
   admits a new one would silently see the wrong data.

## Decision

Use **keyset pagination** on the primary key.

The `id` is a ULID, whose lexicographic order is its creation order, so
`WHERE id > ?` is both an index seek and a stable sort. The response carries
`nextCursor`, which is the last id of the page, or `null` when the collection
is exhausted.

```json
{ "items": [ ... ], "nextCursor": "01ARZ3NDEKTSV4RRFFQ69G5FAV", "total": 2003 }
```

`total` is the count of the records matching the filter, which is cheap here
because the filter is applied in SQL.

## Consequences

**Good.**

- A page costs the same whether it is the first or the hundredth.
- Paging is stable under concurrent writes: a record inserted after a page was
  read is simply after the cursor and appears on a later page, and a record
  that is deleted before its page is read is not returned twice.
- The cursor is opaque to the client, so the implementation can change without
  breaking clients.

**Bad, and accepted.**

- A client cannot jump to an arbitrary page number. It has to walk to it. For
  a school system this is the right trade: the interface shows a filtered list,
  not a paginated report.
- The sort order is the identifier order, which is creation order. A user
  would sometimes prefer alphabetical order. The client sorts in memory, which
  is fine for the number of records a school holds.

## Alternatives considered

**Offset pagination.** Rejected for the correctness problem under concurrent
writes and the cost at depth.

**A total-count-only API with no pagination.** Rejected: the client's first
sync would have to download the entire school in one response.

**A separate sort column.** Not needed. The ULID's creation-time ordering is
both stable and indexable.
