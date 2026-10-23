/**
 * Date and time helpers.
 *
 * The system stores two kinds of instants:
 *  - `IsoDateTime` — full UTC timestamp, e.g. `2026-10-20T05:41:21.000Z`
 *  - `IsoDate`     — calendar date only, e.g. `2026-10-20`
 *
 * Calendar dates are deliberately *not* converted through a timezone: a
 * school's attendance record for "2026-10-20" means that date in the
 * school's local calendar, and shifting it to UTC would corrupt it.
 */

export function nowIsoDateTime(): string {
  return new Date().toISOString();
}

export function toIsoDate(date: Date = new Date()): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function todayIsoDate(): string {
  return toIsoDate();
}

/**
 * The calendar date of an instant.
 *
 * The system's dates are calendar dates without a timezone, so an instant
 * is read in UTC: `2026-10-20T18:00:10.000Z` is the 20th of October. The
 * function takes the instant rather than reading the clock, so a caller
 * that already knows the instant does not have to ask again.
 */
export function calendarDate(instant: string): string {
  return instant.slice(0, 10);
}

export function parseIsoDate(value: string): Date | null {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function addDays(isoDate: string, days: number): string {
  const base = parseIsoDate(isoDate);
  if (base === null) {
    return isoDate;
  }
  base.setUTCDate(base.getUTCDate() + days);
  return toIsoDate(base);
}

/** Whole days between two calendar dates (b - a). */
export function daysBetween(fromIsoDate: string, endIsoDate: string): number {
  const from = parseIsoDate(fromIsoDate);
  const to = parseIsoDate(endIsoDate);
  if (from === null || to === null) {
    return 0;
  }
  return Math.round((to.getTime() - from.getTime()) / 86_400_000);
}
