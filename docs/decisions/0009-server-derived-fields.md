# 0009 — The server computes the values that follow from other values

**Status:** accepted

## Context

An invoice's total is the sum of its line items. A client that is asked to
state the total has to re-implement that rule, and a client that gets it
wrong is not obviously wrong: the value looks like a number somebody typed.

The problem is not that a client _can_ get it wrong. It is that the school
then has two answers to one question — the total the file said and the total
the line items add up to — and no way to tell which one the office meant. A
conflict resolution rule can settle two edits to the same field, but it
cannot settle a field against a rule.

The system already had a cross-field check for this: an `invariant` on the
invoice, which the registry validated on every write. It worked, but it had
the shape of a _refusal_. A client that sent a wrong total got a 422 and the
record was not saved, so the only way to get an invoice into the system was to
know the answer before asking the question.

## Decision

A value that follows from other values is **computed by the server and never
stated by a client**.

The registry says which fields are like this, and how to work them out:

```ts
derived: [{ field: "totalAmount", from: "lineItems", compute: invoiceTotal }];
```

From that one entry the whole system follows:

- the create and patch schemas leave the field out, so a client is never
  asked for it and an old client that sends it is not rejected;
- the sync engine drops it from a client's patch, so a client cannot state
  it;
- the repository works it out on every write, so the stored value is the
  server's own;
- the client works it out with the same rule, so the figure a person sees on
  an offline device is the figure the server will store;
- the CSV importer compares a file's stated total with the sum of the file's
  own line items, and reports a disagreement as a problem with that row.

The rule lives in the shared package, so the client and the server cannot
disagree about what the total is.

## Consequences

**Good.**

- A client cannot state a value the school already knows how to work out, so
  a wrong total cannot be stored, synced or imported.
- An invoice is saved by stating its line items. The person entering it never
  has to do arithmetic, and never has to know the answer in advance.
- The offline device shows the total the invoice will have, because it uses
  the same rule rather than a stale copy of the last total.
- A file that disagrees with itself is reported to the person who made it
  instead of being quietly corrected. A typo in a spreadsheet is a fact about
  the file, and the office is the one who can say what it meant.
- The mechanism is generic. A new computed field is one entry in the registry,
  and the routes, the sync engine, the importer and the form all follow.

**Bad, and accepted.**

- The server must be able to recompute the value, so a derived field is only
  possible where the rule reads from data the record carries. A total that
  needs the payment history is not derivable from an invoice alone, and stays
  a field the server maintains separately.
- A rule the server cannot evaluate leaves the value as the client sent it,
  so that the schema reports the real problem — a malformed line item list
  rather than a total that happens to be wrong.
- The client carries a second implementation of the rule, in the shared
  package, rather than only the server's. It is the same code, so it cannot
  drift; but it does mean the browser bundle grows by the size of the rule.

## Alternatives considered

**Keep the invariant and reject a wrong total.** Rejected. It is the same
rule, but it makes the client responsible for computing a value it is not
supposed to know, and it turns a routine save into a failure whenever the
arithmetic is done by hand somewhere else.

**Let the client state the total and let the server check it.** Rejected. The
server would then have two defensible answers, and the check would be a
second copy of the rule rather than the rule itself.

**Work the total out in the client and store the client's value.** Rejected.
That makes the replica's value authoritative, which is the opposite of
[decision 0001](0001-server-authoritative.md).

**Recompute the value only when it is read.** Rejected. A stored value that
does not match the rule is a value that has to be trusted, and the whole point
is that it is not trusted: it is derived, every time, from the data it
follows from.
