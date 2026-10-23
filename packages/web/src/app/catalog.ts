import type { EntityMeta, FieldSpec } from "./fields.ts";

/**
 * The catalogue of the domain as it is presented.
 *
 * The registry knows what a record *is*; this module knows how the school
 * thinks about it: which records belong together, what a record is called
 * in the navigation, and which questions a record asks. It is data rather
 * than code, so a new entity type is registered in one place and every
 * screen picks it up.
 */

/** The icon that stands for an entity type in the navigation. */
export type IconName =
  | "student"
  | "guardian"
  | "link"
  | "class"
  | "enrollment"
  | "attendance"
  | "assessment"
  | "result"
  | "invoice"
  | "payment"
  | "timetable"
  | "record";

export interface CatalogGroup {
  readonly id: string;
  readonly label: string;
  /** The entity types the group holds, in navigation order. */
  readonly types: readonly string[];
}

export const CATALOG_GROUPS: readonly CatalogGroup[] = [
  { id: "people", label: "People", types: ["student", "guardian", "student_guardian"] },
  {
    id: "academic",
    label: "Academic",
    types: ["class", "timetable", "enrollment", "attendance", "assessment", "assessment_result"],
  },
  { id: "finance", label: "Finance", types: ["invoice", "payment"] },
];

/** The group that holds entity types the catalogue does not know about. */
const OTHER_GROUP: CatalogGroup = { id: "other", label: "Other records", types: [] };

const ICONS: Record<string, IconName> = {
  student: "student",
  guardian: "guardian",
  student_guardian: "link",
  class: "class",
  enrollment: "enrollment",
  attendance: "attendance",
  assessment: "assessment",
  assessment_result: "result",
  invoice: "invoice",
  payment: "payment",
  timetable: "timetable",
};

/** The group an entity type belongs to. */
export function groupFor(type: string): CatalogGroup {
  return CATALOG_GROUPS.find((group) => group.types.includes(type)) ?? OTHER_GROUP;
}

/**
 * What a page of a record type is for.
 *
 * The registry says what a record *is*; this says what the page of them is
 * for, in the words the school would use. A page with no description says
 * nothing rather than something generic.
 */
const DESCRIPTIONS: Record<string, string> = {
  student: "Everyone on the school roll, as this device holds them.",
  guardian: "The people who look after students, and how to reach them.",
  student_guardian: "Which students belong to which guardian.",
  class: "The classes that run here, and who teaches them.",
  enrollment: "Which students are in which class, and when.",
  attendance: "Who was present, late or absent, and when.",
  assessment: "The work set for students to do.",
  assessment_result: "The marks students were given, and the grade they earned.",
  timetable: "What is taught, when, and by whom.",
  invoice: "What the school has billed, and what has been paid against it.",
  payment: "Money received, and the invoices it settles.",
};

/** The description of a page of a record type. */
export function descriptionFor(type: string): string {
  return DESCRIPTIONS[type] ?? "";
}

/**
 * The record types that are about a record of another type.
 *
 * A student's guardians are held on the link between them, so the link is
 * what a profile of a student looks at. The rule is the same everywhere: a
 * record of a type here points at the record through a field named after
 * it, so "student_guardian" points at a student through "studentId".
 */
const RELATED: Record<string, readonly string[]> = {
  student: ["student_guardian", "enrollment", "invoice"],
  guardian: ["student_guardian"],
  class: ["enrollment", "attendance"],
  invoice: ["payment"],
  assessment: ["assessment_result"],
  student_guardian: [],
  enrollment: [],
  attendance: [],
  assessment_result: [],
  payment: [],
};

/** The record types that are about a record of the given type. */
export function relatedTypesFor(type: string): readonly string[] {
  return RELATED[type] ?? [];
}

/**
 * The record types that open as a profile rather than as a form.
 *
 * A profile is a record read as a record: the person sees what the record
 * says before they can change it. The student is the first type to have
 * one; the rest follow as the pattern is proved.
 */
export const PROFILE_TYPES: readonly string[] = ["student", "guardian", "class"];

/**
 * How a card shows a record of a type.
 *
 * A card has the same shape for every record: the context at the top, the
 * name, the status, and a couple of facts at the foot. Which facts those
 * are depends on the record, so the catalogue says.
 */
export interface CardFact {
  /** The field to show. */
  readonly field: string;
  /** True when the value is a single letter, and reads better as a badge. */
  readonly badge?: boolean;
}

export interface CardSpec {
  /**
   * The fields shown at the top, for context: the year a class belongs to,
   * the admission number of a student.
   */
  readonly context?: readonly string[];
  /** The facts shown at the foot of the card. */
  readonly facts: readonly CardFact[];
}

const CARDS: Record<string, CardSpec> = {
  student: {
    context: ["admissionNumber"],
    facts: [{ field: "admissionDate" }, { field: "gender", badge: true }],
  },
  guardian: {
    facts: [{ field: "phone" }, { field: "email" }],
  },
  class: {
    context: ["gradeLevel", "academicYear"],
    facts: [{ field: "teacherName" }, { field: "room" }],
  },
};

/**
 * How the records of a type are shown as cards, or null when they are
 * shown as a table.
 */
export function cardSpecFor(type: string): CardSpec | null {
  return CARDS[type] ?? null;
}

/**
 * How a list of records is presented, when it is not a plain table.
 *
 * A timetable is a week, not a list of rows, so it is shown as a week.
 */
