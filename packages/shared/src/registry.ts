import * as z from "zod";
import {
  Assessment,
  AssessmentResult,
  AttendanceRecord,
  Enrollment,
  SchoolClass,
  TimetableEntry,
} from "./domain/academic.ts";
import {
  Invoice,
  computeInvoiceTotal,
  deriveInvoiceStatus,
  Payment,
  type InvoiceLine,
} from "./domain/finance.ts";
import { Guardian, Student, StudentGuardian } from "./domain/people.ts";

/**
 * Entity registry.
 *
 * A single table maps each entity type to its storage table, its validation
 * schema and its business key. Everything generic in the system â€” the sync
 * engine, CSV/JSON import and export, the OpenAPI document and the client
 * validator â€” is driven from this table, so adding a new entity type is a
 * single registration rather than a change in five places.
 */

/**
 * A field the server computes from another field.
 *
 * Some values are not facts a client states but consequences of other facts:
 * an invoice's total is the sum of its line items. A client asked to supply
 * such a value will eventually supply a wrong one, so the server computes
 * it and discards whatever the client sent. The rule lives in the shared
 * package so that the server and the client agree on it.
 */
export interface DerivedField {
  /** The field the server computes. */
  readonly field: string;
  /** The field the computation reads. */
  readonly from: string;
  /**
   * The rule.
   *
   * It returns `undefined` when the source cannot be used, in which case
   * the field is left as the client sent it and the schema reports the
   * real problem rather than a confusing one.
   */
  readonly compute: (source: unknown) => unknown;
}

export interface EntityDefinition {
  /** Stable type name used in API paths, sync payloads and import files. */
  readonly type: string;
  /** Physical table name in the server database. */
  readonly table: string;
  /** URL path segment used by the REST API, e.g. students. */
  readonly restPath: string;
  /** Validation schema; the single source of truth for the entity's shape. */
  readonly schema: z.ZodObject<z.ZodRawShape>;
  /** Human-readable label used in error messages and documentation. */
  readonly label: string;
  /**
   * Business key used to detect duplicates when importing. A row whose
   * business key already exists is reported as a duplicate rather than
   * silently creating a second record.
   */
  readonly naturalKey: readonly string[];
  /**
   * Cross-field invariant that a single-field schema cannot express.
   * Returns a human-readable message when violated, or null when valid.
   */
  readonly invariant?: (record: Record<string, unknown>) => string | null;
  /**
   * Fields the server computes from other fields.
   *
   * A derived field is not part of what a client states: the server works
   * it out, and a value a client sends is discarded.
   */
  readonly derived?: readonly DerivedField[];
  /**
   * Fields the server keeps up to date from other records.
   *
   * An aggregate is a total of another entity type's records: an invoice's
   * amount paid is the sum of the payments received against it. Only the
   * server sees every payment, so only the server can keep the total right.
   */
  readonly aggregates?: readonly AggregateField[];
  /**
   * Fields the server works out, but where a person still has a say.
   *
   * An invoice's status is partly a decision — a draft stays a draft, a void
   * invoice stays void — and partly a consequence of the money received and
   * of the date. The server keeps the consequence and leaves the decision
   * alone.
   */
  readonly refined?: readonly RefinedField[];
}

/**
 * A field the server decides, but which a person may still choose.
 */
export interface RefinedField {
  /** The field the rule decides. */
  readonly field: string;
  /**
   * The values a person may choose.
   *
   * These are the states the school decides: an invoice is a draft until
   * somebody issues it, and a void invoice stays void. The other values of
   * the field are the server's to work out, and a value a client states for
   * one of them is discarded in favour of what the rule says.
   */
  readonly choices: readonly string[];
  /**
   * The rule that decides the value.
   *
   * It returns `undefined` when it cannot decide, in which case the field
   * is left as it was and the schema reports the real problem.
   */
  readonly decide: (record: Record<string, unknown>, context: RefineContext) => unknown;
}

/**
 * What a rule is allowed to know about the moment it runs.
 *
 * The shared package never reads a clock: the caller says what day it is,
 * so that the same rule can be applied for any date.
 */
