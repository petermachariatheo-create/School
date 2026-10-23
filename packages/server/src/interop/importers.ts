import { calendarDate, parseCsv, registry, ulid, type CsvDelimiter } from "@school/shared";
import type { EntityRepository, StoredRecord } from "../db/repository.ts";

/**
 * Import pipeline.
 *
 * An import is a three-step workflow: parse and validate, show the user
 * exactly what would happen, then apply. Row-level problems are reported
 * individually rather than aborting the whole file, and the application
 * step is transactional so a failure leaves the database untouched.
 */

export interface ImportProblem {
  readonly row: number;
  readonly column: string;
  readonly message: string;
}

export type ImportRowStatus = "valid" | "invalid" | "duplicate";

export interface ImportRow {
  /** 1-based row number within the data (the header is row 0). */
  readonly row: number;
  readonly status: ImportRowStatus;
  /** The parsed record, when the row was valid. */
  readonly record: StoredRecord | null;
  readonly problems: string[];
  /** Identifier of the existing record this row duplicates. */
  readonly duplicateOf: string | null;
}

export interface ImportPreview {
  readonly entityType: string;
  readonly columns: string[];
  readonly totalRows: number;
  readonly validRows: number;
  readonly invalidRows: number;
  readonly duplicateRows: number;
  readonly rows: ImportRow[];
  readonly problems: ImportProblem[];
}

export interface ImportOptions {
  readonly delimiter?: CsvDelimiter;
  /** Update an existing record when its business key matches. */
  readonly updateExisting?: boolean;
}

interface PropertySchema {
  readonly type?: string | string[];
  readonly format?: string;
  readonly enum?: readonly unknown[];
  readonly items?: PropertySchema;
  readonly properties?: Record<string, PropertySchema>;
  readonly anyOf?: readonly PropertySchema[];
}

function typesOf(schema: PropertySchema): string[] {
  const type = schema.type;
  if (type !== undefined) {
    return Array.isArray(type) ? type : [type];
  }
  const anyOf = schema.anyOf;
  if (anyOf !== undefined) {
    return anyOf.flatMap((entry) => typesOf(entry));
  }
  return [];
}

/**
 * The non-null branch of a schema.
 *
 * A nullable field is published as `anyOf: [ {…}, { "type": "null" } ]`, so
 * its `format`, `enum` and type live inside the first branch. Without this
 * resolution a nullable number would be coerced to a string and then fail
 * validation.
 */
function resolveBranch(schema: PropertySchema): PropertySchema {
  if (schema.type !== undefined || schema.enum !== undefined || schema.format !== undefined) {
    return schema;
  }
  const anyOf = schema.anyOf;
  if (anyOf !== undefined) {
    for (const branch of anyOf) {
      if (!typesOf(branch).includes("null")) {
        return branch;
      }
    }
  }
  return schema;
}

function isNullable(schema: PropertySchema): boolean {
  return typesOf(schema).includes("null");
}

/**
 * Convert a CSV cell into the type the schema expects.
 *
 * Returns `undefined` when the cell is empty and the field is optional,
 * which lets the validation schema apply its own default.
 */
