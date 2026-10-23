/**
 * The state of a record.
 *
 * A record can be on the server, on the device waiting to go there, or
 * refused by the server. Saying which, in one place, means that the list,
 * the profile and the form all say it the same way.
 *
 * The wording is careful: a change that is on the device has not reached
 * the school yet, and the interface must not say that it has.
 */

export type RecordState = "new" | "synced" | "pending" | "deleted" | "failed";

export interface DraftStatusProps {
  /** The state of the record. */
  readonly state: RecordState;
  /** How many changes are waiting, when there are some. */
  readonly count?: number;
  /** The last thing that went wrong, when something did. */
  readonly error?: string | null;
}

export function DraftStatus({ state, count = 0, error = null }: DraftStatusProps): React.ReactNode {
  if (state === "deleted") {
    return (
      <span
        className="draft-status draft-status--deleted"
        title={error ?? "This record has been deleted"}
      >
        Deleted
      </span>
    );
  }

  if (state === "failed") {
    return (
      <span
        className="draft-status draft-status--failed"
        title={error ?? "The server refused this change"}
      >
        <span className="draft-status__dot" aria-hidden="true" />
        Refused
        {count > 0 && <span className="draft-status__count">{count}</span>}
      </span>
    );
  }

  if (state === "pending") {
    return (
      <span
        className="draft-status draft-status--pending"
        title="On this device, waiting to be sent to the school server"
      >
        <span className="draft-status__dot" aria-hidden="true" />
        Waiting
        {count > 0 && <span className="draft-status__count">{count}</span>}
      </span>
    );
  }

  if (state === "new") {
    return (
      <span className="draft-status draft-status--new" title="Not saved yet">
        Not saved
      </span>
    );
  }

  return (
    <span className="draft-status draft-status--synced" title="On the school server">
      <span className="draft-status__dot" aria-hidden="true" />
      Synced
    </span>
  );
}
