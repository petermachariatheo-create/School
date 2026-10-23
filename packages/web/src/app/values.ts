import { optionLabel } from "./fields.ts";

/**
 * Value helpers shared by the interface.
 *
 * These live outside the components so that they can be unit tested in Node:
 * the client has no browser test runner, so the pure logic is kept pure.
 */

/** Format a value for display in a table cell. */
export function formatValue(value: unknown, options?: readonly string[]): string {
  if (value === null || value === undefined) {
    return "—";
  }
  if (typeof value === "boolean") {
    return value ? "yes" : "no";
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  if (typeof value === "string" && options !== undefined && options.includes(value)) {
    return optionLabel(value);
  }
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    // A calendar date is written as a date, the same way the card writes it.
    return formatCalendarDate(value);
  }
  return String(value);
}

/**
 * Format a calendar date for people to read.
 *
 * The date is read from its own text rather than from a `Date`, so that a
 * date never moves a day because of the timezone the device happens to be
 * in: "2024-01-15" is the fifteenth of January everywhere.
 */
export function formatCalendarDate(value: unknown): string {
  if (typeof value !== "string") {
    return "—";
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (match === null) {
    return value === "" ? "—" : value;
  }
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  const month = months[Number(match[2]) - 1] ?? match[2];
  return `${Number(match[3])} ${month} ${match[1]}`;
}

/**
 * Normalise a date or date-time the user typed into the wire format.
 *
 * The contract accepts `YYYY-MM-DD` for a calendar date and full ISO-8601
 * UTC for an instant. A native date-time control produces a local time with
 * no zone and no seconds, which the contract would reject, so the
 * convenience forms are expanded here.
 */
export function normalizeDateTime(value: string): string {
  const trimmed = value.trim();
  if (trimmed === "") {
    return trimmed;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(trimmed)) {
    return `${trimmed}:00.000Z`;
  }
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(trimmed)) {
    return `${trimmed}.000Z`;
  }
  return trimmed;
}