function coerceValue(
  schema: PropertySchema | undefined,
  raw: string,
): { ok: true; value: unknown } | { ok: false; message: string } {
  const text = raw.trim();
  if (schema === undefined) {
    return text === "" ? { ok: true, value: undefined } : { ok: true, value: text };
  }

  if (text === "") {
    if (isNullable(schema)) {
      return { ok: true, value: null };
    }
    if (typesOf(schema).length === 0) {
      return { ok: true, value: undefined };
    }
    return { ok: true, value: undefined };
  }

  // The format, the enum and the type live in the non-null branch of a
  // nullable field.
  const resolved = resolveBranch(schema);

  if (resolved.enum !== undefined) {
    const match = resolved.enum.find((candidate) => String(candidate) === text);
    if (match === undefined) {
      return { ok: false, message: `Expected one of: ${resolved.enum.join(", ")}` };
    }
    return { ok: true, value: match };
  }

  const types = typesOf(resolved);
  const format = resolved.format;

  if (format === "ulid") {
    if (!/^[0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{26}$/.test(text)) {
      return { ok: false, message: "Expected a 26-character identifier" };
    }
    return { ok: true, value: text };
  }
  if (format === "date") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
      return { ok: false, message: "Expected a date as YYYY-MM-DD" };
    }
    return { ok: true, value: text };
  }
  if (format === "date-time") {
    if (Number.isNaN(Date.parse(text))) {
      return { ok: false, message: "Expected an ISO-8601 timestamp" };
    }
    return { ok: true, value: text };
  }
  if (format === "email") {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) {
      return { ok: false, message: "Expected an email address" };
    }
    return { ok: true, value: text };
  }

  if (types.includes("boolean")) {
    const lowered = text.toLowerCase();
    if (lowered === "true" || lowered === "1" || lowered === "yes") {
      return { ok: true, value: true };
    }
    if (lowered === "false" || lowered === "0" || lowered === "no") {
      return { ok: true, value: false };
    }
    return { ok: false, message: "Expected true or false" };
  }

  if (types.includes("integer")) {
    if (!/^-?\d+$/.test(text)) {
      return { ok: false, message: "Expected a whole number" };
    }
    return { ok: true, value: Number.parseInt(text, 10) };
  }

  if (types.includes("number")) {
    const parsed = Number(text);
    if (Number.isNaN(parsed)) {
      return { ok: false, message: "Expected a number" };
    }
    return { ok: true, value: parsed };
  }

  if (types.includes("object") || types.includes("array")) {
    try {
      return { ok: true, value: JSON.parse(text) };
    } catch {
      return { ok: false, message: "Expected a JSON value" };
    }
  }

  return { ok: true, value: text };
}

/**
 * Parse and validate a CSV file without changing any data.
 *
 * The result tells the user exactly what will happen if they confirm:
 * how many rows are valid, which are invalid and why, and which duplicate
 * an existing record.
 */
