# The forms: an audit

An audit of every place the application asks a person to type something, and
of what has to be kept working when those places are rebuilt.

The finding in one line: **there is one form, it is used for every record
type, it is always an editor, and the fields that point at other records ask
for an identifier.**

---

## 1. The surfaces

| Surface             | Where                                                      | What it is                                                            |
| ------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------- |
| The list            | `components/RecordTable.tsx`, `components/StudentList.tsx` | Records of one type, paged.                                           |
| The editor          | `components/RecordWorkspace.tsx`                           | The only way to see a record in full, and the only way to change one. |
| The new-record form | the same component, with `record === null`                 | The editor, opened empty.                                             |
| The import panel    | `components/ImportDialog.tsx`                              | A file of records, previewed and applied.                             |
| The connect panel   | `components/ConnectPanel.tsx`                              | The address another device can use.                                   |
| The welcome screen  | `components/Welcome.tsx`                                   | The school name and the first sync.                                   |

There is **no read-only view of a record**. Opening a student opens a form
full of editable boxes. To look up a phone number you open the record, find
the box, and read it — with the risk of changing it by accident.

## 2. The machinery that is worth keeping

| Piece                 | Where                              | Why it stays                                                                                                                                             |
| --------------------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The form rules        | `app/form.ts`                      | Pure, tested, and driven by the schema. Every rule the client shows comes from here and from the same Zod schema the server uses.                        |
| The sections          | `app/catalog.ts` (`sectionsFor`)   | The grouping of fields into sections, by name, is already there.                                                                                         |
| The field description | `app/fields.ts` (`describeEntity`) | One description of a field for the whole interface: label, kind, options, limits, whether the server owns it.                                            |
| The save path         | `app/store.tsx`                    | The replica, the durable outbox and the sync engine. A save is written locally first and sent when the network allows, and the server has the last word. |
| The navigation        | `app/place.ts`                     | The place the user is in, in the browser's history.                                                                                                      |

## 3. What is wrong with it

### 3.1 There is no profile

A record can only be seen by editing it. A school secretary checking a
parent's telephone number opens a form, and the form is one keystroke away
from changing the number.

### 3.2 The field markup is inside the editor

`RecordWorkspace.tsx` holds the field rendering, the section rendering, the
action bar, the metadata rail and the state pills in one file, in one
component. Nothing about a field can be reused, and none of it can be tested
without a browser.

### 3.3 A field that points at another record asks for an identifier

`studentId`, `guardianId`, `classId`, `invoiceId` and `assessmentId` are
text boxes that want `01ARZ3NDEKTSV4RRFFQ69G5FAV`. The client holds every
record in the school, so it can offer a list of names instead. This is the
worst thing in the application to put in front of somebody.

### 3.4 The order of the fields is the schema's order

A student is asked for an admission number, a first name, a middle name and
a last name, in that order, in three boxes. The name is one thing to a
person and three boxes to the form. The first field of a new student should
be the name.

### 3.5 The unsaved changes can be lost by the back button

The editor asks before it throws work away — with a browser dialog. But the
browser's own back button, which is how a phone is navigated, goes past the
editor and past the question. A person with half a record typed can lose it
by swiping.

### 3.6 The confirmation dialogs are browser dialogs

`window.confirm` for deleting a record and for throwing work away. They are
unstyled, they say little, and they cannot say what will happen to the
record afterwards.

### 3.7 The metadata rail is developer information

The identifier, the revision and the two timestamps are shown in the same
weight as the record's own details. They are worth having, but they are not
what a person came for.

### 3.8 The state of a record is four different pills

`pill--new`, `pill--synced`, `pill--pending` and `pill--deleted` are used in
the editor's header, while the list uses a dot. There are two ways of saying
the same thing.

### 3.9 The form is one grid for everything

Every section is a `repeat(auto-fit, minmax(220px, 1fr))` grid, so a section
of one long note is as wide as a section of short answers, and a section of
unrelated fields is in two columns whenever there is room.

### 3.10 The required marker is a bare asterisk

A red `*` with a title attribute. Nothing says what the asterisk means until
the mouse is over it.

### 3.11 The action bar can cover the last field

The bar is fixed to the bottom of the window. On a phone, the keyboard covers
the bottom of the page, and the bar covers the field underneath it.

## 4. What has to keep working

- Every form is built from the JSON Schema of the shared registry. There is no
  form per entity type, and there must not be one.
- The client's rules are for speed and for kindness; **the server validates
  again, and the server is right**.
- A save is written to the local replica first and sent when the network
  allows. The outbox is durable.
- A record that is waiting to be sent must never be described as saved on
  the server.
- A failed validation keeps what was typed.
- The sections, the field rules and the record description are shared, and
  the editor and the profile read the same ones.

## 5. What to build

### Shared, and used by every record type

| Primitive                  | Purpose                                                              |
| -------------------------- | -------------------------------------------------------------------- |
| `FormField`                | A label, a control, a hint, an error, and a way to clear it.         |
| `FormSection`              | A group of fields with a heading and a hint.                         |
| `FormActions`              | The action bar, with the state of the form in it.                    |
| `FieldError`               | The message under a field, in words.                                 |
| `ProfileHeader`            | Who this record is, what state it is in, and what can be done to it. |
| `ProfileSection`           | A group of values, read rather than typed.                           |
| `DraftStatus`              | One way of saying saved, waiting, failed or not yet saved.           |
| `ConfirmDestructiveAction` | A confirmation that says what will happen.                           |
| `RelatedRecordPicker`      | A searchable list of the records a field points at.                  |
| `UnsavedChangesIndicator`  | The warning that there is work in the form.                          |

### The student, as the reference

- A profile that opens when a student is chosen: the name, the admission
  number, the status, the details in sections, and the records that point at
  the student.
- An editor built from the shared primitives, with the name first, the
  sections in the order the school thinks in, and a picker for the records it
  points at.
- A new student opens in the editor, ready to type into.

### The rollout

A record opens as a profile only for the entity types the catalogue says so.
The student is the first; the rest follow after the reference has been looked
at.
