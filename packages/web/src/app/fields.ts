import { registry } from "@school/shared";

/**
 * Schema-driven form definitions.
 *
 * The client does not hard-code a form per entity type. Instead it reads
 * the JSON Schema that the shared registry generates from the same Zod
 * schema the server validates with, so a field added to the domain model
 * appears in the interface automatically.
 */

export type FieldKind =
  | "text"
  | "longtext"
  | "number"
  | "checkbox"
  | "select"
  | "json"
  | "date"
  | "datetime";

export interface FieldSpec {
  readonly name: string;
  readonly label: string;
  readonly kind: FieldKind;
  /** True when the field accepts null. */
  readonly nullable: boolean;
  /** True when the field must be present. */
  readonly required: boolean;
  /** Allowed values for a select. */
  readonly options: string[];
  /** True for fields the server owns; the client cannot change them. */
  readonly readOnly: boolean;
  /**
   * True for a field the server works out from other fields.
   *
   * Such a field is shown to the user as the value it will have, and is
   * never asked for: an invoice's total is the sum of its line items, not
   * something a person types.
   */
  readonly computed: boolean;
  /**
   * The field a computed value comes from, when the registry says so.
   *
   * It lets the interface explain where the number came from instead of
   * leaving the person to wonder.
   */
  readonly computedFrom: string | null;
  /**
   * True for a field the server keeps up to date from other records.
   *
   * An invoice's amount paid is the sum of the payments received against
   * it. Only the server sees every payment, so the client shows the
   * server's figure rather than working one out for itself, and never asks
   * for it.
   */
  readonly maintained: boolean;
  /**
   * The values of this field the server works out.
   *
   * An invoice's status is partly a decision and partly a consequence: the
   * school chooses whether an invoice is a draft, has been issued or has
   * been voided, and the server works out whether the money has arrived
   * and whether the invoice is late. The interface says which is which, so
   * that a person is not left wondering why the server disagreed.
   */
  readonly serverDecided: readonly string[];
  /**
   * The value the domain gives the field when it is left alone.
   *
   * It comes from the schema, so a form can start with the school's
   * defaults rather than with an empty box the user has to think about.
   */
  readonly defaultValue: unknown;
  readonly description: string | null;
  /** Smallest accepted value for a number, when the schema says so. */
  readonly minimum: number | null;
  /** Largest accepted value for a number, when the schema says so. */
  readonly maximum: number | null;
  /** Longest accepted text, when the schema says so. */
  readonly maxLength: number | null;
  /** Schema format, e.g. `email`, `date`, `date-time`, `ulid`. */
  readonly format: string | null;
  /**
   * A hand-written schema pattern, when the schema has a short one.
   *
   * The generator emits long patterns for dates and identifiers; those are
   * covered by `format`, so only a short, business-written pattern is
   * carried over for the interface to check.
   */
  readonly pattern: string | null;
}

export interface EntityMeta {
  readonly type: string;
  readonly label: string;
  readonly restPath: string;
  readonly fields: FieldSpec[];
  /** Fields the client may edit. */
  readonly editable: FieldSpec[];
  /** Fields the server works out; shown to the user, never asked for. */
  readonly computed: FieldSpec[];
  /** Fields the server keeps up to date; shown to the user, never asked for. */
  readonly maintained: FieldSpec[];
}

/**
 * Longest schema pattern carried over to the interface.
 *
 * The generator writes a long pattern for every date and identifier; a
 * hand-written rule such as the academic year is short.
 */
const SHORT_PATTERN_LIMIT = 120;

/**
 * Words that stay small inside a label.
 *
 * "Date of Birth" reads; "Date Of Birth" does not.
 */
const MINOR_WORDS = new Set([
  "a",
  "an",
  "and",
  "at",
  "by",
  "for",
  "in",
  "of",
  "on",
  "or",
  "the",
  "to",
]);

/** Words that are written in capitals. */
const ACRONYMS = new Map<string, string>([
  ["id", "ID"],
  ["ulid", "ULID"],
]);

/**
 * Labels the schema cannot derive.
 *
 * A field name is an identifier, not a heading: `isPrimary` says what the
 * field is called in the database, and "Primary contact" says what it means
 * to the person filling the form in.
 */
const LABEL_OVERRIDES = new Map<string, string>([
  ["isPrimary", "Primary contact"],
  ["paidAmount", "Amount paid"],
  ["totalAmount", "Invoice total"],
  ["maxScore", "Maximum score"],
  ["admissionDate", "Admitted"],
  ["teacherName", "Teacher"],
]);

