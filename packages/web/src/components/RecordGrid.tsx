import type { ReplicaRecord } from "../data/db.ts";
import { paginate } from "../app/pagination.ts";
import { Pager } from "../ui/Pager.tsx";
import { Icon } from "../ui/icons.tsx";
import { RecordCard } from "./RecordCard.tsx";

/**
 * A list of records, as cards.
 *
 * A school holds thousands of students, and a person looking for one of them
 * is looking for a name rather than a row of columns, so the people are
 * shown as cards in a grid.
 */

export interface RecordGridProps {
  readonly entityType: string;
  readonly records: readonly ReplicaRecord[];
  /** The page to show, counting from one. */
  readonly page: number;
  readonly onPageChange: (page: number) => void;
  /** Called when a record is chosen. */
  readonly onSelect: (record: ReplicaRecord) => void;
  /** What to say when there is nothing to show. */
  readonly emptyMessage: string;
  /** The word for the kind of record, in the plural. */
  readonly label: string;
}

export function RecordGrid({
  entityType,
  records,
  page,
  onPageChange,
  onSelect,
  emptyMessage,
  label,
}: RecordGridProps): React.ReactNode {
  if (records.length === 0) {
    return (
      <div className="empty">
        <Icon name="empty" size={26} />
        <p>{emptyMessage}</p>
      </div>
    );
  }

  const shown = paginate(records, page);

  return (
    <>
      <div className="student-grid">
        {shown.items.map((record) => (
          <RecordCard key={record.id} entityType={entityType} record={record} onSelect={onSelect} />
        ))}
      </div>

      <div className="list-footer">
        <p className="list-caption">
          {records.length === 1
            ? `1 ${label.toLowerCase()} held on this device`
            : `${records.length} ${label.toLowerCase()} held on this device`}
        </p>
        <Pager
          page={shown.page}
          pages={shown.pages}
          onPageChange={onPageChange}
          label={`Pages of ${label.toLowerCase()}`}
        />
      </div>
    </>
  );
}