export interface RefineContext {
  /** The calendar date the rule is applied for, as YYYY-MM-DD. */
  readonly today: string;
}

/**
 * A field that holds the total of another entity type's records.
 *
 * The declaration says which records are totalled and how they point at the
 * record that holds the total, so that the server can maintain it without
 * knowing anything about invoices or payments.
 */
export interface AggregateField {
  /** The field on this entity that holds the total. */
  readonly field: string;
  /** The entity type whose records are totalled. */
  readonly source: string;
  /** The field of a source record that holds this record's id. */
  readonly via: string;
  /** The field of a source record that is totalled. */
  readonly sumOf: string;
  /**
   * Source fields that must equal the same field on this record.
   *
   * Money is only added up in the same currency, so a payment in another
   * currency is not part of an invoice's total.
   */
  readonly match?: Readonly<Record<string, string>>;
}

/**
 * Fields owned by the server. Clients may not set them through a sync push;
 * a client that sends them has them discarded.
 */
export const SERVER_MANAGED_FIELDS = [
  "id",
  "revision",
  "createdAt",
  "updatedAt",
  "deletedAt",
] as const;

/** Fields omitted from CSV exports because they are internal bookkeeping. */
const CSV_EXCLUDED_FIELDS = new Set<string>(["revision", "deletedAt"]);

const invoiceInvariant = (record: Record<string, unknown>): string | null => {
  const lineItems = record["lineItems"];
  if (!Array.isArray(lineItems)) {
    return null;
  }
  const total = record["totalAmount"];
  if (typeof total !== "number") {
    return null;
  }
  const computed = computeInvoiceTotal(lineItems as never);
  if (computed !== total) {
    return `totalAmount (${total}) does not equal the sum of the line items (${computed})`;
  }
  return null;
};

/**
 * The invoice's total, worked out from its line items.
 *
 * The computation gives up when the line items cannot be used, so that a
 * malformed invoice is reported as a malformed invoice rather than as a
 * total that happens to be wrong.
 */
const invoiceTotal = (lineItems: unknown): number | undefined => {
  if (!Array.isArray(lineItems)) {
    return undefined;
  }
  for (const line of lineItems) {
    if (typeof line !== "object" || line === null) {
      return undefined;
    }
    const { quantity, unitAmount } = line as { quantity?: unknown; unitAmount?: unknown };
    if (typeof quantity !== "number" || typeof unitAmount !== "number") {
      return undefined;
    }
  }
  return computeInvoiceTotal(lineItems as InvoiceLine[]);
};

/**
 * The invoice's status, worked out from the money received and the date.
 *
 * A draft and a void invoice are a decision and the decision stands. Every
 * other status follows from what has been paid and from the date, so the
 * server works it out: a client that states "paid" on an invoice that has
 * not been paid for does not get to say so.
 */
const invoiceStatus = (record: Record<string, unknown>, context: RefineContext): unknown => {
  const totalAmount = record["totalAmount"];
  const dueDate = record["dueDate"];
  if (typeof totalAmount !== "number" || typeof dueDate !== "string") {
    // The record does not carry what the rule needs, so the rule gives up
    // and the schema reports the real problem.
    return undefined;
  }
  // An invoice that has not been paid for has nothing paid against it, and
  // the amount paid is the server's to keep, so a record that does not
  // carry one is a record with nothing paid against it.
  const paidAmount = typeof record["paidAmount"] === "number" ? record["paidAmount"] : 0;
  const status = typeof record["status"] === "string" ? record["status"] : "issued";
  return deriveInvoiceStatus({ status, totalAmount, paidAmount, dueDate }, context.today);
};