export function previewImport(
  repository: EntityRepository,
  csvText: string,
  options: ImportOptions = {},
): ImportPreview {
  const definition = repository.definition;
  const entityType = definition.type;
  // A rule that depends on the date is given the date rather than reading
  // the clock, so the preview shows the record as it will be stored.
  const today = calendarDate(new Date().toISOString());
  const schema = registry.jsonSchema(entityType) as {
    properties?: Record<string, PropertySchema>;
  };
  const properties = schema.properties ?? {};

  const parsed = parseCsv(csvText, { delimiter: options.delimiter ?? ",", hasHeader: true });

  const header = parsed.header.map((name) => name.trim());
  const knownColumns = header.filter((name) => properties[name] !== undefined);
  const unknownColumns = header.filter((name) => properties[name] === undefined);

  const rows: ImportRow[] = [];
  const problems: ImportProblem[] = [];

  for (const [index, row] of parsed.rows.entries()) {
    const rowNumber = index + 1;
    const rowProblems: string[] = [];
    const candidate: Record<string, unknown> = {};

    header.forEach((column, columnIndex) => {
      const raw = row[columnIndex] ?? "";
      const propertySchema = properties[column];
      if (propertySchema === undefined) {
        return;
      }
      const coerced = coerceValue(propertySchema, raw);
      if (!coerced.ok) {
        rowProblems.push(`${column}: ${coerced.message}`);
        problems.push({ row: rowNumber, column, message: coerced.message });
        return;
      }
      if (coerced.value !== undefined) {
        candidate[column] = coerced.value;
      }
    });

    if (rowProblems.length > 0) {
      rows.push({
        row: rowNumber,
        status: "invalid",
        record: null,
        problems: rowProblems,
        duplicateOf: null,
      });
      continue;
    }

    // A file may state a value the server works out for itself, such as an
    // invoice's total. The server will use its own figure, so a file that
    // disagrees is a mistake in the file and the person who made it is
    // told rather than having it quietly corrected.
    const invariantProblems = registry.checkInvariants(entityType, candidate);
    if (invariantProblems.length > 0) {
      for (const message of invariantProblems) {
        problems.push({ row: rowNumber, column: "", message });
      }
      rows.push({
        row: rowNumber,
        status: "invalid",
        record: null,
        problems: invariantProblems,
        duplicateOf: null,
      });
      continue;
    }

    // The record is validated as a creation: the identifier may come from
    // the file, and the server-owned fields are not required of an
    // imported row.
    const validation = registry.validateCreate(entityType, candidate, { today });
    if (!validation.ok) {
      for (const message of validation.problems) {
        problems.push({ row: rowNumber, column: "", message });
      }
      rows.push({
        row: rowNumber,
        status: "invalid",
        record: null,
        problems: validation.problems,
        duplicateOf: null,
      });
      continue;
    }

    const record = validation.value;
    const duplicate = findDuplicate(repository, record);
    if (duplicate !== null) {
      rows.push({
        row: rowNumber,
        status: "duplicate",
        record,
        problems: [],
        duplicateOf: duplicate,
      });
      continue;
    }

    rows.push({ row: rowNumber, status: "valid", record, problems: [], duplicateOf: null });
  }

  return {
    entityType,
    columns: knownColumns,
    totalRows: rows.length,
    validRows: rows.filter((row) => row.status === "valid").length,
    invalidRows: rows.filter((row) => row.status === "invalid").length,
    duplicateRows: rows.filter((row) => row.status === "duplicate").length,
    rows,
    problems: [
      ...problems,
      ...(unknownColumns.length > 0
        ? [{ row: 0, column: unknownColumns.join(", "), message: "Ignored unknown columns" }]
        : []),
    ],
  };
}

/** Locate an existing record with the same business key. */
function findDuplicate(repository: EntityRepository, record: StoredRecord): string | null {
  const naturalKey = repository.definition.naturalKey;
  if (naturalKey.length === 0) {
    return null;
  }
  const key: Record<string, unknown> = {};
  for (const field of naturalKey) {
    const value = record[field];
    if (value === undefined || value === null) {
      return null;
    }
    key[field] = value;
  }
  const existing = repository.findByNaturalKey(key);
  return existing === null ? null : String(existing["id"]);
}

export interface ImportOutcome {
  readonly applied: number;
  readonly updated: number;
  readonly skipped: number;
  readonly errors: { row: number; message: string }[];
}

/**
 * Apply a previously previewed import.
 *
 * Every record is written in one transaction: either the whole import is
 * applied or nothing is, so a failure part-way through cannot leave the
 * school's records half-imported.
 */
export function applyImport(
  repository: EntityRepository,
  preview: ImportPreview,
  options: ImportOptions = {},
): ImportOutcome {
  let applied = 0;
  let updated = 0;
  let skipped = 0;
  const errors: { row: number; message: string }[] = [];

  for (const row of preview.rows) {
    if (row.status === "invalid" || row.record === null) {
      skipped++;
      continue;
    }
    if (row.status === "duplicate") {
      if (options.updateExisting !== true || row.duplicateOf === null) {
        skipped++;
        continue;
      }
      try {
        repository.upsert({ ...row.record, id: row.duplicateOf });
        updated++;
      } catch (error) {
        errors.push({
          row: row.row,
          message: error instanceof Error ? error.message : "Could not update the record",
        });
      }
      continue;
    }
    try {
      repository.upsert({ ...row.record, id: row.record["id"] ?? ulid() });
      applied++;
    } catch (error) {
      errors.push({
        row: row.row,
        message: error instanceof Error ? error.message : "Could not save the record",
      });
    }
  }

  return { applied, updated, skipped, errors };
}
