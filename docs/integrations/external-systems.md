# External systems

The system is designed to be the record of truth for a school, and schools
inevitably have to report to somebody else. This document describes the
integration surface that exists today, and the shape the parts that are not
built yet are designed to take.

## What exists today

### Government reporting

A school has to report enrolment, attendance and fee collection to a ministry.
The data needed for that report is present in the system, and the parts of it
that a report needs are already modelled in a reportable way:

- **Enrolment** is a first-class entity with a status and a start date, so a
  headcount is a query rather than a report to write.
- **Attendance** is keyed by `(studentId, classId, date)`, which is the shape
  a ministry form asks for.
- **Money** is in integer minor units, so a sum is exact.
- **Identifiers** are stable and opaque, so a report can be re-run and
  reconciled.

What is missing is the report itself. The intended shape is a
`/api/v1/reports/<name>` family of endpoints that return a report in a
documented JSON shape, with the report definitions in the shared package so
that the client can render them too.

### Mobile money and bank feeds

A payment records how it was received (`method`) and, for a payment that came
from a gateway, the gateway's own identifier (`externalReference`). The
`ExternalReference` shape in the shared package — a system name and an
identifier within that system — is what a gateway integration would use.

The intended shape is a **poll-and-match** integration rather than a webhook
receiver:

1. A script polls the gateway for new transactions and writes them into the
   server's `outbox` table.
2. A worker reads the `outbox`, matches a transaction to an invoice, and
   creates a `payment`.
3. The `idempotency_key` column of the `outbox` makes a repeated poll
   harmless.

The `outbox` table already exists in the schema for exactly this purpose. It
is not yet written to or read by the server; see the roadmap.

### Accounting and payroll exports

An accountant wants a ledger, not a school database. The JSON and NDJSON
exports provide what is needed: a stable, self-describing, complete set of
invoices and payments with exact amounts and ISO dates. The `InvoiceLine`
schema carries an `accountCode` for exactly this reason — a chart-of-accounts
code that the school's accountant can map into their own system.

### The `externalReference` on a record

`ExternalReference` is a `{ system, externalId }` pair, and the intent is that
a record can carry a link to its counterpart in another system. It is not yet
used by any entity schema; adding it to `Student` and `Invoice` is a
one-line change to the shared schema, after which the API, the client form and
the export all follow.

## What is deliberately not built

**A webhook receiver.** A school server is behind a NAT on a school LAN and
has no public address, so it cannot receive an inbound webhook. Any
integration that needs to reach the school has to poll it.

**A plugin system.** Loading third-party code into the school server means
running untrusted code with access to every student's record. The surface is
deliberately narrow instead: a documented HTTP API, a documented file format
and a scheduled script.

**A general-purpose integration marketplace.** Rejected. A school needs two or
three integrations, not a platform.

## Designing a new integration

The pattern that fits this system:

1. **Never write to the entity tables directly.** Use the API, or the sync
   push endpoint with client-minted operation identifiers. An integration that
   writes to SQLite behind the repository's back would not produce change-feed
   entries, and its writes would never reach the offline devices.
2. **Use the `opId` for idempotency.** A retried push is recognised, so an
   integration can retry freely.
3. **Use the business key for matching, not the identifier.** A payment from a
   gateway carries the school's own invoice number, not the server's ULID.
4. **Write into the `outbox` for anything that has to be retried.** The table
   has `status`, `attempts`, `available_at` and `last_error` columns, which is
   everything a retrying worker needs.

## See also

- [CSV interchange](csv-interchange.md)
- [JSON and NDJSON interchange](json-interchange.md)
- [The OpenAPI document](openapi.md)