const DEFINITIONS: readonly EntityDefinition[] = [
  {
    type: "student",
    table: "students",
    restPath: "students",
    schema: Student,
    label: "Student",
    naturalKey: ["admissionNumber"],
  },
  {
    type: "guardian",
    table: "guardians",
    restPath: "guardians",
    schema: Guardian,
    label: "Guardian",
    naturalKey: ["firstName", "lastName", "email"],
  },
  {
    type: "student_guardian",
    table: "student_guardians",
    restPath: "student-guardians",
    schema: StudentGuardian,
    label: "Student-guardian link",
    naturalKey: ["studentId", "guardianId"],
  },
  {
    type: "class",
    table: "classes",
    restPath: "classes",
    schema: SchoolClass,
    label: "Class",
    naturalKey: ["name", "academicYear"],
  },
  {
    type: "enrollment",
    table: "enrollments",
    restPath: "enrollments",
    schema: Enrollment,
    label: "Enrollment",
    naturalKey: ["studentId", "classId"],
  },
  {
    type: "timetable",
    table: "timetables",
    restPath: "timetables",
    schema: TimetableEntry,
    label: "Timetable",
    naturalKey: ["classId", "day", "startTime"],
  },
  {
    type: "attendance",
    table: "attendance",
    restPath: "attendance",
    schema: AttendanceRecord,
    label: "Attendance record",
    naturalKey: ["studentId", "classId", "date"],
  },
  {
    type: "assessment",
    table: "assessments",
    restPath: "assessments",
    schema: Assessment,
    label: "Assessment",
    naturalKey: ["classId", "title", "date"],
  },
  {
    type: "assessment_result",
    table: "assessment_results",
    restPath: "assessment-results",
    schema: AssessmentResult,
    label: "Assessment result",
    naturalKey: ["assessmentId", "studentId"],
  },
  {
    type: "invoice",
    table: "invoices",
    restPath: "invoices",
    schema: Invoice,
    label: "Invoice",
    naturalKey: ["invoiceNumber"],
    invariant: invoiceInvariant,
    derived: [
      {
        field: "totalAmount",
        from: "lineItems",
        compute: invoiceTotal,
      },
    ],
    aggregates: [
      {
        field: "paidAmount",
        source: "payment",
        via: "invoiceId",
        sumOf: "amount",
        // Money is only added up in one currency.
        match: { currency: "currency" },
      },
    ],
    refined: [
      {
        field: "status",
        // The school decides whether an invoice is a draft, has been issued
        // or has been voided. The rest is worked out from the money and
        // the date.
        choices: ["draft", "issued", "void"],
        decide: invoiceStatus,
      },
    ],
  },
  {
    type: "payment",
    table: "payments",
    restPath: "payments",
    schema: Payment,
    label: "Payment",
    naturalKey: ["paymentNumber"],
  },
];

export class EntityRegistry {
  readonly #byType = new Map<string, EntityDefinition>();
  readonly #jsonSchemaCache = new Map<string, Record<string, unknown>>();
  readonly #createSchemaCache = new Map<string, z.ZodObject<z.ZodRawShape>>();
  readonly #patchSchemaCache = new Map<string, z.ZodObject<z.ZodRawShape>>();

  constructor(definitions: readonly EntityDefinition[] = DEFINITIONS) {
    for (const definition of definitions) {
      this.register(definition);
    }
  }

  register(definition: EntityDefinition): void {
    if (this.#byType.has(definition.type)) {
      throw new Error(`Entity type "${definition.type}" is already registered`);
    }
    this.#byType.set(definition.type, definition);
  }

  has(type: string): boolean {
    return this.#byType.has(type);
  }

  get(type: string): EntityDefinition {
    const definition = this.#byType.get(type);
    if (definition === undefined) {
      throw new Error(`Unknown entity type "${type}"`);
    }
    return definition;
  }

