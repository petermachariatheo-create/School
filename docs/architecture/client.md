# The client

The client is an installable progressive web application. It is a single page
application built with React 19 and Vite 8, and it works with the network
switched off.

## The three layers

```
┌─────────────────────────────────────────────────────────────┐
│  Interface (React)                                          │
│  App · RecordTable · RecordWorkspace · ImportDialog         │
│         reads from ─┐                                       │
│                      ▼                                       │
│  Application state (store.tsx)                              │
│  version counter, sync status, error banner                 │
│         │                                    │              │
│         ▼                                    ▼              │
│  Replica (IndexedDB)  ◄───────────────  Sync engine        │
│  records of every entity type          pull + push          │
│         ▲                                    │              │
│         └──────────  Outbox (IndexedDB)  ◄───┘              │
│                     durable queue of local changes           │
└─────────────────────────────────────────────────────────────┘
```

### The replica

`packages/web/src/data/replica.ts`. One IndexedDB object store, `records`, keyed
by `[entityType, id]`. The key is a compound key rather than a separate store
per entity type, so adding an entity type to the system needs no client
migration.

A replica record holds the entity's business fields plus the metadata the
client needs to make decisions:

```ts
interface ReplicaRecord {
  entityType: string;
  id: string;
  revision: number; // the server revision this copy is based on
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  data: Record<string, unknown>;
  pending: boolean; // true while there are unsent local changes
}
```

Reads always come from here. The interface renders the same data whether the
device is connected or not.

### The outbox

`packages/web/src/data/outbox.ts`. Another IndexedDB store, keyed by `opId`.

An entry is written before the interface acknowledges an edit, and removed only
when the server confirms it. An entry the server rejects stays in the outbox,
marked failed, and is shown in the interface so the user can see that a change
did not reach the server.

### The sync engine

`packages/web/src/sync/engine.ts`. Runs a cycle:

1. Push the pending outbox entries (up to 100 at a time).
2. Pull the change feed until the server says there is nothing more.
3. Take a snapshot instead if the server reports that the cursor is too old.
4. Record the cursor and the time of the last successful sync.
5. Tell the server how far this device has read, so the change log is not
   pruned out from under it.

Concurrent calls share one cycle: the interface, the online/offline listener
and the 30-second timer can all ask for a sync without the server receiving the
same batch twice.

## Reactivity

IndexedDB is not reactive, so the store keeps a `version` counter. Anything
that mutates the replica bumps it, and the `useRecords` and `useOutbox` hooks
re-read from IndexedDB when it changes.

This is deliberately simple. A reactive wrapper around IndexedDB would remove
about forty lines of code and add a dependency; the counter is easy to reason
about and has no behaviour of its own to get wrong.

## Schema-driven forms

The client does not hard-code a form per entity type. It reads the JSON Schema
that the shared registry generates from the same Zod schema the server validates
with, and derives the fields from it:

| JSON Schema shape                     | Form control                       |
| ------------------------------------- | ---------------------------------- |
| `type: "string"`                      | Text input                         |
| `type: "string", format: "date"`      | Date input                         |
| `type: "string", format: "date-time"` | Text input, normalised to UTC      |
| `type: "string", enum: [...]`         | Select                             |
| `type: "number"` / `"integer"`        | Number input                       |
| `type: "boolean"`                     | Checkbox                           |
| `type: "object"` / `"array"`          | JSON text area                     |
| `type: [..., "null"]`                 | The above, plus a "not set" toggle |

A field added to the domain model therefore appears in the interface with no
client change at all.

The schema also says more than the type: a field's `default`, its `minimum`
and `maximum`, its `maxLength`, its `format` and a short hand-written
`pattern`. The client uses them to start a form on the school's own defaults
and to tell the user what a field accepts before they break it.

## The record workspace

A record is edited on a page of its own, not in a panel over the table. The
reason is that a form is a page: it has a beginning and an end, the fields
need room, and the action that matters belongs next to the fields rather
than pinned to the bottom of a strip that covers the data.

`packages/web/src/components/RecordWorkspace.tsx`. The workspace holds the
form, a rail with the record's own metadata, and an action bar. It never
talks to the server: it writes to the local replica and the durable outbox,
and the sync engine takes it from there.

The rules of the form are not in the component. They are in
`packages/web/src/app/form.ts`, as plain functions:

| Function              | What it does                                               |
| --------------------- | ---------------------------------------------------------- |
| `initialFormState`    | Starts a form from a record, or from the schema's defaults |
| `setValue`, `setJson` | Record a change and remember that the field was touched    |
| `collect`             | Reads the form into a patch and a problem per field        |
| `computedValues`      | Works out the values the server will work out              |
| `isDirty`             | Says whether the form holds anything the record does not   |
| `fieldHint`           | Says in words what a field accepts                         |

