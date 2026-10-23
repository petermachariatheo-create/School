import { optionLabel } from "../app/fields.ts";

/**
 * The status of a record, as a badge.
 *
 * The badge carries a coloured dot and the status in words. The colour
 * says it at a glance and the word says it to somebody who cannot see the
 * colour, so one indicator carries the meaning rather than three.
 */

/** How a status reads: settled, worth watching, wrong, or neither. */
export type StatusTone = "positive" | "caution" | "critical" | "info" | "neutral";

/**
 * The tone of each status the domain knows.
 *
 * The words are the domain's; the tones are the interface's. A status the
 * interface does not know is shown in the neutral tone under its own name,
 * rather than being given a colour that means something else.
 */
const TONES: Record<string, StatusTone> = {
  // People
  active: "positive",
  graduated: "info",
  inactive: "caution",
  withdrawn: "critical",
  transferred: "neutral",
  // Money
  paid: "positive",
  partially_paid: "caution",
  overdue: "critical",
  draft: "neutral",
  issued: "info",
  void: "critical",
  // Attendance
  present: "positive",
  late: "caution",
  absent: "critical",
};

export interface StatusBadgeProps {
  /** The status the record holds. */
  readonly status: string | null | undefined;
}

export function StatusBadge({ status }: StatusBadgeProps): React.ReactNode {
  const value = typeof status === "string" && status !== "" ? status : null;
  const tone = value === null ? "neutral" : (TONES[value] ?? "neutral");
  const label = value === null ? "Unknown" : optionLabel(value);

  return (
    <span className={`status-badge status-badge--${tone}`}>
      <span className="status-badge__dot" aria-hidden="true" />
      <span className="status-badge__label">{label}</span>
    </span>
  );
}
