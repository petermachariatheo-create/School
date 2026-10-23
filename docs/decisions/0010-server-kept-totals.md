# 0010 — The server keeps the totals; the client shows the server's figure

**Status:** accepted

## Context

An invoice's total is the sum of its line items: the whole record carries
everything the rule needs, so the client can work it out as well as the
server. [Decision 0009](0009-server-derived-fields.md) settled that case, and
the client now shows a total it computes itself.

An invoice's **amount paid** is a different thing. It is the sum of the
payments received against the invoice, and those payments are records of
their own. A device may hold some of them, all of them, or none of them: a
teacher's phone may have been offline for a week while the bursar's laptop
took every payment.

So the client cannot work the amount paid out. Whatever it computed would be
a guess — and a guess that differs from the server's figure, which is the one
the school's books are kept in.

The field also had a worse problem before: it was an ordinary field that
anybody could state. A client could send `paidAmount: 999`, and the server
would store it, because nothing checked it against the payments. The stored
figure and the payments then disagreed, and nothing in the system said so.

## Decision

A value that is a total of other records is **kept by the server** and shown
by the client.

The registry says which fields are like this, and how they are worked out:

```ts
aggregates: [
  {
    field: "paidAmount",
    source: "payment",
    via: "invoiceId",
    sumOf: "amount",
    match: { currency: "currency" },
  },
];
```

The declaration says that an invoice's `paidAmount` is the sum of the
`amount` of the `payment` records whose `invoiceId` points at that invoice
and whose currency is the invoice's currency.

From that one entry the whole system follows:

- the field is left out of the create and patch schemas, so a client is
  never asked for it and cannot state it;
- the sync engine drops it from a client's patch;
- the server recomputes it after every write — of the record that holds it,
  and of any record it is a total of — inside the same transaction as that
  write, so a payment and the invoice it changes are committed together;
- the recomputed value is an ordinary write: it is validated, its revision
  moves on, and the change reaches the clients through the feed;
- the client shows the server's last figure and never asks for it.

Money is only added up in one currency, which is what the `match` clause is
for: a payment in another currency is not part of the invoice's total.

## Consequences

**Good.**

- The amount paid on an invoice is always the sum of the payments against
  it. It cannot be stated wrongly, by a client, a file or a seed.
- Paying an invoice updates it. The payment and the new figure arrive
  together, in one transaction, so a device never sees one without the
  other.
- The mechanism is generic. A new total is one entry in the registry, and
  the server's write path, the sync engine, the contract check and the
  client's form all follow.
- The client is honest: it shows the server's figure rather than a figure of
  its own that may be wrong.

**Bad, and accepted.**

- A total is stored, not computed at read time, so it is a value that has to
  be kept right rather than a value that cannot be wrong. The server keeps it
  right on every write; the cost is a second write per payment.
- The recomputation is triggered by writes, not by the passage of time. A
  total that depends on today's date — an invoice that becomes overdue — is
  a different problem and is not solved by this.
- The client cannot show a total that is current while it is offline. It
  shows the server's last figure until it syncs, which is the honest answer
  but not always the most useful one.
- Money is only added up within one currency. A school that invoices in one
  currency and receives payment in another has to convert before recording
  the payment; the system will not do it silently.

## Alternatives considered

**Keep the field ordinary and check it against the payments.** Rejected. It
leaves the server choosing between two figures when they disagree, and it
makes the correct value depend on the client having done the sum.

**Let the client work the total out locally and send it.** Rejected. The
client's payment set is not the school's payment set, so the figure would be
a guess, and the server would have no way of telling a guess from a fact.

**Compute the total at read time instead of storing it.** Rejected for now.
It would make the total impossible to get wrong, but it changes the shape of
the record — a field that is stored in one place and computed in another is
two definitions of the same thing, and every consumer of the record has to
know which one it is holding. It is worth revisiting for totals that are read
far more often than they are written.

**Recompute the totals on a schedule rather than on a write.** Rejected. A
payment would not appear on the invoice until the next run, which is a
window in which the school's books are wrong.
