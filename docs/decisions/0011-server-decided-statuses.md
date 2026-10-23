# 0011 — The server decides the part of a status that follows from the money and the date

**Status:** accepted

## Context

An invoice's status is two things at once, and the system used to treat it
as one ordinary field.

Some of it is a decision. A draft invoice is one the school has not issued
yet; a void invoice is one the school has decided not to chase. Both are
judgements somebody made, and they stand until somebody changes them.

The rest of it is a consequence. An invoice that has had half its money
paid against it is partially paid. An invoice that has had all of it paid
against it is paid. An invoice that was issued and whose due date has
passed is overdue. None of these is a fact about the invoice alone: they
follow from the payments received against it and from the date.

Treating the whole thing as one field that anybody may state had three
consequences, and none of them was good.

- A client could state `status: "paid"` on an invoice that had not been
  paid for, and the server stored it. The books then said an invoice was
  paid when no money had arrived, and nothing in the system said so.
- Nothing noticed an invoice passing its due date. The status was a value,
  and the value did not change because the day did. An invoice could sit
  "issued" for a term after it fell due, and the only way to find the late
  ones was to read the list.
- A client that was offline could not tell the school anything true about
  the status either way, because it might not hold the payments.

[Decision 0010](0010-server-kept-totals.md) settled the amount paid and
said, in as many words, that the date-dependent case was a different
problem: _"The recomputation is triggered by writes, not by the passage of
time. A total that depends on today's date — an invoice that becomes
overdue — is a different problem and is not solved by this."_ This is that
problem.

## Decision

A field that is partly a decision and partly a consequence is **decided by
the server, except where a person has chosen**.

The registry says which fields are like this, and how they are decided:

```ts
refined: [
  {
    field: "status",
    choices: ["draft", "issued", "void"],
    decide: invoiceStatus,
  },
];
```

The declaration says that the school chooses between a draft, an issued
invoice and a void one, and that the server works out the rest from the
money received and the date. The rule is the one the domain already
published, `deriveInvoiceStatus`, and it lives in the shared package, so
the client and the server cannot disagree about what an invoice's status
is.

The rule is applied in two places.

- **On every write.** The repository validates the record with the rule
  applied, so a record is right the moment it is written: a payment that
  settles an invoice makes it paid, and a file that says an invoice is paid
  when it is not is told otherwise.
- **Once a day, in a sweep.** An invoice that falls due today is overdue
  today, and no write happened to say so. The sweep asks the registry
  which fields the server decides and re-decides them for every record
  that has one, so it does not need to know what an invoice is. A change
  it makes is an ordinary write: the revision moves on and the change
  reaches the clients through the feed.

The rule needs to know what day it is, and the shared package never reads
a clock. The caller says: the repository passes the date of the write, the
sweep passes the day it runs for, and the importer passes the day the file
is imported on. The same rule can therefore be applied for any date, which
is what makes it testable.

A value a person may choose is still a value a person may state. The
client sends `draft`, `issued` or `void` and the server keeps it. The
other values — `partially_paid`, `paid` and `overdue` — are the server's
to work out, and a client that states one has it replaced by what the
rule says. The interface says which is which, so that a person is not left
wondering why the server disagreed.

## Consequences

**Good.**

- An invoice's status cannot be wrong. It is either a decision somebody
  made or a consequence of the money and the date, and the server holds
  the consequence.
- A client cannot mark an invoice paid to stop the school chasing it. The
  school voids it, which says what it means.
- Late invoices are found without anybody reading a list. The sweep moves
  them, and the change reaches the devices through the same feed as
  everything else, so a phone that has been offline sees the same status
  the server holds.
- The mechanism is generic. A new value that follows from the date is one
  entry in the registry, and the write path, the sweep, the contract check
  and the client's form all follow.
- The rule is testable, because the day is an argument rather than
  something the clock decides.

**Bad, and accepted.**

- A status can be up to a day late. The sweep runs once a day, and until
  it runs the record holds the status the last write gave it. A school
  that wants the status to change the moment the clock passes midnight
  would need the sweep to run more often, and the cost is a pass over
  every record that has a decided value.
- The rule is applied to the record as it is, so a person who puts an
  invoice back to `draft` after money has arrived against it gets a draft
  with money against it. The school has a `void` for that; the system
  does not second-guess the decision.
- A file that states a status the server will change is not reported as a
  problem. The preview shows the record that will be stored, which is the
  truth, but the person who made the file is not told that their file
  said something else. The total is still reported, because a total that
  disagrees with a file's own line items is a contradiction inside the
  file rather than a difference of opinion with the server.
- The client's replica holds the server's status, and the client cannot
  work out a fresher one: it may not hold the payments. The status a
  device shows offline is the status the server last sent.

## Alternatives considered

**Store the decision and the consequence in two fields.** Rejected. It
would be the most literal reading of "separated", but it gives one fact
two names, and every consumer of the record — the table, the form, the
export, the report — has to know which of the two it is holding and how
to combine them. The consequence is recoverable from the status: an
invoice that is not a draft and not void was issued.

**Compute the status when the record is read.** Rejected. The client would
have to compute it too, and it cannot: it may not hold the payments, so
its answer would be a guess. The server's books and the phone in a
teacher's bag would disagree, which is the failure this whole design is
about avoiding.

**Let the client state the status and let the server check it.** Rejected,
for the same reason as the total in
[decision 0009](0009-server-derived-fields.md): a check is a second copy of
the rule, and a client that sends a whole record still has to be right
about the status every time.

**Leave the status alone and add a report of late invoices.** Rejected. It
answers a question ("which invoices are late?") rather than keeping a
record right, and the answer would have to be worked out again by whoever
asks it next.

**Sweep every hour rather than every day.** Rejected for now, but it is a
configuration value rather than a decision: `SCHOOL_SWEEP_INTERVAL_MS`
changes it without a code change. A day is enough for a school, and a
shorter interval is a pass over every record that has a decided value.
