import { useEffect, useRef } from "react";
import { Button } from "../../ui/Button.tsx";

/**
 * Confirming something that cannot be undone.
 *
 * A browser dialog says "are you sure?" and nothing else. This one says
 * what is about to happen, to what, and what will not be possible
 * afterwards, and it puts the safe answer under the cursor.
 */

export interface ConfirmDestructiveActionProps {
  /** True when the question is on show. */
  readonly open: boolean;
  /** What is about to be undone, in words: "the student Ada Lovelace". */
  readonly subject: string;
  /** What will happen, in words. */
  readonly consequence: string;
  /** Called when the person agrees. */
  readonly onConfirm: () => void;
  /** Called when the person backs out. */
  readonly onCancel: () => void;
}

export function ConfirmDestructiveAction({
  open,
  subject,
  consequence,
  onConfirm,
  onCancel,
}: ConfirmDestructiveActionProps): React.ReactNode {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    cancelRef.current?.focus();
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        onCancel();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onCancel]);

  if (!open) {
    return null;
  }

  return (
    <div className="confirm" role="presentation" onClick={onCancel}>
      <div
        className="confirm__panel"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-consequence"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="confirm__title" id="confirm-title">
          Delete {subject}?
        </h2>
        <p className="confirm__consequence" id="confirm-consequence">
          {consequence}
        </p>

        <div className="confirm__actions">
          <Button variant="secondary" onClick={onCancel} ref={cancelRef}>
            Keep it
          </Button>
          <Button variant="danger" icon="trash" onClick={onConfirm}>
            Delete
          </Button>
        </div>
      </div>
    </div>
  );
}
