import type { FieldSpec } from "../../app/fields.ts";
import { formatValue } from "../../app/values.ts";
import { FormField } from "./FormField.tsx";

/**
 * A group of fields.
 *
 * The groups come from the catalogue, which groups them by the questions
 * somebody actually asks, rather than by the order the database happens to
 * store them in. The heading is a real fieldset legend, so a screen reader
 * says which group a field belongs to.
 */

export interface FormSectionProps {
  readonly id: string;
  readonly label: string;
  readonly hint: string | null;
  readonly fields: readonly FieldSpec[];
  /** The value of every field. */
  readonly values: Record<string, unknown>;
  /** The raw text of every JSON field. */
  readonly json: Record<string, string>;
  /** The values the server will work out. */
  readonly computed: Record<string, unknown>;
  /** The problem with each field, if there is one. */
  readonly problems: ReadonlyMap<string, string>;
  readonly onChange: (field: FieldSpec, value: unknown) => void;
  readonly onJsonChange: (field: FieldSpec, text: string) => void;
  /** The entity types the record may point at. */
  readonly relationTypes?: readonly string[];
}

export function FormSection({
  id,
  label,
  hint,
  fields,
  values,
  json,
  computed,
  problems,
  onChange,
  onJsonChange,
  relationTypes = [],
}: FormSectionProps): React.ReactNode {
  return (
    <fieldset className="section" data-section={id}>
      <legend className="section__legend">{label}</legend>
      {hint !== null && <p className="section__hint">{hint}</p>}

      <div className="section__grid">
        {fields.map((field) => (
          <FormField
            key={field.name}
            field={field}
            value={values[field.name] ?? null}
            json={json[field.name] ?? ""}
            computed={computed[field.name]}
            problem={problems.get(field.name) ?? null}
            onChange={(value) => onChange(field, value)}
            onJsonChange={(text) => onJsonChange(field, text)}
            relationTypes={relationTypes}
          />
        ))}
      </div>
    </fieldset>
  );
}

/**
 * A group of values, read rather than typed.
 *
 * The same groups as the form, so that a person reading a record sees the
 * facts in the same order they would fill them in.
 */

export interface ProfileSectionProps {
  readonly id: string;
  readonly label: string;
  readonly hint: string | null;
  readonly fields: readonly FieldSpec[];
  /** The value of every field. */
  readonly values: Record<string, unknown>;
  /** The values the server works out. */
  readonly computed: Record<string, unknown>;
  /** The names of the records the values point at. */
  readonly labels: ReadonlyMap<string, string>;
}

export function ProfileSection({
  id,
  label,
  hint,
  fields,
  values,
  computed,
  labels,
}: ProfileSectionProps): React.ReactNode {
  const shown = fields.filter((field) => {
    const value = field.computed ? computed[field.name] : values[field.name];
    return value !== undefined && value !== null && value !== "";
  });

  if (shown.length === 0) {
    return null;
  }

  return (
    <section className="profile-section" data-section={id}>
      <h3 className="profile-section__legend">{label}</h3>
      {hint !== null && <p className="profile-section__hint">{hint}</p>}

      <dl className="profile-section__facts">
        {shown.map((field) => {
          const raw = field.computed ? computed[field.name] : values[field.name];
          const nameOf = typeof raw === "string" ? labels.get(raw) : undefined;
          return (
            <div className="profile-fact" key={field.name}>
              <dt>{field.label}</dt>
              <dd>{nameOf ?? formatValue(raw, field.options)}</dd>
            </div>
          );
        })}
      </dl>
    </section>
  );
}
