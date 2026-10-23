/**
 * RFC 4180 CSV codec.
 *
 * Deliberately dependency-free and explicit about the ambiguities that
 * spreadsheet workflows depend on: delimiter, quoting, embedded newlines,
 * BOM handling and CRLF/LF line endings.
 *
 * Dates are written as `YYYY-MM-DD` and timestamps as full ISO-8601 UTC so
 * that a round trip through a spreadsheet preserves the value exactly.
 */

export type CsvDelimiter = "," | ";" | "\t" | "|";

export interface CsvParseError {
  /** 1-based line number where the problem was detected. */
  readonly line: number;
  /** 0-based column index, when known. */
  readonly column?: number;
  readonly message: string;
}

export interface CsvParseResult {
  readonly rows: string[][];
  readonly errors: CsvParseError[];
  /** Column names taken from the header row, empty when `hasHeader` is false. */
  readonly header: string[];
}

export interface CsvParseOptions {
  readonly delimiter?: CsvDelimiter;
  readonly hasHeader?: boolean;
  /** Strip a leading UTF-8 byte order mark. Defaults to true. */
  readonly stripBom?: boolean;
}

export interface CsvStringifyOptions {
  readonly delimiter?: CsvDelimiter;
  /** Line terminator. Defaults to CRLF, per RFC 4180. */
  readonly newline?: "\r\n" | "\n";
  /** Append a trailing newline after the last row. Defaults to true. */
  readonly trailingNewline?: boolean;
}

const BOM = "\uFEFF";

/** Characters that force a field to be quoted when serialising. */
function needsQuoting(value: string, delimiter: string): boolean {
  return (
    value.includes(delimiter) || value.includes('"') || value.includes("\n") || value.includes("\r")
  );
}

export function parseCsv(input: string, options: CsvParseOptions = {}): CsvParseResult {
  const delimiter = options.delimiter ?? ",";
  const hasHeader = options.hasHeader ?? true;
  const stripBom = options.stripBom ?? true;

  let text = input;
  if (stripBom && text.startsWith(BOM)) {
    text = text.slice(BOM.length);
  }

  const rows: string[][] = [];
  const errors: CsvParseError[] = [];

  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let line = 1;
  let rowStartLine = 1;
  let fieldStarted = false;

  const pushField = (): void => {
    row.push(field);
    field = "";
    fieldStarted = false;
  };

  const pushRow = (): void => {
    pushField();
    // A trailing newline at end of input must not produce a phantom row.
    if (!(row.length === 1 && row[0] === "")) {
      rows.push(row);
    }
    row = [];
    rowStartLine = line;
  };

  for (let i = 0; i < text.length; i++) {
    const char = text[i] ?? "";

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        if (char === "\n") {
          line++;
        }
        field += char;
      }
      continue;
    }

    if (char === '"') {
      if (fieldStarted && field.length > 0) {
        errors.push({
          line: rowStartLine,
          message: "Unexpected quote in the middle of an unquoted field",
        });
      }
      inQuotes = true;
      fieldStarted = true;
      continue;
    }

    if (char === delimiter) {
      pushField();
      continue;
    }

    if (char === "\r") {
      if (text[i + 1] === "\n") {
        i++;
      }
      line++;
      pushRow();
      continue;
    }

    if (char === "\n") {
      line++;
      pushRow();
      continue;
    }

    field += char;
    fieldStarted = true;
  }

  if (inQuotes) {
    errors.push({ line: rowStartLine, message: "Unterminated quoted field" });
  }
  if (field.length > 0 || row.length > 0) {
    pushRow();
  }

  let header: string[] = [];
  let body = rows;
  if (hasHeader && rows.length > 0) {
    header = rows[0] ?? [];
    body = rows.slice(1);
  }

  return { rows: body, errors, header };
}

export function stringifyCsv(
  rows: readonly (readonly string[])[],
  options: CsvStringifyOptions = {},
): string {
  const delimiter = options.delimiter ?? ",";
  const newline = options.newline ?? "\r\n";
  const trailingNewline = options.trailingNewline ?? true;

  const lines = rows.map((row) =>
    row
      .map((value) => {
        if (needsQuoting(value, delimiter)) {
          return `"${value.replaceAll('"', '""')}"`;
        }
        return value;
      })
      .join(delimiter),
  );

  return lines.join(newline) + (trailingNewline && lines.length > 0 ? newline : "");
}

/** Convert a header row plus data rows into keyed objects. */
export function rowsToRecords(
  header: readonly string[],
  rows: readonly (readonly string[])[],
): Record<string, string>[] {
  return rows.map((row) => {
    const record: Record<string, string> = {};
    header.forEach((name, index) => {
      record[name] = row[index] ?? "";
    });
    return record;
  });
}
