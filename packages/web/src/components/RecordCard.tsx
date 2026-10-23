import type { ReplicaRecord } from "../data/db.ts";
import { cardSpecFor } from "../app/catalog.ts";
import { recordLabel, describeEntity } from "../app/fields.ts";
import { formatCalendarDate, formatValue } from "../app/values.ts";
import { Button } from "../ui/Button.tsx";
import { StatusBadge } from "../ui/StatusBadge.tsx";

/**
 * A record, as a card.
 *
 * The card has the same shape for every record: the identifier at the top
 * and the edit button beside it, the name, the status, a divider, and the
 * facts that a person would want on a card. Which facts those are depends
 * on the record, so the catalogue says.
 *
 * The structure is fixed, so that a list of cards can be scanned down the
 * middle rather than read.
 */

/** The letters a person's gender is shown by. */
const GENDER_INITIALS: Record<string, string> = {
  male: "M",
  female: "F",
  other: "O",
  undisclosed: "U",
};

export interface RecordCardProps {
  readonly entityType: string;
  readonly record: ReplicaRecord;
  /** Called when the card is chosen. */
  readonly onSelect: (record: ReplicaRecord) => void;
}

export function RecordCard({ entityType, record, onSelect }: RecordCardProps): React.ReactNode {
  const data = record.data;
  const spec = cardSpecFor(entityType);
  const name = recordLabel(entityType, data);
  const deleted = record.deletedAt !== null;
  const pending = record.pending;
  const context = (spec?.context ?? [])
    .map((field) => valueOf(data, field))
    .filter((value): value is string => value !== null)
    .join(" · ");
  const status = valueOf(data, "status");

  return (
    <article
      className={`student-card ${deleted ? "student-card--deleted" : ""}`}
      onClick={() => onSelect(record)}
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          onSelect(record);
        }
      }}
    >
      <div className="student-card__top">
        <span className="student-card__admission">{context}</span>

        <div className="student-card__top-actions">
          {pending && (
            <span
              className="student-card__sync"
              title="Waiting to be sent to the school server"
              aria-label="Waiting to be sent to the school server"
            />
          )}
          {deleted && <span className="student-card__deleted">Deleted</span>}
          <Button
            variant="quiet"
            size="sm"
            icon="edit"
            onClick={(event) => {
              event.stopPropagation();
              onSelect(record);
            }}
            title="Edit"
            aria-label={`Edit ${name}`}
          />
        </div>
      </div>

      <div className="student-card__body">
        <h3 className="student-card__name">{name === "" ? "Unnamed" : name}</h3>
        {status !== null && <StatusBadge status={status} />}
      </div>

      <div className="student-card__divider" />

      <div className="student-card__footer">
        {spec?.facts.map((fact) => {
          const value = valueOf(data, fact.field);
          if (value === null) {
            return null;
          }
          if (fact.badge === true) {
            const initial = GENDER_INITIALS[value] ?? value.charAt(0).toUpperCase();
            return (
              <span
                className="student-card__gender"
                key={fact.field}
                title={value}
                aria-label={value}
              >
                {initial}
              </span>
            );
          }
          return (
            <span className="student-card__fact" key={fact.field}>
              <span className="student-card__fact-label">{labelOf(entityType, fact.field)}</span>
              {fact.field === "admissionDate" ? formatCalendarDate(value) : formatValue(value)}
            </span>
          );
        })}
      </div>
    </article>
  );
}

/** The label of a field, in the words a person would use. */
function labelOf(entityType: string, field: string): string {
  const found = describeEntity(entityType).fields.find((candidate) => candidate.name === field);
  return found?.label ?? field;
}

/** The value of a field, or null when it holds nothing worth showing. */
function valueOf(data: Record<string, unknown>, field: string): string | null {
  const value = data[field];
  if (typeof value !== "string" || value === "") {
    return null;
  }
  return value;
}
