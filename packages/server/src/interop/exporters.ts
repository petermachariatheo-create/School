import { registry, stringifyCsv, toJsonFile, toNdJson, type ExportEnvelope } from "@school/shared";
import type { EntityRepository, StoredRecord } from "../db/repository.ts";

/**
 * Exports.
 *
 * Every export uses a standard, documented format so that school data is
 * never trapped inside a proprietary container. CSV is offered for
 * spreadsheet work, JSON for a complete self-describing snapshot, and
 * NDJSON for large transfers that should be processed one record at a time.
 */

export interface ExportOptions {
  /** Include soft-deleted records. Off by default. */
  readonly includeDeleted?: boolean;
  readonly limit?: number;
}

/** Format a single value for a CSV cell. */
function csvCell(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "object") {
    // Nested structures are represented as JSON so that a CSV round trip
    // never loses data silently.
    return JSON.stringify(value);
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  return String(value);
}

export function exportCsv(repository: EntityRepository, options: ExportOptions = {}): string {
  const definition = repository.definition;
  const columns = registry.csvColumns(definition.type);
  const result = repository.list({
    limit: options.limit ?? 10_000,
    includeDeleted: options.includeDeleted === true,
  });

  const rows: string[][] = [columns];
  for (const record of result.items) {
    rows.push(columns.map((column) => csvCell(record[column])));
  }
  return stringifyCsv(rows);
}

export function exportJson(
  repository: EntityRepository,
  options: ExportOptions = {},
): ExportEnvelope<StoredRecord> {
  const definition = repository.definition;
  const result = repository.list({
    limit: options.limit ?? 10_000,
    includeDeleted: options.includeDeleted === true,
  });
  return {
    contractVersion: "1.0.0",
    entityType: definition.type,
    exportedAt: new Date().toISOString(),
    items: result.items,
  };
}

export function exportNdjson(repository: EntityRepository, options: ExportOptions = {}): string {
  const result = repository.list({
    limit: options.limit ?? 10_000,
    includeDeleted: options.includeDeleted === true,
  });
  return toNdJson(result.items);
}

/** Pretty-printed JSON file content for an export. */
export function exportJsonFile(repository: EntityRepository, options: ExportOptions = {}): string {
  return toJsonFile(exportJson(repository, options));
}