export function listViewFor(type: string): "week" | null {
  return type === "timetable" ? "week" : null;
}

/**
 * The record types whose profile shows the week.
 *
 * A class's week is its own; a student's is the week of the classes they
 * are enrolled in.
 */
export const TIMETABLE_TYPES: readonly string[] = ["class", "student"];

/**
 * The record types whose profile shows the week, or null.
 */
export function timetableFor(entityType: string): boolean {
  return TIMETABLE_TYPES.includes(entityType);
}

/**
 * The heading of a page of a record type.
 *
 * A page is a list of things, so the heading is the plural: "Students".
 */
export function headingFor(label: string): string {
  if (/(s|x|ch|sh)$/i.test(label)) {
    return `${label}es`;
  }
  if (/[^aeiou]y$/i.test(label)) {
    return `${label.slice(0, -1)}ies`;
  }
  return `${label}s`;
}

/** The icon an entity type is shown with. */
export function iconFor(type: string): IconName {
  return ICONS[type] ?? "record";
}

/**
 * The navigation, grouped.
 *
 * The groups come first and the types keep the order the registry gives
 * them, so the navigation is stable as records are added.
 */
export function entityGroups(entities: readonly EntityMeta[]): {
  readonly group: CatalogGroup;
  readonly types: readonly string[];
}[] {
  const known = new Set(entities.map((entity) => entity.type));
  const groups = CATALOG_GROUPS.map((group) => ({
    group,
    types: group.types.filter((type) => known.has(type)),
  })).filter((entry) => entry.types.length > 0);

  const grouped = new Set(groups.flatMap((entry) => entry.types));
  const rest = entities.map((entity) => entity.type).filter((type) => !grouped.has(type));

  return rest.length === 0 ? groups : [...groups, { group: OTHER_GROUP, types: rest }];
}

interface SectionSpec {
  readonly label: string;
  readonly hint: string | null;
}

const SECTIONS: Record<string, SectionSpec> = {
  identity: { label: "Identity", hint: "How this record is named and identified." },
  contact: { label: "Contact details", hint: "How the people on this record are reached." },
  links: { label: "Related records", hint: "The records this one depends on." },
  status: { label: "Status", hint: "Where this record stands today." },
  enrolment: { label: "Enrolment", hint: "How this record fits into the school." },
  schedule: { label: "Schedule", hint: "When this record applies." },
  assessment: { label: "Assessment", hint: "The marks and the grading." },
  billing: { label: "Billing", hint: "What is owed and what has been paid." },
  notes: { label: "Notes", hint: "Anything else worth recording." },
  general: { label: "Details", hint: null },
};

/**
 * Which part of the form a field belongs to.
 *
 * A form that asks everything at once is a wall. Grouping the questions
 * by subject lets the user answer them in order.
 */
const FIELD_SECTIONS: Record<string, string> = {
  admissionNumber: "identity",
  firstName: "identity",
  middleName: "identity",
  lastName: "identity",
  name: "identity",
  title: "identity",
  gradeLevel: "identity",
  academicYear: "identity",
  teacherName: "identity",
  relationship: "identity",
  occupation: "identity",
  nationalId: "identity",
  dateOfBirth: "identity",
  gender: "identity",
  admissionDate: "identity",
  capacity: "identity",

  email: "contact",
  phone: "contact",
  alternatePhone: "contact",
  address: "contact",

  studentId: "links",
  guardianId: "links",
  classId: "links",
  assessmentId: "links",
  invoiceId: "links",

  status: "status",
  isPrimary: "status",

  enrolledAt: "enrolment",
  endedAt: "enrolment",

  date: "schedule",
  room: "schedule",
  recordedBy: "schedule",

  maxScore: "assessment",
  weight: "assessment",
  score: "assessment",
  grade: "assessment",
  gradedAt: "assessment",

  invoiceNumber: "billing",
  paymentNumber: "billing",
  term: "billing",
  issueDate: "billing",
  dueDate: "billing",
  currency: "billing",
  amount: "billing",
  method: "billing",
  receivedAt: "billing",
  lineItems: "billing",
  totalAmount: "billing",
  paidAmount: "billing",
  externalReference: "billing",

  notes: "notes",
  note: "notes",
};

export interface FieldSection {
  readonly id: string;
  readonly label: string;
  readonly hint: string | null;
  readonly fields: readonly FieldSpec[];
}

/**
 * The sections of a form.
 *
 * Fields the catalogue does not place are kept in a final "Details"
 * section rather than being hidden, so nothing in the domain model ever
 * becomes unreachable from the interface.
 *
 * A field the server works out is placed in its section as well, so that a
 * person can see the total of an invoice while they are entering the line
 * items that make it up.
 */
export function sectionsFor(entity: EntityMeta): FieldSection[] {
  const order: string[] = [];
  const buckets = new Map<string, FieldSpec[]>();

  for (const field of entity.fields) {
    // The server's own bookkeeping is shown in the rail, not in the form.
    if (field.readOnly && !field.computed && !field.maintained) {
      continue;
    }
    const id = FIELD_SECTIONS[field.name] ?? "general";
    if (!buckets.has(id)) {
      buckets.set(id, []);
      order.push(id);
    }
    buckets.get(id)?.push(field);
  }

  return order.map((id) => ({
    id,
    label: SECTIONS[id]?.label ?? "Details",
    hint: SECTIONS[id]?.hint ?? null,
    fields: buckets.get(id) ?? [],
  }));
}