  all(): EntityDefinition[] {
    return [...this.#byType.values()];
  }

  types(): string[] {
    return [...this.#byType.keys()];
  }

  /** JSON Schema for an entity type, generated once and cached. */
  jsonSchema(type: string): Record<string, unknown> {
    const cached = this.#jsonSchemaCache.get(type);
    if (cached !== undefined) {
      return cached;
    }
    const schema = z.toJSONSchema(this.get(type).schema, {
      target: "draft-2020-12",
      io: "input",
    }) as Record<string, unknown>;
    this.#jsonSchemaCache.set(type, schema);
    return schema;
  }

  /**
   * CSV column order for an entity type.
   *
   * Derived from the schema so that the column list can never drift from
   * the validation schema.
   */
  csvColumns(type: string): string[] {
    const schema = this.jsonSchema(type);
    const properties = (schema["properties"] ?? {}) as Record<string, unknown>;
    return Object.keys(properties).filter((name) => !CSV_EXCLUDED_FIELDS.has(name));
  }

  /** The fields the server computes for an entity type. */
  derivedFields(type: string): readonly DerivedField[] {
    return this.get(type).derived ?? [];
  }

  /** The fields the server keeps up to date for an entity type. */
  aggregateFields(type: string): readonly AggregateField[] {
    return this.get(type).aggregates ?? [];
  }

  /** The fields the server decides, but which a person may still choose. */
  refinedFields(type: string): readonly RefinedField[] {
    return this.get(type).refined ?? [];
  }

  /**
   * The fields a client is not allowed to state.
   *
   * The server's own bookkeeping, the fields the server computes, and the
   * totals the server maintains: a client that sets them has them discarded
   * rather than refused, so an older client still works against a newer
   * server.
   */
  serverOwnedFields(type: string): readonly string[] {
    const owned = new Set<string>(SERVER_MANAGED_FIELDS);
    for (const entry of this.derivedFields(type)) {
      owned.add(entry.field);
    }
    for (const entry of this.aggregateFields(type)) {
      owned.add(entry.field);
    }
    return [...owned];
  }

  /**
   * Work out the fields the server owns.
   *
   * The record that was passed in is not changed; the result is a new one.
   * A field whose source cannot be used is left as it was, so that the
   * schema reports the real problem.
   */
  applyDerived(type: string, record: Record<string, unknown>): Record<string, unknown> {
    const derived = this.derivedFields(type);
    if (derived.length === 0) {
      return record;
    }
    const result = { ...record };
    for (const entry of derived) {
      const computed = entry.compute(result[entry.from]);
      if (computed !== undefined) {
        result[entry.field] = computed;
      }
    }
    return result;
  }

  /**
   * The cross-field problems of a record, without changing it.
   *
   * The import uses this: a file that disagrees with the school's own
   * rules is a mistake in the file, and the person who made it is told
   * about it rather than having it quietly corrected.
   */
  checkInvariants(type: string, record: Record<string, unknown>): string[] {
    const definition = this.get(type);
    if (definition.invariant === undefined) {
      return [];
    }
    const violation = definition.invariant(record);
    return violation === null ? [] : [violation];
  }

  /**
   * Apply the rules the server decides, but which a person may still choose.
   *
   * The rule reads the record as it is and returns the value the field
   * should hold. A rule that cannot decide returns undefined, and the field
   * is left as it was.
   */
  applyRefined(
    type: string,
    record: Record<string, unknown>,
    context: RefineContext,
  ): Record<string, unknown> {
    const refined = this.refinedFields(type);
    if (refined.length === 0) {
      return record;
    }
    const result = { ...record };
    for (const entry of refined) {
      const decided = entry.decide(result, context);
      if (decided !== undefined) {
        result[entry.field] = decided;
      }
    }
    return result;
  }

  /**
   * Schema for a record supplied by a client that creates it.
   *
   * The identifier may be supplied so that a client working offline can
   * mint it, but the server owns the revision, the timestamps and the
   * fields it computes.
   */
  createSchema(type: string): z.ZodObject<z.ZodRawShape> {
    const cached = this.#createSchemaCache.get(type);
    if (cached !== undefined) {
      return cached;
    }
    const definition = this.get(type);
    const omitted: Record<string, true> = {
      revision: true,
      createdAt: true,
      updatedAt: true,
      deletedAt: true,
    };
    for (const entry of this.derivedFields(type)) {
      omitted[entry.field] = true;
    }
    for (const entry of this.aggregateFields(type)) {
      omitted[entry.field] = true;
    }
    const schema = definition.schema.omit(omitted) as z.ZodObject<z.ZodRawShape>;
    const withOptionalId = schema.extend({ id: z.ulid().optional() });
    this.#createSchemaCache.set(type, withOptionalId);
    return withOptionalId;
  }

  /**
   * Schema for a partial update.
   *
   * Every field is optional, and the server-owned fields are excluded
   * entirely because a client has no business setting them.
   */
  patchSchema(type: string): z.ZodObject<z.ZodRawShape> {
    const cached = this.#patchSchemaCache.get(type);
    if (cached !== undefined) {
      return cached;
    }
    const definition = this.get(type);
    const omitted: Record<string, true> = {
      id: true,
      revision: true,
      createdAt: true,
      updatedAt: true,
      deletedAt: true,
    };
    for (const entry of this.derivedFields(type)) {
      omitted[entry.field] = true;
    }
    for (const entry of this.aggregateFields(type)) {
      omitted[entry.field] = true;
    }
    const schema = definition.schema.omit(omitted) as z.ZodObject<z.ZodRawShape>;
    const partial = schema.partial();
    this.#patchSchemaCache.set(type, partial);
    return partial;
  }

  /**
   * Validate a record against its schema and cross-field invariants.
   * Returns the parsed record, or a list of human-readable problems.
   *
   * The context says what day it is, because a rule may depend on the date
   * and the shared package never reads a clock.
   */
  validate(
    type: string,
    data: unknown,
    context: RefineContext,
  ): { ok: true; value: Record<string, unknown> } | { ok: false; problems: string[] } {
    return this.#validateWith(this.get(type).schema, type, data, context);
  }

  /**
   * Validate a record that a client is creating.
   *
   * The identifier is optional and the server-owned fields are not
   * required, which is what a record arriving from an import looks like.
   */
  validateCreate(
    type: string,
    data: unknown,
    context: RefineContext,
  ): { ok: true; value: Record<string, unknown> } | { ok: false; problems: string[] } {
    return this.#validateWith(this.createSchema(type), type, data, context);
  }

  #validateWith(
    schema: z.ZodType,
    type: string,
    data: unknown,
    context: RefineContext,
  ): { ok: true; value: Record<string, unknown> } | { ok: false; problems: string[] } {
    const definition = this.get(type);

    // The fields the server computes are worked out before the record is
    // validated, so a client is never asked to state a value the school
    // already knows how to work out.
    const prepared = isRecord(data) ? this.applyDerived(type, data) : data;

    const result = schema.safeParse(prepared);
    if (!result.success) {
      return {
        ok: false,
        problems: result.error.issues.map((issue) => {
          const path = issue.path.join(".");
          return path === "" ? issue.message : `${path}: ${issue.message}`;
        }),
      };
    }

    // The rules the server decides run on the parsed record, so that they
    // see the values the schema gives a field that was left alone.
    const value = result.data as Record<string, unknown>;
    const decided = this.applyRefined(type, this.applyDerived(type, value), context);
    let final = value;
    if (!sameRecord(decided, value)) {
      const revalidated = schema.safeParse(decided);
      if (!revalidated.success) {
        return {
          ok: false,
          problems: revalidated.error.issues.map((issue) => {
            const path = issue.path.join(".");
            return path === "" ? issue.message : `${path}: ${issue.message}`;
          }),
        };
      }
      final = revalidated.data as Record<string, unknown>;
    }

    if (definition.invariant !== undefined) {
      const violation = definition.invariant(final);
      if (violation !== null) {
        return { ok: false, problems: [violation] };
      }
    }
    return { ok: true, value: final };
  }
}

/** True for a plain object, which is what a record is. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** True when two records hold the same fields and values. */
function sameRecord(left: Record<string, unknown>, right: Record<string, unknown>): boolean {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) {
    return false;
  }
  return leftKeys.every(
    (key) =>
      Object.is(left[key], right[key]) || JSON.stringify(left[key]) === JSON.stringify(right[key]),
  );
}

/** The registry used by the running system. */
export const registry = new EntityRegistry();
