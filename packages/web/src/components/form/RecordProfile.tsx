import { useMemo, useState } from "react";
import type { ReplicaRecord } from "../../data/db.ts";
import { describeEntity, LABEL_FIELDS, recordLabel } from "../../app/fields.ts";
import {
  iconFor,
  relatedTypesFor,
  sectionsFor,
  cardSpecFor,
  timetableFor,
} from "../../app/catalog.ts";
import { relationTypesOf } from "../../app/fields.ts";
import { useLabels, useRelatedRecords, useTimetable } from "../../app/hooks.ts";
import { useStore } from "../../app/store.tsx";
import { Icon } from "../../ui/icons.tsx";
import { StatusBadge } from "../../ui/StatusBadge.tsx";
import { TimetableWeek } from "../TimetableWeek.tsx";
import { ProfileHeader } from "./ProfileHeader.tsx";
import { ProfileSection } from "./FormSection.tsx";
import { ConfirmDestructiveAction } from "./ConfirmDestructiveAction.tsx";

/** How many related records are listed before the rest are counted. */
const RELATED_LIMIT = 8;

/**
 * A record, read as a record.
 *
 * A person who opens a student usually wants to know something about that
 * student, not to change one. The profile answers the first without putting
 * the second within reach of a stray keystroke.
 *
 * The profile is the same for every record type: the heading comes from the
 * record, the groups come from the catalogue, and the records that point at
 * this one come from the client's own replica.
 */

export interface RecordProfileProps {
  readonly entityType: string;
  readonly record: ReplicaRecord;
  /** Called when the person asks to change the record. */
  readonly onEdit: () => void;
  /** Called when the person backs out of the record. */
  readonly onClose: () => void;
  /** Called when another record is chosen from the related list. */
  readonly onOpen: (entityType: string, recordId: string) => void;
}

export function RecordProfile({
  entityType,
  record,
  onEdit,
  onClose,
  onOpen,
}: RecordProfileProps): React.ReactNode {
  const { remove } = useStore();
  const [confirming, setConfirming] = useState(false);

  const entity = useMemo(() => describeEntity(entityType), [entityType]);
  const sections = useMemo(() => sectionsFor(entity), [entity]);
  const related = useRelatedRecords(entityType, record.id, relatedTypesFor(entityType));
  const { lessons, loading: timetableLoading } = useTimetable(entityType, record.id);

  // The heading already says who this record is, so the fields it is made
  // of would only say the same thing again.
  const facts = useMemo(
    () =>
      sections.map((section) => ({
        ...section,
        fields: section.fields.filter((field) => !LABEL_FIELDS.includes(field.name)),
      })),
    [sections],
  );

  // The records the related ones point at, so that a link between a student
  // and a guardian can be named rather than numbered. The record being
  // looked at is not among them: it is already on the screen.
  const labelTypes = useMemo(
    () =>
      [
        ...new Set(
          related.flatMap((entry) =>
            relationTypesOf(describeEntity(entry.type)).map((type) => type),
          ),
        ),
      ].filter((type) => type !== entityType),
    [related, entityType],
  );
  const labels = useLabels(labelTypes);

  const state = stateOf(record);
  const status = record.data["status"];

  return (
    <>
      <ProfileHeader
        kind={entity.label}
        icon={iconFor(entityType)}
        title={recordLabel(entityType, record.data)}
        identifier={identifierOf(entityType, record.data)}
        badge={typeof status === "string" && status !== "" ? <StatusBadge status={status} /> : null}
        state={state}
        onEdit={onEdit}
        onDelete={state === "deleted" ? undefined : () => setConfirming(true)}
        onClose={onClose}
      />

      <div className="profile-body">
        {facts.map((section) => (
          <ProfileSection
            key={section.id}
            id={section.id}
            label={section.label}
            hint={section.hint}
            fields={section.fields}
            values={record.data}
            computed={{}}
            labels={labels}
          />
        ))}

        {timetableFor(entityType) && (
          <section className="profile-section">
            <h3 className="profile-section__legend">Timetable</h3>
            <p className="profile-section__hint">
              {entityType === "student"
                ? "The lessons of the classes this student is in."
                : "The lessons this class has this week."}
            </p>
            <TimetableWeek
              lessons={lessons}
              labels={labels}
              loading={timetableLoading}
              emptyMessage="There are no lessons for this yet."
            />
          </section>
        )}

        {related.length > 0 && (
          <section className="profile-section">
            <h3 className="profile-section__legend">Related records</h3>
            {related.map((entry) => (
              <div className="profile-related" key={entry.type}>
                <h4 className="profile-related__title">
                  {describeEntity(entry.type).label}
                  <span className="profile-related__count">{entry.records.length}</span>
                </h4>
                {entry.records.length === 0 ? (
                  <p className="profile-related__empty">None yet.</p>
                ) : (
                  <>
                    <ul className="profile-related__list">
                      {entry.records.slice(0, RELATED_LIMIT).map((related) => (
                        <li key={related.id}>
                          <button
                            type="button"
                            className="profile-related__link"
                            onClick={() => onOpen(entry.type, related.id)}
                          >
                            <Icon name={iconFor(entry.type)} size={15} />
                            {namedLabel(entry.type, related.data, labels, record.id)}
                          </button>
                        </li>
                      ))}
                    </ul>
                    {entry.records.length > RELATED_LIMIT && (
                      <p className="profile-related__more">
                        and {entry.records.length - RELATED_LIMIT} more
                      </p>
                    )}
                  </>
                )}
              </div>
            ))}
          </section>
        )}
      </div>

      <ConfirmDestructiveAction
        open={confirming}
        subject={recordLabel(entityType, record.data)}
        consequence="The record is removed from this device and from the school server. It cannot be brought back."
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false);
          void remove(entityType, record.id).then(onClose);
        }}
      />
    </>
  );
}

/**
 * The identifier of a record, where it has one that a person would use.
 *
 * It is the same context the card shows at the top, so that the two views
 * of a record say the same thing. A record with no context of its own falls
 * back to the business key.
 */
function identifierOf(entityType: string, data: Record<string, unknown>): string | null {
  const spec = cardSpecFor(entityType);
  const parts = (spec?.context ?? [])
    .map((field) => {
      const value = data[field];
      return typeof value === "string" && value !== "" ? value : null;
    })
    .filter((value): value is string => value !== null);
  if (parts.length > 0) {
    return parts.join(" · ");
  }
  for (const name of ["invoiceNumber", "paymentNumber", "title", "name"]) {
    const value = data[name];
    if (typeof value === "string" && value !== "") {
      return value;
    }
  }
  return null;
}

/**
 * The name of a related record.
 *
 * A record that has a name of its own is called by it. A link between two
 * records has no name of its own, so it is called by the record it links
 * to — the other one, not the one being looked at.
 */
function namedLabel(
  type: string,
  data: Record<string, unknown>,
  labels: ReadonlyMap<string, string>,
  itself: string,
): string {
  const own = recordLabel(type, data);
  if (own !== data["id"]) {
    return own;
  }
  for (const [field, value] of Object.entries(data)) {
    if (!field.endsWith("Id") || typeof value !== "string" || value === itself) {
      continue;
    }
    const name = labels.get(value);
    if (name !== undefined) {
      return name;
    }
  }
  return own;
}

/** The state of a record on this device. */
function stateOf(record: ReplicaRecord): "new" | "synced" | "pending" | "deleted" {
  if (record.deletedAt !== null) {
    return "deleted";
  }
  if (record.pending) {
    return "pending";
  }
  return "synced";
}
