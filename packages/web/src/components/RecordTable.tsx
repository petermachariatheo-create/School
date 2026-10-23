import { useMemo } from "react";
import type { ReplicaRecord } from "../data/db.ts";
import { formatValue } from "../app/values.ts";
import { paginate } from "../app/pagination.ts";
import { Button } from "../ui/Button.tsx";
import { Icon } from "../ui/icons.tsx";
import { Pager } from "../ui/Pager.tsx";
import type { EntityMeta, FieldSpec } from "../app/fields.ts";

/**
 * The record table.
 *
 * Columns are derived from the entity schema. Which fields are shown is a
 * presentation decision, so it lives with the rest of the interface rather
 * than in the shared contract; the values themselves are validated by the
 * server.
 *
 * A school may hold thousands of students, so the table is paged rather
 * than allowed to grow without limit.
 */

export interface RecordTableProps {
  readonly entity: EntityMeta;
  readonly records: readonly ReplicaRecord[];
  /** The page to show, counting from one. */
  readonly page: number;
  readonly onPageChange: (page: number) => void;
  /** What to say when there is nothing to show. */
  readonly emptyMessage: string;
  readonly onSelect: (record: ReplicaRecord) => void;
  /** The columns to show. */
  readonly columns: readonly string[];
  /** The names of the records the list refers to, by identifier. */
  readonly labels: ReadonlyMap<string, string>;
  /** Optional entity-specific column renderers. */
  readonly columnRenderers?: Partial<
    Record<string, (record: ReplicaRecord, labels: ReadonlyMap<string, string>) => React.ReactNode>
  >;
  /** Current sort state. */
  readonly sort?: { field: string; direction: "asc" | "desc" } | null;
  /** Called when a sortable header is clicked. */
  readonly onSort?: (field: string) => void;
}

export function RecordTable({
  entity,
  records,
  page,
  onPageChange,
  emptyMessage,
  onSelect,
  columns,
  labels,
  columnRenderers = {},
  sort,
  onSort,
}: RecordTableProps): React.ReactNode {
  const fields = useMemo(
    () => new Map<string, FieldSpec>(entity.fields.map((field) => [field.name, field])),
    [entity.fields],
  );

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
    <div className="table-wrap">
      <div className="table-scroll">
        <table className="table">
          <thead>
            <tr>
              {columns.map((name) => {
                const field = fields.get(name);
                const isSorted = sort?.field === name;
                const sortable = field?.required !== false && field?.kind !== "json";
                return (
                  <th
                    key={name}
                    className={sortable ? "sortable" : ""}
                    aria-sort={
                      isSorted ? (sort.direction === "asc" ? "ascending" : "descending") : "none"
                    }
                    onClick={sortable ? () => onSort?.(name) : undefined}
                  >
                    <div className="th-content">
                      <span>{field?.label ?? name}</span>
                      {sortable && <span className="sort-indicator" />}
                    </div>
                  </th>
                );
              })}
              <th>State</th>
              <th className="table__actions-head">
                <span className="visually-hidden">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.items.map((record) => {
              const deleted = record.deletedAt !== null;
              return (
                <tr
                  key={record.id}
                  className={deleted ? "row row--deleted" : "row"}
                  onClick={() => onSelect(record)}
                  tabIndex={0}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      onSelect(record);
                    }
                  }}
                >
                  {columns.map((name, index) => {
                    const customRenderer = columnRenderers[name];
                    const field = fields.get(name);
                    return (
                      <td key={name} className={index === 0 ? "primary-cell" : ""}>
                        {customRenderer
                          ? customRenderer(record, labels)
                          : renderCell(record.data, name, labels, field)}
                      </td>
                    );
                  })}
                  <td>{renderStateCell(record)}</td>
                  <td className="table__actions">
                    <Button
                      size="sm"
                      variant="quiet"
                      icon="edit"
                      onClick={(event) => {
                        event.stopPropagation();
                        onSelect(record);
                      }}
                      title={`Edit this ${entity.label.toLowerCase()}`}
                      aria-label={`Edit ${entity.label.toLowerCase()}`}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="list-footer">
        <p className="list-caption">
          {records.length === 1
            ? "1 record held on this device"
            : `${records.length} records held on this device`}
        </p>
        <Pager page={shown.page} pages={shown.pages} onPageChange={onPageChange} />
      </div>
    </div>
  );
}

function renderCell(
  data: Record<string, unknown>,
  name: string,
  labels: ReadonlyMap<string, string>,
  field?: FieldSpec,
): React.ReactNode {
  const value = data[name];
  const nameOf = typeof value === "string" ? labels.get(value) : undefined;
  if (nameOf !== undefined) {
    return nameOf;
  }
  return formatValue(value, field?.options);
}

function renderStateCell(record: { deletedAt: string | null; pending: boolean }): React.ReactNode {
  if (record.deletedAt !== null) {
    return <span className="pill pill--deleted">Deleted</span>;
  }
  if (record.pending) {
    return (
      <span
        className="sync-indicator sync-indicator--pending"
        title="Waiting to be sent to the school server"
        aria-label="Waiting to be sent to the school server"
      />
    );
  }
  return (
    <span
      className="sync-indicator sync-indicator--synced"
      title="Synced with the school server"
      aria-label="Synced with the school server"
    />
  );
}
