/**
 * JSON and NDJSON interchange helpers.
 *
 * These are the formats used at system boundaries where a consumer needs a
 * complete, self-describing snapshot: a backup, an export for an analyst,
 * or a bulk transfer to a partner system.
 */

/** Envelope written by exports so that the payload is self-describing. */
export interface ExportEnvelope<T> {
  /** Contract version of the payload, e.g. `1.0.0`. */
  contractVersion: string;
  /** Type of the exported entity. */
  entityType: string;
  /** When the export was produced. */
  exportedAt: string;
  items: T[];
}

/**
 * Format a value as NDJSON.
 *
 * One JSON object per line, so a consumer can process a very large export
 * one record at a time without loading the whole file into memory.
 */
export function toNdJson(items: readonly unknown[]): string {
  let out = "";
  for (const item of items) {
    out += `${JSON.stringify(item)}\n`;
  }
  return out;
}

/**
 * Parse NDJSON.
 *
 * A malformed line is reported rather than aborting the whole parse, so a
 * partially corrupt file still yields the records that are intact.
 */
export function parseNdJson(input: string): {
  items: unknown[];
  errors: { line: number; message: string }[];
} {
  const items: unknown[] = [];
  const errors: { line: number; message: string }[] = [];
  const lines = input.split("\n");
  for (let index = 0; index < lines.length; index++) {
    const line = (lines[index] ?? "").trim();
    if (line === "") {
      continue;
    }
    try {
      items.push(JSON.parse(line));
    } catch (error) {
      errors.push({
        line: index + 1,
        message: error instanceof Error ? error.message : "Invalid JSON",
      });
    }
  }
  return { items, errors };
}

/** Serialise a value as pretty-printed JSON with a trailing newline. */
export function toJsonFile(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}
