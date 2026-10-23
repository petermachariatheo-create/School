# UI/UX Simplification Principles

These principles guide interface decisions across the School Management System. They exist to reduce cognitive load, eliminate redundancy, and create a consistent, calm interface that works equally well on desktop and phone.

---

## 1. Prefer Visual State Over Text Labels

**Principle**: A colored indicator communicates state faster than a word. Text is a fallback, not the primary signal.

**Apply**:

- **Synced state**: Green pulse/spinner button, no "Synced" text
- **Pending**: Amber pulse button, no "Waiting" text
- **Error/Conflict**: Red pulse button, no "Failed" text
- **Offline**: Gray pulse button, no "Offline" text

**Anti-pattern**: `status-pill` with text "Synced" + green background. The color _is_ the signal; the text is noise.

---

## 2. One Signal Per State

**Principle**: Never combine an icon + checkbox + text for the same state. Pick the strongest signal, and make sure the meaning is not carried by colour alone.

**Apply**:

- **Status**: One badge — a coloured dot and the status in words. The dot says it at a glance, the word says it to somebody who cannot see the colour.
- **Gender**: Single-letter badge (M/F/O/U) with the full word in its tooltip.
- **Sync state**: Pulse button only. No "Synced" text. The count of waiting changes, when there is one.
- **Record state**: A dot in the corner of the card, and only when there is something to say.

**Anti-pattern**: Checkbox + "Active" text + green background = 3 signals for 1 bit of information.

**Anti-pattern**: A coloured dot with no word and no accessible name = the meaning is carried by colour alone.

---

## 3. List Items as Cards, Not Rows

**Principle**: On mobile especially, a tappable card with clear hierarchy beats a dense table row. On desktop, cards flow into a grid.

**Apply**:

- **Student list**: Card with the admission number above, the name, one status badge, a divider, and the details below it.
- **Invoice list**: Card with invoice #, student name, amount paid, status badge, due date.
- **Payment list**: Card with payment #, invoice ref, amount, date, method icon.

**Structure**:

```
┌─────────────────────────────────────┐
│  ADM-2024-0001                 [✎]  │  identity, edit on the right
│  Ada Lovelace                         │  the name, at a glance
│  ● Active                             │  one status badge
│  ────────────────────────────────     │  a divider
│  Admitted 15 Jan 2024            (F)  │  details, gender on the right
└─────────────────────────────────────┘
```

**Anti-pattern**: Dense table with 6+ columns, horizontal scroll on phone, no visual grouping.

**Anti-pattern**: A card that repeats the same fact twice — a status dot beside the word "Active".

---

## 4. Progressive Disclosure

**Principle**: Show what's needed daily; hide what's occasional behind a tap/click.

**Apply**:

- **Page heading**: The heading, what the page is for, and the count together; the primary action beside it.
- **Toolbar**: Search across the width, with the view controls and the overflow menu grouped on the right.
- **Student card**: Name and status visible. Admission #, gender and admitted date on the card; everything else on the record's own page.
- **Form sections**: Collapsible. Only required fields visible by default.
- **Rail/sidebar**: Metadata (ID, revision, timestamps) in collapsible rail, not inline.

---

## 5. Edit as Icon, Not Button

**Principle**: "Edit" is a universal affordance. The pencil icon is recognized globally; "Edit" text is not.

**Apply**:

- **Table row**: Icon-only pencil button in actions column
- **Card**: Pencil icon in the top right of the card
- **Inline**: Pencil next to field label
- **Accessible**: `aria-label="Edit student"` (no visible text)

**Anti-pattern**: "Edit" button with text + icon = visual noise.

---

## 6. Color as Semantic Signal, Not Decoration

**Principle**: Every color carries meaning. Use the semantic palette consistently.

**Palette**:

- `--success` / `--success-soft`: Confirmed, active, paid, synced
- `--warning` / `--warning-soft`: Pending, draft, warning, inactive
- `--danger` / `--danger-soft`: Error, deleted, failed, withdrawn
- `--accent` / `--accent-soft`: Primary action, link, graduated, link
- `--surface-muted` / `--text-muted`: Neutral, disabled, transferred, secondary

**Apply**: Status checkbox uses `--success` for active, `--warning` for inactive, etc. Never invent new colors.

---

## 7. Typography Hierarchy

**Principle**: Size, weight, and color create hierarchy. Limit to three levels.

**Levels** (the tokens are `--text-page`, `--text-title` and `--text-body`):

1. **Page heading**: 30px, weight 600, `--text`
2. **Title** (a student name): 21px, weight 600, `--text`
3. **Body**: 15px, weight 400, `--text`
4. **Supporting**: 14px, weight 400, `--text-muted`

**Apply**: The page heading is "Students". A student's name is the title. The admission number and the admitted date are supporting information.

---

## 8. Spacing Rhythm

**Principle**: Use a consistent 4px base unit. Group related elements tightly; separate groups generously.

**Scale** (the tokens are `--space-1` to `--space-8`): 4, 8, 12, 16, 20, 24, 32, 40

**Apply**:

- Card padding: 20px
- Gap between the groups of a card: 12px
- Gap between cards: 16px
- Gap between the sections of a page: 24px
- Page margins: 32px

**Also**: the content of a page has a maximum width (1180px) and is centred, so that a wide screen does not stretch a line of text the whole way across.

