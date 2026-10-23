# The domain model

## Entities

All ten entity types are defined in `packages/shared/src/domain/` and registered
in `packages/shared/src/registry.ts`.

| Type                | Table                | REST path                    | Business key                            |
| ------------------- | -------------------- | ---------------------------- | --------------------------------------- |
| `student`           | `students`           | `/api/v1/students`           | `admissionNumber` (unique)              |
| `guardian`          | `guardians`          | `/api/v1/guardians`          | `firstName`, `lastName`, `email`        |
| `student_guardian`  | `student_guardians`  | `/api/v1/student-guardians`  | `studentId`, `guardianId` (unique)      |
| `class`             | `classes`            | `/api/v1/classes`            | `name`, `academicYear` (unique)         |
| `enrollment`        | `enrollments`        | `/api/v1/enrollments`        | `studentId`, `classId` (unique)         |
| `attendance`        | `attendance`         | `/api/v1/attendance`         | `studentId`, `classId`, `date` (unique) |
| `assessment`        | `assessments`        | `/api/v1/assessments`        | `classId`, `title`, `date`              |
| `assessment_result` | `assessment_results` | `/api/v1/assessment-results` | `assessmentId`, `studentId` (unique)    |
| `invoice`           | `invoices`           | `/api/v1/invoices`           | `invoiceNumber` (unique)                |
| `payment`           | `payments`           | `/api/v1/payments`           | `paymentNumber` (unique)                |

The business key is what an import uses to recognise a record it has already
seen. Unique keys are enforced by a partial unique index that ignores
soft-deleted rows, so a student who leaves and a new student takes the same
admission number is not blocked.

## Fields every entity carries

`EntityMeta` (`packages/shared/src/domain/common.ts`):

| Field       | Meaning                                                                                 |
| ----------- | --------------------------------------------------------------------------------------- |
| `id`        | A ULID. Opaque to users, sortable by creation time.                                     |
| `revision`  | Incremented on every write. A client states the revision its edit was based on.         |
| `createdAt` | ISO-8601 UTC instant.                                                                   |
| `updatedAt` | ISO-8601 UTC instant.                                                                   |
| `deletedAt` | ISO-8601 instant, or `null`. Deletion is soft so that it propagates to offline clients. |

These five fields are **server-managed**. A client may send them; the server
discards them rather than rejecting the request, so a client that sends a whole
record still works and stays forward compatible with newer field sets.

The fields the server works out for itself — an invoice's `totalAmount` — are
server-managed in the same way, and for the same reason. So are the totals it
keeps up to date — an invoice's `paidAmount`. The list of all three is
`registry.serverOwnedFields(type)`, so there is one answer to "what may a
client state?" rather than three that can drift apart.

## Money

Amounts are **integers in the currency's minor units**. `0.1 + 0.2 !== 0.3` is
not an acceptable property for a school's ledger, so no monetary value is ever
a floating-point number.

An invoice's `totalAmount` is not a fact a client states. It is the sum of the
line items, so the server works it out and discards whatever a client sends.
That rule lives in the registry as a `derived` entry:

```ts
{
  type: "invoice",
  // ...
  derived: [
    { field: "totalAmount", from: "lineItems", compute: invoiceTotal },
  ],
}
```

The consequence is that a client is never asked for a value the school already
knows how to work out. The create and patch schemas leave the field out
entirely, the sync engine drops it from a client's patch, and the client shows
it as a figure it cannot type.

The same rule is what makes the file a user hands over trustworthy: the CSV
importer compares the total a file states with the sum of the file's line
items, and reports a disagreement as a row-level problem rather than quietly
correcting the file. See
[`../integrations/csv-interchange.md`](../integrations/csv-interchange.md).

A rule that only says "this field may not be smaller than that one" is
different: it does not have a single answer the server can compute, so it
stays an `invariant` function in the registry, and the registry validates it
on every write.

## Totals

Some values are not facts at all but totals of other records: an invoice's
`paidAmount` is the sum of the payments received against it. The registry
says so, too:

```ts
aggregates: [
  {
    field: "paidAmount",
    source: "payment",
    via: "invoiceId",
    sumOf: "amount",
    match: { currency: "currency" },
  },
],
```

The declaration names the records that are totalled, the field that points
at the invoice, the field that is added up, and the fields that have to
match before a record counts. The server keeps such a field right after
every write — of the record that holds it, and of any record it is a total
of — inside the same transaction as the write that caused it.

A total is different from a derived value in one important way: the client
cannot work it out. A device may hold some of the payments, all of them, or
none of them, so a figure it computed would be a guess. The client therefore
shows the server's last figure and never asks for the field.

See
[`../decisions/0010-server-kept-totals.md`](../decisions/0010-server-kept-totals.md).

## Statuses

An invoice's status is two things at once. A `draft` and a `void` invoice
are a decision the school made, and the decision stands. The other statuses
follow from the money received against the invoice and from the date, and
the server works them out.

The registry says so:

```ts
refined: [
  {
    field: "status",
    choices: ["draft", "issued", "void"],
    decide: invoiceStatus,
  },
],
```

The declaration names the values a person may choose and the rule that
decides the rest. The rule is applied on every write — so a payment that
settles an invoice makes it paid — and once a day by a sweep, because an
invoice that falls due today is overdue today and no write happened to say
so. The sweep asks the registry which fields the server decides, so it does
not need to know what an invoice is.

The rule needs to know what day it is, so the shared package never reads a
clock: the repository passes the date of the write, the sweep the day it
runs for, and the importer the day the file is imported on.

See
[`../decisions/0011-server-decided-statuses.md`](../decisions/0011-server-decided-statuses.md).

## Dates and times

- **Instants** (`createdAt`, `updatedAt`, `receivedAt`, `gradedAt`) are
  ISO-8601 UTC: `2026-10-20T08:30:00.000Z`.
- **Calendar dates** (`dateOfBirth`, `date`, `issueDate`, `dueDate`) are
  timezone-free: `2026-10-20`. A school's attendance day is not an instant.

The client renders an instant as a plain text field and normalises what the user
types (`2026-10-20T08:30` becomes `2026-10-20T08:30:00.000Z`), because a native
`datetime-local` control produces a local time with no zone, which the
contract would reject.

## Cross-entity links

Links are first-class entities, not embedded arrays:

- A **guardian** is a person in their own right, because one guardian commonly
  has several children.
- A **student-guardian link** carries its own attributes (`relationship`,
  `isPrimary`), which an embedded array could not do.
- An **enrolment** is a record in its own right because a student can be
  enrolled in several classes over several years, and an enrolment has a status
  and a start date.
- **Attendance** is keyed by `(studentId, classId, date)`: a student attending
  two classes on the same day has two records.

## Identifiers

Every externally visible identifier is a ULID: 48 bits of millisecond
timestamp, then 80 bits of entropy, in Crockford Base32.

- It is **opaque**, so it leaks nothing about creation time or volume.
- It **sorts by creation time**, which makes it a usable keyset cursor without a
  separate sequence.
- It can be **minted on an offline device**, so a record created in a field with
  no signal already has its final identity before it reaches the server.

The implementation is local (`packages/shared/src/ids/ulid.ts`) so that neither
the server nor the browser bundle needs a dependency for it.

## Adding an entity type

See [`../development/adding-an-entity-type.md`](../development/adding-an-entity-type.md).
In short: write a Zod schema, add one entry to the registry, and the API, the
sync engine, the import/export pipeline, the OpenAPI document and the client
form all follow.
