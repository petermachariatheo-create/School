# 0001 — The server is authoritative; clients hold a replica

**Status:** accepted

## Context

A school runs on one network and, often, on one laptop. Devices go in and out
of network coverage constantly: a teacher in a classroom with thick walls, an
administrator on a field trip, a phone in a pocket with the screen off for an
hour. The system has to keep working through all of it, and it has to be clear
afterwards who is right when two devices disagree.

Two models were considered.

**Peer-to-peer.** Every device holds an equal claim to be the source of truth.
Writes propagate to peers and conflicts are merged locally. This needs a
conflict-free replicated data type or a similar machinery, and it needs every
device to be online at the same time for a change to be durable somewhere.

**Authoritative server with local replicas.** The server holds the canonical
state. Clients keep a copy for reading and queue their writes for the server
to accept or refuse.

## Decision

The server is the single authority for every record's content and revision.
Clients hold a **replica** for reading and a **durable outbox** for writing.
The server decides, and it tells the client what it decided.

## Consequences

**Good.**

- A record has exactly one revision, decided in exactly one place. There is no
  "which copy is newer" question to answer.
- A device that has been offline for a week is brought up to date with one
  snapshot request.
- Conflicts are resolved by a rule that can be explained to an administrator in
  one sentence, and the losing device is told which fields it lost.
- The client stays simple: a replica, a queue and a synchronisation loop. There
  is no merge algorithm in the browser.

**Bad, and accepted.**

- The server must be reachable for a change to become durable. This is the
  real constraint of the design, and it is why the outbox is durable and why
  the interface shows how many changes are still waiting.
- The server is a single point of failure. A school server on a school laptop
  is cheap to restore from a backup; see
  [`../operations/backup-and-restore.md`](../operations/backup-and-restore.md).
- A client that is offline for a long time can drift behind. The server
  detects this and tells the client to take a snapshot rather than pretending
  it can catch up incrementally.

## Alternatives considered

**Peer-to-peer with a CRDT.** Rejected. It would make the browser bundle
larger, make the conflict story harder to explain, and offer nothing to a
single-school system whose devices are all on one LAN. The complexity is only
justified when there is no server to be authoritative.

**Last-writer-wins on the client, no server review.** Rejected. A school
administrator would have to reconcile the records by hand, and "whose clock was
right" is not an answer an administrator can verify.

**Optimistic concurrency with an explicit merge UI.** Rejected for now. The
field-level rule resolves most conflicts without human involvement, and a
merge interface is a large amount of work for the small number of cases that
remain.