function humanise(name: string): string {
  const words = name
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(" ")
    .filter((word) => word !== "");

  return words
    .map((word, index) => {
      const lower = word.toLowerCase();
      const acronym = ACRONYMS.get(lower);
      if (acronym !== undefined) {
        return acronym;
      }
      if (index > 0 && MINOR_WORDS.has(lower)) {
        return lower;
      }
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");
}

/**
 * The words a value from a fixed list is shown with.
 *
 * A value in a list of choices is a word the computer uses — `partially_paid`
 * — and the person reading the screen should see a sentence: "Partially
 * paid". A value in capitals is a code, such as a currency, and is left
 * exactly as it is.
 */
export function optionLabel(value: string): string {
  if (value !== value.toLowerCase() && value === value.toUpperCase()) {
    return value;
  }
  return humanise(value);
}

/** The label a field is shown with. */
function labelFor(name: string): string {
  return LABEL_OVERRIDES.get(name) ?? humanise(name);
}

function typesOf(schema: Record<string, unknown>): string[] {
  const type = schema["type"];
  if (typeof type === "string") {
    return [type];
  }
  if (Array.isArray(type)) {
    return type.filter((entry): entry is string => typeof entry === "string");
  }
  const anyOf = schema["anyOf"];
  if (Array.isArray(anyOf)) {
    return anyOf.flatMap((entry) =>
      typeof entry === "object" && entry !== null ? typesOf(entry as Record<string, unknown>) : [],
    );
  }
  return [];
}

/**
 * The non-null branch of a schema.
 *
 * A nullable field is published as `anyOf: [ {…}, { "type": "null" } ]`, so
 * its `format`, `enum` and length limits live inside the first branch rather
 * than at the top level.
 */
function resolveBranch(schema: Record<string, unknown>): Record<string, unknown> {
  const anyOf = schema["anyOf"];
  if (!Array.isArray(anyOf)) {
    return schema;
  }
  for (const branch of anyOf) {
    if (typeof branch !== "object" || branch === null) {
      continue;
    }
    const record = branch as Record<string, unknown>;
    if (typesOf(record).includes("null")) {
      continue;
    }
    return record;
  }
  return schema;
}

function kindOf(schema: Record<string, unknown>, nullable: boolean): FieldKind {
  const resolved = resolveBranch(schema);
  const type = typesOf(resolved).find((candidate) => candidate !== "null") ?? "string";

  if (Array.isArray(resolved["enum"])) {
    return "select";
  }
  switch (type) {
    case "boolean":
      return "checkbox";
    case "number":
    case "integer":
      return "number";
    case "array":
    case "object":
      return "json";
    case "string": {
      if (resolved["format"] === "date") {
        return "date";
      }
      if (resolved["format"] === "date-time") {
        return "datetime";
      }
      const maxLength = resolved["maxLength"];
      if (typeof maxLength === "number" && maxLength > 240) {
        return "longtext";
      }
      return "text";
    }
    default:
      return nullable ? "json" : "text";
  }
}

/** Describe an entity type for the interface. */
export function describeEntity(type: string): EntityMeta {
  const definition = registry.get(type);
  const schema = registry.jsonSchema(type);
  const properties = (schema["properties"] ?? {}) as Record<string, Record<string, unknown>>;
  const required = new Set((schema["required"] ?? []) as string[]);

  // The server owns its own bookkeeping, the fields it works out for itself
  // and the totals it keeps up to date. A client may not set any of them,
  // so none of them is asked for in a form.
  const serverOwned = new Set(registry.serverOwnedFields(type));
  const derived = registry.derivedFields(type);
  const computedNames = new Set(derived.map((entry) => entry.field));
  const maintainedNames = new Set(registry.aggregateFields(type).map((entry) => entry.field));
  const refined = registry.refinedFields(type);

  const fields: FieldSpec[] = Object.entries(properties).map(([name, propertySchema]) => {
    const types = typesOf(propertySchema);
    const nullable = types.includes("null");
    const resolved = resolveBranch(propertySchema);
    const description = propertySchema["description"];
    const format = resolved["format"];
    const pattern = resolved["pattern"];
    const minimum = resolved["minimum"];
    const maximum = resolved["maximum"];
    const maxLength = resolved["maxLength"];
    const options = Array.isArray(resolved["enum"])
      ? (resolved["enum"] as unknown[]).map((value) => String(value))
      : [];
    const rule = refined.find((entry) => entry.field === name);

    return {
      name,
      label: labelFor(name),
      kind: kindOf(propertySchema, nullable),
      nullable,
      required: required.has(name),
      options,
      readOnly: serverOwned.has(name),
      computed: computedNames.has(name),
      computedFrom: derived.find((entry) => entry.field === name)?.from ?? null,
      maintained: maintainedNames.has(name),
      serverDecided:
        rule === undefined ? [] : options.filter((value) => !rule.choices.includes(value)),
      defaultValue: propertySchema["default"],
      description: typeof description === "string" ? description : null,
      minimum: typeof minimum === "number" ? minimum : null,
      maximum: typeof maximum === "number" ? maximum : null,
      maxLength: typeof maxLength === "number" ? maxLength : null,
      format: typeof format === "string" ? format : null,
      pattern:
        typeof pattern === "string" && pattern.length <= SHORT_PATTERN_LIMIT ? pattern : null,
    };
  });

  return {
    type: definition.type,
    label: definition.label,
    restPath: definition.restPath,
    fields,
    editable: fields.filter((field) => !field.readOnly),
    computed: fields.filter((field) => field.computed),
    maintained: fields.filter((field) => field.maintained),
  };
}

/**
 * The columns a list shows.
 *
 * Which fields are shown is a presentation decision, so it lives here rather
 * than in the shared contract; the values themselves are validated by the
 * server.
 *
 * The fields that identify a record come first, then the money and the
 * dates, because those are what a person scans a list of invoices for. What
 * is left fills the remaining columns, and the fields that are never worth
 * a column are left out of it.
 */

/** Prefer fields that identify a record over fields that merely describe it. */
const PREFERRED_COLUMNS = [
  "admissionNumber",
  "firstName",
  "lastName",
  "name",
  "title",
  "invoiceNumber",
  "paymentNumber",
  "studentId",
  "guardianId",
  "classId",
  "assessmentId",
  "invoiceId",
  "relationship",
  "totalAmount",
  "paidAmount",
  "amount",
  "dueDate",
  "date",
  "status",
  "gender",
  "admissionDate",
];

/** Fields that never earn a column: they are long, or they are bookkeeping. */
const NEVER_COLUMNS = new Set([
  "middleName",
  "notes",
  "note",
  "lineItems",
  "address",
  "alternatePhone",
  "externalReference",
]);

/** How many columns a list shows. */
const COLUMN_COUNT = 6;

export function tableColumns(entity: EntityMeta): string[] {
  // A field the server works out is worth a column: the total of an invoice
  // is what a person scans the list for, and so is the amount paid against
  // it.
  const names = [...entity.editable, ...entity.computed, ...entity.maintained].map(
    (field) => field.name,
  );
  const preferred = PREFERRED_COLUMNS.filter((name) => names.includes(name));
  const rest = names.filter((name) => !preferred.includes(name) && !NEVER_COLUMNS.has(name));
  return [...preferred, ...rest].slice(0, COLUMN_COUNT);
}

/**
 * The entity types a list needs the names of.
 *
 * A field named after an entity type refers to a record of that type: the
 * identifier in an invoice's student column is a student, and the client can
 * say who it is because it holds the students in its own replica.
 */
export function relatedTypes(columns: readonly string[]): string[] {
  const known = new Set(registry.types());
  const types = new Set<string>();
  for (const name of columns) {
    if (!name.endsWith("Id")) {
      continue;
    }
    const type = name.slice(0, -"Id".length);
    if (known.has(type)) {
      types.add(type);
    }
  }
  return [...types];
}

/**
 * True when a field points at a record of one of the given types.
 *
 * A field named after a type, with "Id" on the end, points at a record of
 * that type: "studentId" points at a student. The rule is the same
 * everywhere, so a field that points at a record can offer a list of them
 * without the interface knowing anything about the type.
 */
export function isRelationField(field: string, types: readonly string[]): boolean {
  if (!field.endsWith("Id")) {
    return false;
  }
  return types.includes(field.slice(0, -"Id".length));
}

/**
 * The type a field points at, or null when it points at none.
 */
export function relationTypeOf(field: string, types: readonly string[]): string | null {
  if (!field.endsWith("Id")) {
    return null;
  }
  const type = field.slice(0, -"Id".length);
  return types.includes(type) ? type : null;
}

/**
 * The types a record of this type points at.
 *
 * A student points at nothing, a class points at nothing, and a guardian
 * points at the students it belongs to. The rule is the same everywhere: a
 * field named after a type points at a record of that type.
 */
export function relationTypesOf(entity: EntityMeta): string[] {
  const known = registry.types();
  const types = new Set<string>();
  for (const field of entity.fields) {
    const type = relationTypeOf(field.name, known);
    if (type !== null) {
      types.add(type);
    }
  }
  return [...types];
}

/** Every entity type, in registry order. */
export function listEntities(): EntityMeta[] {
  return registry.types().map((type) => describeEntity(type));
}

/**
 * The values a select offers.
 *
 * A field the server decides is not offered as a choice: choosing a value
 * the server will overrule is not a way of saying it. The value the record
 * holds stays in the list, so that the person still sees what the server
 * says, and the other values the server works out are not put in front of
 * them.
 */
export function selectOptions(field: FieldSpec, value: unknown): string[] {
  if (field.serverDecided.length === 0) {
    return field.options;
  }
  const current = String(value ?? "");
  return field.options.filter(
    (option) => !field.serverDecided.includes(option) || option === current,
  );
}

/**
 * The fields a record's label is made of.
 *
 * The heading of a profile shows the label, so the fields it is made of
 * would only say the same thing again.
 */
export const LABEL_FIELDS: readonly string[] = [
  "firstName",
  "middleName",
  "lastName",
  "name",
  "title",
  "admissionNumber",
  "invoiceNumber",
  "paymentNumber",
];

/** A short label for a record, used in the table and in toasts. */
export function recordLabel(entityType: string, data: Record<string, unknown>): string {
  const parts = [data["firstName"], data["middleName"], data["lastName"]].filter(
    (part) => typeof part === "string" && part !== "",
  );
  if (parts.length > 0) {
    return parts.join(" ");
  }
  for (const key of ["name", "title", "admissionNumber", "invoiceNumber", "paymentNumber", "id"]) {
    const value = data[key];
    if (typeof value === "string" && value !== "") {
      return value;
    }
  }
  return entityType;
}
