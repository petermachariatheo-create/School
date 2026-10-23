import { Button } from "../../ui/Button.tsx";
import { Icon } from "../../ui/icons.tsx";

/**
 * The bar of actions at the foot of a form.
 *
 * It holds what the person can do, and what the form is telling them: the
 * problems that have to be dealt with, and the fact that there is work in
 * the form that has not been saved.
 *
 * The bar sticks to the bottom of the window while the form scrolls under
 * it, and the form has room for it at the end, so that the last field is
 * never hidden behind it.
 */

export interface FormActionsProps {
  /** The form the save button submits. */
  readonly formId?: string;
  /** Called when the person backs out without saving. */
  readonly onCancel: () => void;
  /** Called when the person asks to delete the record. */
  readonly onDelete?: () => void;
  /** True while the save is in flight. */
  readonly busy?: boolean;
  /** True when the form holds something the record does not. */
  readonly dirty?: boolean;
  /** The problems that have to be dealt with, in words. */
  readonly problems?: readonly { field: string; message: string }[];
  /** The label of the save button. */
  readonly saveLabel?: string;
  /** True when there is nothing to save yet. */
  readonly isNew?: boolean;
}

export function FormActions({
  formId,
  onCancel,
  onDelete,
  busy = false,
  dirty = false,
  problems = [],
  saveLabel,
  isNew = false,
}: FormActionsProps): React.ReactNode {
  const first = problems[0];

  return (
    <footer className="form-actions">
      {onDelete !== undefined && (
        <Button variant="danger" icon="trash" onClick={onDelete} disabled={busy}>
          Delete
        </Button>
      )}

      <span className="spacer" />

      <div className="form-actions__state">
        {problems.length > 0 && (
          <span className="form-actions__problems" role="alert">
            <Icon name="alert" size={15} />
            {problems.length === 1
              ? `${first?.message ?? "One problem"}`
              : `${problems.length} problems to fix`}
          </span>
        )}
        {problems.length === 0 && dirty && (
          <span className="form-actions__unsaved">
            <Icon name="edit" size={14} />
            Not saved yet
          </span>
        )}
      </div>

      <Button variant="ghost" onClick={onCancel} disabled={busy}>
        Cancel
      </Button>
      <Button variant="primary" icon="save" type="submit" form={formId} disabled={busy}>
        {busy ? "Saving…" : (saveLabel ?? (isNew ? "Create record" : "Save changes"))}
      </Button>
    </footer>
  );
}
