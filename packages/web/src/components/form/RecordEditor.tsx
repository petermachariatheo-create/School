import { useEffect, useMemo, useRef, useState } from "react";
import type { ReplicaRecord } from "../../data/db.ts";
import {
  collect,
  computedValues,
  initialFormState,
  isDirty,
  setJson,
  setValue,
  type FormState,
} from "../../app/form.ts";
import { describeEntity, recordLabel, type FieldSpec } from "../../app/fields.ts";
import { relatedTypesFor, sectionsFor } from "../../app/catalog.ts";
import { registerGuard } from "../../app/guards.ts";
import { useStore } from "../../app/store.tsx";
import { Button } from "../../ui/Button.tsx";
import { FormActions } from "./FormActions.tsx";
import { FormSection } from "./FormSection.tsx";

/**
 * A record, being changed.
 *
 * The form is the same for every record type: the sections come from the
 * catalogue, the fields from the schema, and the rules from the same place
 * the server reads them. A new record opens straight into the form, ready
 * to be typed into.
 *
 * The work in the form is guarded: leaving it, by any route, asks first.
 */

export interface RecordEditorProps {
  readonly entityType: string;
  /** The record being changed; null when a new one is being written. */
  readonly record: ReplicaRecord | null;
  /** Called when the changes are saved, or when the person backs out. */
  readonly onClose: () => void;
}

/** The id of the form, so that the action bar can submit it from outside. */
const FORM_ID = "record-editor";

export function RecordEditor({ entityType, record, onClose }: RecordEditorProps): React.ReactNode {
  const { save, remove } = useStore();
  const entity = useMemo(() => describeEntity(entityType), [entityType]);
  const sections = useMemo(() => sectionsFor(entity), [entity]);
  const relationTypes = useMemo(() => relatedTypesFor(entityType), [entityType]);

  const original = record?.data ?? null;
  const [state, setState] = useState<FormState>(() => initialFormState(entity, original));
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  const result = useMemo(() => collect(entity, state, original), [entity, state, original]);
  const dirty = useMemo(() => isDirty(entity, state, original), [entity, state, original]);
  const computed = useMemo(
    () => computedValues(entity, result.patch, original),
    [entity, result.patch, original],
  );

  const problems = useMemo(
    () => new Map(result.problems.map((problem) => [problem.field, problem.message])),
    [result.problems],
  );

  // Leaving a form that holds work that has not been saved has to be asked
  // about, whichever way the person leaves: the buttons, or the back
  // gesture on a phone. The guard is taken down before the form closes,
  // because work that has just been saved is not work to be discarded.
  const releaseGuard = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (!dirty) {
      return;
    }
    const release = registerGuard(() => "Discard the changes that have not been saved?");
    releaseGuard.current = release;
    return () => {
      release();
      releaseGuard.current = null;
    };
  }, [dirty]);

  const leave = (): void => {
    if (dirty && !window.confirm("Discard the changes that have not been saved?")) {
      return;
    }
    releaseGuard.current?.();
    releaseGuard.current = null;
    onClose();
  };

  const submit = async (): Promise<void> => {
    setSubmitted(true);
    if (!result.ok) {
      const first = result.problems[0];
      if (first !== undefined) {
        formRef.current
          ?.querySelector<HTMLElement>(
            `[data-field="${first.field}"] input, [data-field="${first.field}"] select, [data-field="${first.field}"] textarea, [data-field="${first.field}"] button`,
          )
          ?.focus();
      }
      return;
    }
    setBusy(true);
    try {
      await save(entityType, record?.id ?? null, result.patch);
      releaseGuard.current?.();
      releaseGuard.current = null;
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const deleteRecord = async (): Promise<void> => {
    if (record === null) {
      return;
    }
    if (!window.confirm(`Delete ${recordLabel(entityType, original ?? {})}?`)) {
      return;
    }
    setBusy(true);
    try {
      await remove(entityType, record.id);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const title =
    record === null ? `New ${entity.label.toLowerCase()}` : recordLabel(entityType, original ?? {});

  return (
    <div className="editor">
      <header className="editor__header">
        <Button variant="quiet" icon="back" onClick={leave}>
          Back
        </Button>
        <h1 className="editor__title">{title}</h1>
      </header>

      <form
        className="editor__form"
        id={FORM_ID}
        ref={formRef}
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <p className="editor__note">
          Fields marked <span className="field__required">*</span> are required. Everything else can
          be left empty. Your changes are kept on this device and sent to the school server when the
          two can talk.
        </p>

        {sections.map((section) => (
          <FormSection
            key={section.id}
            id={section.id}
            label={section.label}
            hint={section.hint}
            fields={section.fields}
            values={state.values}
            json={state.json}
            computed={computed}
            problems={problems}
            onChange={(field: FieldSpec, value: unknown) =>
              setState((current) => setValue(current, field, value))
            }
            onJsonChange={(field: FieldSpec, text: string) =>
              setState((current) => setJson(current, field, text))
            }
            relationTypes={relationTypes}
          />
        ))}

        {submitted && !result.ok && (
          <div className="editor__summary" role="alert" tabIndex={-1}>
            <h2 className="editor__summary-title">
              {result.problems.length === 1
                ? "One thing to fix"
                : `${result.problems.length} things to fix`}
            </h2>
            <ul>
              {result.problems.map((problem) => (
                <li key={problem.field}>{problem.message}</li>
              ))}
            </ul>
          </div>
        )}
      </form>

      <FormActions
        formId={FORM_ID}
        onCancel={leave}
        onDelete={record === null ? undefined : () => void deleteRecord()}
        busy={busy}
        dirty={dirty}
        problems={submitted ? result.problems : []}
        isNew={record === null}
      />
    </div>
  );
}
