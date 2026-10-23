import { registry } from "@school/shared";
import type { EntityMeta, FieldSpec } from "./fields.ts";
import { normalizeDateTime } from "./values.ts";

/**
 * Form state and validation.
 *
 * The rules live here rather than in the component so that they can be
 * tested without a browser, and so that the same rules apply to every
 * entity type: a field is described by the schema, and the schema says
 * what is allowed.
 */

export interface FormState {
  /** The current value of every editable field. */
  readonly values: Record<string, unknown>;
  /** The raw text of a JSON field, so a half-typed document survives. */
  readonly json: Record<string, string>;
  /** True for the fields the user has already touched. */
  readonly touched: Record<string, boolean>;
}

export interface FormProblem {
  /** The field the problem belongs to. */
  readonly field: string;
  /** A sentence a person can act on. */
  readonly message: string;
}

export interface FormResult {
  /** The values to send to the server. */
  readonly patch: Record<string, unknown>;
  readonly problems: readonly FormProblem[];
  /** True when there is nothing to complain about. */
  readonly ok: boolean;
}

/** What a single field resolves to once the form is read. */
interface Resolved {
  /** The value the field would be saved with. */
  readonly value: unknown;
  /** True when the value should be sent to the server. */
  readonly present: boolean;
  /** A problem with the value, or null when it is acceptable. */
  readonly problem: string | null;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const IDENTIFIER = /^[0-7][0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{25}$/;

function isCalendarDate(text: string): boolean {
  if (!ISO_DATE.test(text)) {
    return false;
  }
  const date = new Date(`${text}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === text;
}

function isInstant(text: string): boolean {
  return ISO_INSTANT.test(text);
}

/**
 * The value a field starts with.
 *
 * A new record starts from the schema's defaults, so the form opens with
 * the school's own choices rather than with a set of empty boxes.
 */
export function initialFormState(
  entity: EntityMeta,
  data: Record<string, unknown> | null,
): FormState {
  const values: Record<string, unknown> = {};
  const json: Record<string, string> = {};
  const touched: Record<string, boolean> = {};

  for (const field of entity.editable) {
    const raw = data?.[field.name];
    const fallback = field.defaultValue;

    if (field.kind === "json") {
      json[field.name] = raw === undefined || raw === null ? "" : JSON.stringify(raw, null, 2);
      values[field.name] = raw ?? null;
      touched[field.name] = false;
      continue;
    }

    if (field.kind === "checkbox") {
      values[field.name] = raw === undefined || raw === null ? fallback === true : raw === true;
      touched[field.name] = false;
      continue;
    }

    if (field.kind === "select") {
      const current = typeof raw === "string" ? raw : typeof fallback === "string" ? fallback : "";
      values[field.name] = current;
      touched[field.name] = false;
      continue;
    }

    if (field.kind === "number") {
      const current =
        typeof raw === "number"
          ? String(raw)
          : typeof fallback === "number"
            ? String(fallback)
            : "";
      values[field.name] = current;
      touched[field.name] = false;
      continue;
    }

    const current = typeof raw === "string" ? raw : typeof fallback === "string" ? fallback : "";
    values[field.name] = current;
    touched[field.name] = false;
  }

  return { values, json, touched };
}

/** Record a change to a field. */
export function setValue(state: FormState, field: FieldSpec, value: unknown): FormState {
  return {
    ...state,
    values: { ...state.values, [field.name]: value },
    touched: { ...state.touched, [field.name]: true },
  };
}

/** Record a change to the text of a JSON field. */
export function setJson(state: FormState, field: FieldSpec, text: string): FormState {
  return {
    ...state,
    json: { ...state.json, [field.name]: text },
    touched: { ...state.touched, [field.name]: true },
  };
}

/**
 * Read one field.
 *
 * An empty box means "not set" for a field that may be absent, and means
 * "this is wrong" for a field that must be there. A field the user has
 * emptied on purpose is sent as null rather than silently ignored.
 */
function resolve(
  field: FieldSpec,
  state: FormState,
  original: Record<string, unknown> | null,
): Resolved {
  const stored = original?.[field.name];
  const hadValue = stored !== undefined && stored !== null;
  const defaultValue = field.defaultValue ?? null;

  if (field.kind === "json") {
    const text = (state.json[field.name] ?? "").trim();
    if (text === "") {
      if (hadValue) {
        return { value: null, present: true, problem: null };
      }
      if (field.required) {
        return { value: null, present: false, problem: `${field.label} is required` };
      }
      return { value: defaultValue, present: false, problem: null };
    }
    try {
      return { value: JSON.parse(text), present: true, problem: null };
    } catch {
      return { value: null, present: false, problem: `${field.label} is not valid JSON` };
    }
  }

  if (field.kind === "checkbox") {
    return { value: state.values[field.name] === true, present: true, problem: null };
  }

  const text = String(state.values[field.name] ?? "").trim();

  if (text === "") {
    if (hadValue) {
      if (field.nullable) {
        return { value: null, present: true, problem: null };
      }
      return { value: null, present: false, problem: `${field.label} is required` };
    }
    if (field.required) {
      return { value: null, present: false, problem: `${field.label} is required` };
    }
    return { value: defaultValue, present: false, problem: null };
  }

  switch (field.kind) {
    case "number": {
      const parsed = Number(text);
      if (!Number.isFinite(parsed)) {
        return { value: null, present: false, problem: `${field.label} must be a number` };
      }
      if (field.minimum !== null && parsed < field.minimum) {
        return {
          value: null,
          present: false,
          problem: `${field.label} must be at least ${field.minimum}`,
        };
      }
      if (field.maximum !== null && parsed > field.maximum) {
        return {
          value: null,
          present: false,
          problem: `${field.label} must be at most ${field.maximum}`,
        };
      }
      return { value: parsed, present: true, problem: null };
    }

    case "select": {
      if (!field.options.includes(text)) {
        return {
          value: null,
          present: false,
          problem: `${field.label} must be one of: ${field.options.join(", ")}`,
        };
      }
      return { value: text, present: true, problem: null };
    }

    case "date": {
      if (!isCalendarDate(text)) {
        return {
          value: null,
          present: false,
          problem: `${field.label} must be a date as YYYY-MM-DD`,
        };
      }
      return { value: text, present: true, problem: null };
    }

    case "datetime": {
      const normalised = normalizeDateTime(text);
      if (!isInstant(normalised)) {
        return {
          value: null,
          present: false,
          problem: `${field.label} must be a date and time as YYYY-MM-DDTHH:MM`,
        };
      }
      return { value: normalised, present: true, problem: null };
    }

    case "longtext":
    case "text":
    default: {
      if (field.maxLength !== null && text.length > field.maxLength) {
        return {
          value: null,
          present: false,
          problem: `${field.label} must be at most ${field.maxLength} characters`,
        };
      }
      if (field.format === "email" && !EMAIL.test(text)) {
        return {
          value: null,
          present: false,
          problem: `${field.label} must be an email address`,
        };
      }
      if (field.format === "ulid" && !IDENTIFIER.test(text)) {
        return {
          value: null,
          present: false,
          problem: `${field.label} must be a 26-character identifier`,
        };
      }
      if (field.pattern !== null && !new RegExp(field.pattern).test(text)) {
        return {
          value: null,
          present: false,
          problem: `${field.label} is not in the expected format`,
        };
      }
      return { value: text, present: true, problem: null };
    }
  }
}

/**
 * Read the whole form.
 *
 * The result is the set of values to send to the server, plus a problem
 * for every field that is not acceptable. A problem is reported against
 * the field it belongs to, so the interface can show it in place.
 */
export function collect(
  entity: EntityMeta,
  state: FormState,
  original: Record<string, unknown> | null = null,
): FormResult {
  const patch: Record<string, unknown> = {};
  const problems: FormProblem[] = [];

  for (const field of entity.editable) {
    const resolved = resolve(field, state, original);
    if (resolved.problem !== null) {
      problems.push({ field: field.name, message: resolved.problem });
      continue;
    }
    if (resolved.present) {
      patch[field.name] = resolved.value;
    }
  }

  return { patch, problems, ok: problems.length === 0 };
}

/**
 * The values the server will work out for this record.
 *
 * The client uses the same rule as the server, so a person sees the total
 * of an invoice as they enter the line items that make it up, even when
 * the device is offline and the server cannot be asked.
 */
export function computedValues(
  entity: EntityMeta,
  patch: Record<string, unknown>,
  original: Record<string, unknown> | null = null,
): Record<string, unknown> {
  if (entity.computed.length === 0) {
    return {};
  }
  const merged = { ...original, ...patch };
  const derived = registry.applyDerived(entity.type, merged);
  const result: Record<string, unknown> = {};
  for (const field of entity.computed) {
    const value = derived[field.name];
    result[field.name] = value === undefined ? (original?.[field.name] ?? null) : value;
  }
  return result;
}

/**
 * The text a field holds in the form.
 *
 * Comparing text rather than typed values keeps the comparison honest:
 * a number the user did not touch is "30", and so is the number the
 * record holds.
 */
function rawText(field: FieldSpec, state: FormState): string {
  if (field.kind === "json") {
    return state.json[field.name] ?? "";
  }
  if (field.kind === "checkbox") {
    return state.values[field.name] === true ? "true" : "false";
  }
  return String(state.values[field.name] ?? "");
}

/** The text a field would hold if it were left alone. */
function defaultText(field: FieldSpec): string {
  if (field.kind === "json") {
    return "";
  }
  if (field.kind === "checkbox") {
    return field.defaultValue === true ? "true" : "false";
  }
  return field.defaultValue === null || field.defaultValue === undefined
    ? ""
    : String(field.defaultValue);
}

/** The text the record holds for a field. */
function originalText(field: FieldSpec, original: Record<string, unknown> | null): string {
  if (original === null) {
    return defaultText(field);
  }
  const value = original[field.name];
  if (value === undefined) {
    return defaultText(field);
  }
  if (field.kind === "json") {
    return value === null ? "" : JSON.stringify(value, null, 2);
  }
  if (field.kind === "checkbox") {
    return value === true ? "true" : "false";
  }
  return value === null ? "" : String(value);
}

/**
 * True when the form holds something the record does not.
 *
 * A new record is compared with the schema's defaults, so opening the
 * form and closing it again is not a change.
 */
export function isDirty(
  entity: EntityMeta,
  state: FormState,
  original: Record<string, unknown> | null,
): boolean {
  for (const field of entity.editable) {
    if (rawText(field, state) !== originalText(field, original)) {
      return true;
    }
  }
  return false;
}

/**
 * What the field accepts, in words.
 *
 * Showing the constraint before the user breaks it is the difference
 * between a form that teaches and a form that scolds.
 */
export function fieldHint(field: FieldSpec): string | null {
  const hints: string[] = [];

  if (field.nullable) {
    hints.push("Optional");
  }
  if (field.maxLength !== null) {
    hints.push(`Up to ${field.maxLength} characters`);
  }
  if (field.minimum !== null && field.maximum !== null) {
    hints.push(`Between ${field.minimum} and ${field.maximum}`);
  } else if (field.minimum !== null) {
    hints.push(`At least ${field.minimum}`);
  } else if (field.maximum !== null) {
    hints.push(`At most ${field.maximum}`);
  }

  switch (field.format) {
    case "email":
      hints.push("For example name@school.org");
      break;
    case "date-time":
      hints.push("As YYYY-MM-DD:HH:MM");
      break;
    case "ulid":
      hints.push("The identifier of the related record");
      break;
    default:
      break;
  }

  if (field.serverDecided.length > 0) {
    // The server works these out, so choosing one of them is not a way of
    // saying it. Saying so saves the person from wondering why the server
    // disagreed.
    hints.push(`The server works out: ${field.serverDecided.join(", ")}`);
  }

  return hints.length === 0 ? null : hints.join(" · ");
}
