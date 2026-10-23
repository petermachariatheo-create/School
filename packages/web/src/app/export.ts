import { registry, stringifyCsv } from "@school/shared";
import type { ReplicaRecord } from "../data/db.ts";
import { formatValue } from "./values.ts";

/**
 * Offline CSV export.
 *
 * The export is produced from the local replica rather than fetched from
 * the server, so a device with no connection can still hand over its data.
 * The column list comes from the same registry the server uses, which
 * keeps the file readable by the server's import endpoint.
 */

/** Render a value as a CSV cell. */
export function cell(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}

/** Build a CSV document for the given records. */
export function exportCsv(entityType: string, records: readonly ReplicaRecord[]): string {
  const columns = registry.csvColumns(entityType);
  const rows = records.map((record) => columns.map((column) => cell(record.data[column])));
  return stringifyCsv([columns, ...rows]);
}

/** Build a table row for the interface. */
export function displayRow(record: ReplicaRecord, columns: readonly string[]): string[] {
  return columns.map((column) => formatValue(record.data[column]));
}

/** Trigger a browser download of a text file. */
export function downloadText(fileName: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
