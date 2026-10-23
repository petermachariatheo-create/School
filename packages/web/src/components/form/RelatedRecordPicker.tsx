import { useMemo, useState } from "react";
import { useRecords } from "../../app/hooks.ts";
import { recordLabel } from "../../app/fields.ts";
import { Button } from "../../ui/Button.tsx";
import { Icon } from "../../ui/icons.tsx";

/**
 * Choosing a record that another record points at.
 *
 * A field that points at a student, a class or an invoice used to ask for
 * the identifier, which is a thing the computer made and no person can read.
 * The client holds every record in the school, so it can offer the names
 * instead and let the person search for one.
 *
 * The list of candidates is only read when the picker is opened, so a form
 * that is never changed does not pay for it.
 */

export interface RelatedRecordPickerProps {
  /** The name of the field, for the label and for the error message. */
  readonly field: string;
  /** The entity type the field points at. */
  readonly entityType: string;
  /** The identifier the record holds, or null when it holds none. */
  readonly value: string | null;
  /** Called with the identifier chosen, or null when it is cleared. */
  readonly onChange: (value: string | null) => void;
  /** The problem with the value, if there is one. */
  readonly problem?: string | null;
  readonly describedBy?: string;
}

/** True when a field name points at a record of a known type. */
export function isRelationField(field: string, types: readonly string[]): boolean {
  if (!field.endsWith("Id")) {
    return false;
  }
  return types.includes(field.slice(0, -"Id".length));
}

export function RelatedRecordPicker({
  field,
  entityType,
  value,
  onChange,
  problem = null,
  describedBy,
}: RelatedRecordPickerProps): React.ReactNode {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const { records } = useRecords(entityType);

  const candidates = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const matching = records.filter((record) => {
      if (needle === "") {
        return true;
      }
      return recordLabel(entityType, record.data).toLowerCase().includes(needle);
    });
    return matching.slice(0, 50);
  }, [records, entityType, search]);

  const chosen = value === null ? null : (records.find((r) => r.id === value) ?? null);
  const chosenLabel = chosen === null ? null : recordLabel(entityType, chosen.data);

  return (
    <div className="picker">
      <div className="picker__control">
        <span className={`picker__value ${chosenLabel === null ? "picker__value--empty" : ""}`}>
          {chosenLabel ?? "No record chosen"}
        </span>
        <Button
          variant="quiet"
          size="sm"
          icon="search"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          aria-haspopup="dialog"
          title={`Choose a ${entityType}`}
        >
          {chosenLabel === null ? "Choose" : "Change"}
        </Button>
        {value !== null && (
          <Button
            variant="quiet"
            size="sm"
            onClick={() => onChange(null)}
            title="Clear"
            aria-label={`Clear the ${field}`}
          >
            Clear
          </Button>
        )}
      </div>

      {open && (
        <div className="picker__panel" role="dialog" aria-label={`Choose a ${entityType}`}>
          <input
            className="picker__search"
            type="search"
            autoFocus
            placeholder={`Search ${entityType}s`}
            value={search}
            aria-label={`Search ${entityType}s`}
            onChange={(event) => setSearch(event.target.value)}
          />
          {candidates.length === 0 ? (
            <p className="picker__empty">Nothing matches that.</p>
          ) : (
            <ul className="picker__list">
              {candidates.map((record) => (
                <li key={record.id}>
                  <button
                    type="button"
                    className="picker__option"
                    onClick={() => {
                      onChange(record.id);
                      setOpen(false);
                      setSearch("");
                    }}
                  >
                    {recordLabel(entityType, record.data)}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {problem !== null && (
        <p className="field__problem" id={describedBy} role="alert">
          <Icon name="alert" size={14} />
          {problem}
        </p>
      )}
    </div>
  );
}
