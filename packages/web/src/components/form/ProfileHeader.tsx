import type { ReactNode } from "react";
import type { IconName } from "../../app/catalog.ts";
import { Button } from "../../ui/Button.tsx";
import { Icon } from "../../ui/icons.tsx";
import { DraftStatus, type RecordState } from "./DraftStatus.tsx";

/**
 * The identity of a record.
 *
 * Who it is, what state it is in, and what can be done to it. The name is
 * the largest thing on the page, because it is what the person came for,
 * and the identifier sits under it in a quieter voice.
 *
 * The actions are on the right: the one that is expected first, and the
 * one that cannot be undone, kept apart.
 */

export interface ProfileHeaderProps {
  /** The kind of record, for the small label above the name. */
  readonly kind: string;
  /** The icon that stands for the kind. */
  readonly icon: IconName;
  /** The name of the record. */
  readonly title: string;
  /** The identifier, under the name. */
  readonly identifier?: string | null;
  /** The badge that says what state the record is in. */
  readonly badge?: ReactNode;
  /** The state of the record on this device. */
  readonly state: RecordState;
  readonly count?: number;
  readonly error?: string | null;
  /** Called when the person asks to change the record. */
  readonly onEdit?: () => void;
  /** Called when the person asks to delete the record. */
  readonly onDelete?: () => void;
  /** Called when the person backs out of the record. */
  readonly onClose?: () => void;
}

export function ProfileHeader({
  kind,
  icon,
  title,
  identifier = null,
  badge = null,
  state,
  count = 0,
  error = null,
  onEdit,
  onDelete,
  onClose,
}: ProfileHeaderProps): React.ReactNode {
  return (
    <header className="profile-header">
      <div className="profile-header__identity">
        <span className="profile-header__kind">
          <Icon name={icon} size={15} />
          {kind}
        </span>
        <h1 className="profile-header__title">{title}</h1>
        <div className="profile-header__meta">
          {identifier !== null && <span className="profile-header__identifier">{identifier}</span>}
          {badge}
          <DraftStatus state={state} count={count} error={error} />
        </div>
      </div>

      <div className="profile-header__actions">
        {onClose !== undefined && (
          <Button variant="quiet" icon="back" onClick={onClose}>
            Back
          </Button>
        )}
        {onEdit !== undefined && (
          <Button variant="primary" icon="edit" onClick={onEdit}>
            Edit
          </Button>
        )}
        {onDelete !== undefined && (
          <Button
            variant="quiet"
            icon="trash"
            onClick={onDelete}
            title={`Delete this ${kind.toLowerCase()}`}
          >
            <span className="visually-hidden">Delete</span>
          </Button>
        )}
      </div>
    </header>
  );
}