---

## 9. Motion as Feedback, Not Decoration

**Principle**: Animation acknowledges action. Keep it under 200ms. No decorative animation.

**Apply**:

- Dropdown: 120ms ease-out
- Button press: 80ms scale
- Status change: 200ms color transition
- Card hover: 120ms background shift
- No loading spinners for instant actions

---

## 10. Accessibility as Default, Not Checklist

**Principle**: Semantic HTML + ARIA = accessible by default. Test with keyboard and screen reader.

**Apply**:

- Sortable headers: `aria-sort`, keyboard operable
- Icon buttons: `aria-label`, visible focus ring
- Status: `aria-live="polite"` for changes
- Color never sole carrier of meaning (icon + color)
- Focus visible: 2px solid `--accent`, offset 2px

---

## 11. Reduce, Reuse, Refactor

**Principle**: If a pattern appears twice, abstract it. If it appears three times, it's a primitive.

**Current primitives**:

- `Button` (variants: primary, secondary, ghost, quiet, danger; sizes: sm, md)
- `Icon` (one icon set, one place to add an icon)
- `StatusBadge` (a coloured dot and the status in words, in one tone)
- `Pager` (one pager for every list, table or cards)
- `StudentCard` and `StudentList` (the card pattern, and the grid that holds it)
- `RecordTable` (the dense view, with sorting and pagination)

**Anti-pattern**: A second pager in a second component. A second way of showing a status. A second card layout.

---

## 12. Mobile-First, Desktop-Enhanced

**Principle**: Design for 360px first. Enhance at 760px, 980px, 1200px.

**Breakpoints**:

- ≤ 360px: Single column, stacked cards, bottom nav
- 760px: Sidebar collapses to horizontal strip, topbar condenses
- 980px: Workspace grid (form + rail), sidebar visible
- 1200px: Max content width 1180px, comfortable reading

---

## Quick Reference: Do / Don't

| Do                                                     | Don't                                    |
| ------------------------------------------------------ | ---------------------------------------- |
| Pulse button for synced, with a tooltip                | "Synced" text + green pill               |
| One badge: a dot and the status in words               | Checkbox + "Active" text + background    |
| Single-letter gender badge with a tooltip              | "Gender: Male" text                      |
| Pencil icon for edit                                   | "Edit" button with text                  |
| Card layout with a fixed structure                     | Dense table with horizontal scroll       |
| Page heading, what it is for, and the count together   | A flat "Students" label in a toolbar     |
| Search across the width, controls grouped on the right | Search, import and export all in one row |
| A divider between identity and details                 | Every fact at the same weight            |
| One card, one status indicator                         | The same fact shown twice                |

---

## 13. Read a Record Before Changing It

**Principle**: A record can be **read** and it can be **changed**, and they
are different things. Opening a record shows the record; changing it is a
deliberate step.

**Apply**:

- **Profile**: the heading says who it is and what state it is in; the
  actions are on the right; the facts are in the groups the catalogue says;
  the records that point at it are listed at the foot.
- **Edit**: one predictable action, on the profile, opens the form.
- **New**: opens straight into the form, ready to be typed into. A person
  is never made to look at an empty profile before they can create
  anything.
- The fields the heading already shows are not repeated in the facts below
  it.

---

## 14. Ask for Names, Not Identifiers

**Principle**: A field that points at another record is asked for by name.
An identifier is a thing the computer made, and nobody can read one.

**Apply**: A field named after a type — "studentId" — points at a record of
that type. The client holds the whole school, so the field offers a
searchable list of names, and the identifier goes into the record behind
the scenes.

**Anti-pattern**: A text box that wants `01ARZ3NDEKTSV4RRFFQ69G5FAV`.

---

## 15. Never Lose What Somebody Typed

**Principle**: Work in a form is the person's work. Losing it is worse than
any error message.

**Apply**:

- Leaving a form that holds unsaved work is asked about, whichever way the
  person leaves: the buttons, or the back gesture on a phone.
- A failed validation keeps everything that was typed, and moves the focus
  to the first thing that has to be fixed.
- Several failures are summarised in one place, in words.

**Anti-pattern**: A form that empties when the save is refused.

---

## 16. Say What Is True About the Record

**Principle**: A record on the device and a record on the server are not the
same thing, and the interface must not pretend they are.

**Apply**:

- Saved on the device, waiting to be sent: say "waiting".
- On the server: say "synced".
- Refused by the server: say so, and say how many.
- Never write "saved" for a change that has not reached the school.

---

## Migration Checklist

When adding/modifying UI:

- [ ] No redundant text + icon + colour for the same state
- [ ] Status is one badge, and the meaning is not carried by colour alone
- [ ] Synced/pending/error uses an indicator, not a word
- [ ] Edit is a pencil icon with an accessible name
- [ ] A card has a fixed structure: identity, title, status, divider, details
- [ ] The page has a heading, a description and a count
- [ ] Search is across the width; the controls are grouped
- [ ] Colours from the semantic palette only
- [ ] Type: a page heading, a title, and supporting information
- [ ] Spacing from the 4px scale
- [ ] Motion < 200ms, purposeful
- [ ] Keyboard + screen reader tested
- [ ] Mobile-first breakpoints respected

---

_Document version: 1.1 | Last updated: 2026-10-21_
