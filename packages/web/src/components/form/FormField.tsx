import { fieldHint } from "../../app/form.ts";
import { formatValue } from "../../app/values.ts";
import { optionLabel, relationTypeOf, type FieldSpec } from "../../app/fields.ts";
import { Icon } from "../../ui/icons.tsx";
import { RelatedRecordPicker } from "./RelatedRecordPicker.tsx";

/**
 * A field in a form.
 *
 * The label is above the control and always there, so that the control is
 * never a mystery, and it is tied to the control rather than merely next to
 * it. The hint says what the field accepts, before it is broken rather
 * than after. The problem is in words, next to the control it belongs to.
 *
 * The same component draws every field of every record type, so a form
 * looks and behaves the same wherever it is.
 */

export interface FormFieldProps {
  readonly field: FieldSpec;
  /** The value the field holds. */
  readonly value: unknown;
  /** The raw text of a JSON field, so a half-typed document survives. */
  readonly json: string;
  /** The value the server will work out, for a field the server owns. */
  readonly computed?: unknown;
  /** The problem with the value, if there is one. */
  readonly problem: string | null;
  /** Called with the new value of the field. */
  readonly onChange: (value: unknown) => void;
  /** Called with the new text of a JSON field. */
  readonly onJsonChange: (text: string) => void;
  /** The entity types the record may point at, for the pickers. */
  readonly relationTypes?: readonly string[];
}

export function FormField({
  field,
  value,
  json,
  computed,
  problem,
  onChange,
  onJsonChange,
  relationTypes = [],
}: FormFieldProps): React.ReactNode {
  const inputId = `field-${field.name}`;
  const hintId = `${inputId}-hint`;
  const problemId = `${inputId}-problem`;
  const hint = fieldHint(field);
  const empty = value === null || value === undefined || value === "";
  const wide = field.kind === "longtext" || field.kind === "json";

  const describedBy =
    [hint !== null ? hintId : null, problem !== null ? problemId : null]
      .filter((id): id is string => id !== null)
      .join(" ") || undefined;

  // A field the server owns is shown, never asked for: an invoice's total
  // is the sum of its line items, not something a person types.
  if (field.computed || field.maintained) {
    return (
      <div
        className={`field ${field.computed ? "field--computed" : "field--maintained"} ${wide ? "field--wide" : ""}`}
        data-field={field.name}
      >
        <div className="field__head">
          <label htmlFor={inputId}>{field.label}</label>
        </div>
        <p className="field__value" id={inputId}>
          {formatValue(field.computed ? computed : value, field.options)}
        </p>
        <p className="field__hint" id={hintId}>
          {field.computed
            ? "Worked out by the school server, so it cannot be typed."
            : "Kept by the school server from the records behind it, so it cannot be typed."}
        </p>
      </div>
    );
  }

  const relation = relationTypeOf(field.name, relationTypes);

  return (
    <div className={`field ${wide ? "field--wide" : ""}`} data-field={field.name}>
      <div className="field__head">
        <label htmlFor={inputId}>
          {field.label}
          {field.required && (
            <span className="field__required">
              <span aria-hidden="true">*</span>
              <span className="visually-hidden"> (required)</span>
            </span>
          )}
        </label>
        {field.nullable && !field.required && !empty && relation === undefined && (
          <button
            type="button"
            className="field__clear"
            onClick={() => onChange("")}
            title={`Clear ${field.label}`}
          >
            Clear
          </button>
        )}
      </div>

      {hint !== null && (
        <p className="field__hint" id={hintId}>
          {hint}
        </p>
      )}

      {relation !== null ? (
        <RelatedRecordPicker
          field={field.name}
          entityType={relation}
          value={typeof value === "string" && value !== "" ? value : null}
          onChange={onChange}
          problem={problem}
          describedBy={problem === null ? undefined : problemId}
        />
      ) : field.kind === "checkbox" ? (
        <label className="field__check" htmlFor={inputId}>
          <input
            id={inputId}
            type="checkbox"
            checked={value === true}
            onChange={(event) => onChange(event.target.checked)}
          />
          <span>Yes</span>
        </label>
      ) : field.kind === "select" ? (
        <select
          id={inputId}
          value={String(value ?? "")}
          aria-invalid={problem !== null}
          aria-describedby={describedBy}
          onChange={(event) => onChange(event.target.value)}
        >
          {field.options.length === 0 ? null : <option value="">Choose…</option>}
          {field.options.map((option) => (
            <option key={option} value={option}>
              {optionLabel(option)}
            </option>
          ))}
        </select>
      ) : field.kind === "json" ? (
        <textarea
          id={inputId}
          rows={6}
          spellCheck={false}
          className="mono"
          value={json}
          placeholder="{}"
          aria-invalid={problem !== null}
          aria-describedby={describedBy}
          onChange={(event) => onJsonChange(event.target.value)}
        />
      ) : field.kind === "longtext" ? (
        <textarea
          id={inputId}
          rows={4}
          value={String(value ?? "")}
          aria-invalid={problem !== null}
          aria-describedby={describedBy}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : field.kind === "number" ? (
        <input
          id={inputId}
          type="number"
          value={String(value ?? "")}
          aria-invalid={problem !== null}
          aria-describedby={describedBy}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : field.kind === "date" ? (
        <input
          id={inputId}
          type="date"
          value={String(value ?? "").slice(0, 10)}
          aria-invalid={problem !== null}
          aria-describedby={describedBy}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : field.kind === "datetime" ? (
        <input
          id={inputId}
          type="text"
          placeholder="2026-10-20T08:30"
          value={String(value ?? "")}
          aria-invalid={problem !== null}
          aria-describedby={describedBy}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <input
          id={inputId}
          type={inputTypeFor(field)}
          value={String(value ?? "")}
          autoComplete={autoCompleteFor(field)}
          aria-invalid={problem !== null}
          aria-describedby={describedBy}
          onChange={(event) => onChange(event.target.value)}
        />
      )}

      {problem !== null && (
        <p className="field__problem" id={problemId} role="alert">
          <Icon name="alert" size={14} />
          {problem}
        </p>
      )}
    </div>
  );
}

/** The type of the control, where the field says what it is. */
function inputTypeFor(field: FieldSpec): "text" | "email" | "tel" {
  if (field.format === "email") {
    return "email";
  }
  if (field.name === "phone" || field.name === "alternatePhone") {
    return "tel";
  }
  return "text";
}

/**
 * What the browser should offer to fill in.
 *
 * The names come from the standard, so that a browser can put a person's
 * name or a telephone number in without being asked.
 */
function autoCompleteFor(field: FieldSpec): string | undefined {
  const names: Record<string, string> = {
    firstName: "given-name",
    middleName: "additional-name",
    lastName: "family-name",
    email: "email",
    phone: "tel",
    alternatePhone: "tel",
    address: "street-address",
    dateOfBirth: "bday",
  };
  return names[field.name];
}