A problem belongs to the field it is about, so it is shown under that field
rather than in a list at the top of the page. A field the user has not
touched is not complained about until they try to save.

The arrangement of the form comes from `packages/web/src/app/catalog.ts`.
The catalogue groups the entity types the way the school thinks about them
(People, Academic, Finance) and says which part of a form each field
belongs to. A field the catalogue does not place is still shown, in a final
"Details" section: nothing in the domain model may become unreachable from
the interface.

## Values the client does not ask for

Some values are not facts a person states but consequences of other facts: an
invoice's total is the sum of its line items. The registry says so, and the
client obeys:

- the field is **shown** rather than asked for, so a person can see the total
  of an invoice while they enter the line items that make it up;
- the value shown is **worked out by the client**, with the same rule the
  server uses, so it is right even when the device is offline and the server
  cannot be asked;
- the field is **never sent**. The server works it out for itself, and a value
  a client sends is discarded.

The local replica carries the worked-out value as well, so a record edited
offline shows the total it will have when it reaches the server, not the total
it had.

This is the client half of the rule described in
[`data-model.md`](data-model.md#money). A client that stated its own total
would eventually state a wrong one, and the server would have no way of
telling a mistake from an intention.

### Totals the server keeps

Some values follow from _other records_ rather than from the record itself:
an invoice's amount paid is the sum of the payments received against it. The
client cannot work those out, because its own copy of the school may be
missing a payment — so it shows the server's last figure instead, and still
never asks for the field.

The distinction is worth keeping straight:

| Kind             | Follows from            | The client shows         |
| ---------------- | ----------------------- | ------------------------ |
| A computed value | the record's own fields | a figure it works out    |
| A total          | other records           | the server's last figure |

Both are server-owned: neither is asked for, and neither is sent.

### Values the server decides

Some fields are a decision and a consequence at once. An invoice's status is
a draft or a void one because the school said so, and partly paid or overdue
because of the money and the date. The client offers the values a person may
choose — a draft, an issued invoice, a void one — and the field's hint lists
the values the server works out, so that a person is not left wondering why
the server disagreed.

The status a device shows is the server's last one. The client cannot work
out a fresher answer: it may not hold the payments, and the date on its own
clock is not the school's answer either.

## The record table

`packages/web/src/components/RecordTable.tsx`. The columns are derived from
the entity schema too, but which fields are shown is a presentation decision,
so it lives in the client rather than in the shared contract. A short list of
preferred fields (the ones that identify a record) is tried first; the rest
follow, and no table shows more than six columns.

The replica holds the whole school in the device, so a list is paged rather
than allowed to grow without limit. The arithmetic is in
`packages/web/src/app/pagination.ts` — a page outside the list is clamped to
the nearest one that exists, so a page left over from a longer list never
shows an empty table — and the pager offers the first page, the last page and
the pages either side of the one being shown. The pager is one component
(`packages/web/src/ui/Pager.tsx`), so that a list of cards and a list of rows
are paged in the same way.

## The student list

`packages/web/src/components/RecordGrid.tsx` and `RecordCard.tsx`. A school
holds thousands of students, and a person looking for one of them is looking
for a face and a name rather than a row of columns, so the people are shown
as cards in a grid.

The card has a fixed structure, so that a list of cards can be scanned down
the middle rather than read: the admission number and the edit button above,
the name, one status badge, a divider, and the details below it. The cards
in a row are the same height, so their footers line up. One card is shown
on a phone, two on a tablet, and as many as the width allows on a desktop.
A dense table of the same students is one click away for somebody who wants
the columns instead.

The card is the same for every record type; which facts it shows at the
foot is in the catalogue (`cardSpecFor`), because a student's facts are not a
guardian's. A card's context — the year a class belongs to, the admission
number of a student — is in the same place, and a record with no context of
its own shows none.

## The profile and the form

`packages/web/src/components/form/`. A record can be **read** and it can be
**changed**, and they are different things.

A profile is a record read as a record: who it is, what state it is in, what
can be done to it, the facts in the groups the catalogue says, and the
records that point at it. A form is a record being changed, and it is built
from the same groups and the same field descriptions, so the two agree.

| Piece                      | What it is                                                    |
| -------------------------- | ------------------------------------------------------------- |
| `RecordProfile`            | A record, read: the heading, the groups, the related records. |
| `RecordEditor`             | A record, changed: the groups, the note, the action bar.      |
| `FormSection`              | A group of fields, and a group of values to read.             |
| `FormField`                | A label, a control, a hint and a problem, in one place.       |
| `FormActions`              | The action bar, and what the form is saying about itself.     |
| `ProfileHeader`            | The identity of a record and the actions on it.               |
| `DraftStatus`              | One way of saying saved, waiting, refused or not yet saved.   |
| `RelatedRecordPicker`      | Choosing the record a field points at, by name.               |
| `ConfirmDestructiveAction` | Saying what deleting something will do.                       |

Two rules make this work everywhere rather than one record type at a time.

- **A field that points at another record is asked for by name.** A field
  named after a type — "studentId" — points at a record of that type, and
  the client holds the whole school, so the field offers a searchable list of
  names instead of asking for an identifier. The rule is the same for every
  type, so nothing has to be said about any one of them.
- **The groups come from the catalogue.** `sectionsFor` says which group a
  field belongs to, so the profile and the form show the facts in the order
  the school thinks in, and a new record type gets a form without any work.

The student and the guardian are the first record types to have a profile,
and the people are shown as cards rather than as columns. The others open
straight into the form, as they always have, and will follow once the
pattern has been looked at.

Leaving a form that holds unsaved work is asked about, whichever way the
person leaves: the buttons in the form, or the back gesture on a phone. The
guards are in `packages/web/src/app/guards.ts`.

## The timetable

`packages/web/src/components/TimetableWeek.tsx` and `TimetablePage.tsx`. A
timetable is a week, not a list of rows, so it is drawn as one: five days as
columns on a wide screen, the way a timetable is written on a wall, and
stacked on a phone. Each lesson says when it is, what it is, who teaches it
and where.

The lessons are their own records, so the same week answers two questions: a
class's own week, and the week of the classes a student is enrolled in.
The page lists the classes collapsed and opens the one that is chosen, and
the day it is today is marked.

## The design system

`packages/web/src/ui/` holds the primitives: `Button.tsx`, `icons.tsx`,
`StatusBadge.tsx` and `Pager.tsx`. There is no component library and no icon
font, because a school that installs the client offline should not have to
fetch anything to render a page.

`packages/web/src/styles.css` is in four layers, in this order: tokens
(the colours, the type, the spacing and the measure), primitives (the button,
the pill, the field), the shell (the bar, the navigation, the content area)
and the components (the table, the cards, the workspace, the panels). A layer
may only use the layers above it, so a change to a token reaches every screen
and a component can never invent a colour of its own.

The type is three levels and no more — a page heading, a title and the words
that support them — and the spacing is a four pixel scale, so that everything
lines up with everything else. The rules behind them are in
[`../ui-ux-principles.md`](../ui-ux-principles.md).

`scripts/inspect-client.mjs` opens the client in a headless browser and
takes pictures of it at three widths. It is how the layout is checked without
a person in the loop.

## The service worker

`vite-plugin-pwa` generates the service worker. It **precaches the application
shell** — HTML, JavaScript, CSS, icons and the manifest — so the client starts
and renders with no network.

It deliberately does **not** cache API responses:

```ts
runtimeCaching: [
  { urlPattern: ({ url }) => url.pathname.startsWith("/api/"), handler: "NetworkOnly" },
];
```

A second cache of API responses would be a second, differently-shaped copy of
data that the replica already owns, and the two would inevitably disagree. The
replica is the client's only cache of record data; the service worker caches
only the program.

See [`../decisions/0007-no-api-response-cache.md`](../decisions/0007-no-api-response-cache.md).

## Offline export

CSV export is produced **from the local replica**, not fetched from the server,
so a device with no connection can still hand over its data. The column list
comes from the registry's `csvColumns()`, the same list the server's import
endpoint expects, so a file exported on a phone imports cleanly on the server.

Import, by contrast, is a server operation: it validates the whole file and
applies it in one transaction. Importing on the client would mean two
implementations of the same rules.

## Where the client runs

- **Served by the server** (production): one process, one port. The server's
  static handler serves the built client and falls back to `index.html` for
  unknown routes, so client-side routing works.
- **Served by Vite** (development): `npm run dev:web` proxies `/api` to the
  server. Set `SCHOOL_API_TARGET` to point at a different server.

## Working on the interface

The interface is worked on by looking at it, and the notes about what is
wrong with it are written against the running application rather than from
memory. **Agentation** is a toolbar that does that: click an element, write
what is wrong with it, and the note carries the path to the element, its
classes, its text and — in a development build — the source file it came
from, which is enough for an agent to find the code without being told
where to look.

It is a development tool, and it is not shipped:

- It is a **dev dependency** of the client.
- It is mounted by a dynamic import that the build removes, so the bundle
  the school downloads does not carry it. A build can ask for it with
  `VITE_AGENTATION=1`.
- It is mounted in a root of its own, outside the application's tree, so
  that nothing the application renders has to know that it exists.

The notes are copied to the clipboard, which is enough to pass them on. An
agent can also be given the notes directly: the `agentation-mcp` server
collects them, and `VITE_AGENTATION_ENDPOINT` points the toolbar at it.
