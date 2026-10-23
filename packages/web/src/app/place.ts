import { useEffect, useState } from "react";
import { mayLeave } from "./guards.ts";

/**
 * Where the user is.
 *
 * The interface used to keep the page it was showing in a piece of component
 * state, which meant the browser's back button — and the back gesture on a
 * phone, which is how a phone is navigated — left the application rather
 * than returning to the list it came from. The place the user is in is now
 * part of the browser's history, so back means back.
 *
 * The place is kept in the history entry rather than in the address, so
 * that it survives a reload and so that the server never has to know about
 * it: the built client is served from any address the school chooses.
 */

/** The panel on show over the list, if any. */
export type Overlay = "import" | "connect";

export interface Place {
  /** The entity type on show. */
  readonly entityType: string;
  /** The record on show, or null when the list is on show. */
  readonly recordId: string | null;
  /** True when a new record is being made rather than one shown. */
  readonly creating: boolean;
  /** True when the record is open for editing rather than for reading. */
  readonly editing: boolean;
  /** The panel on show over the list, if any. */
  readonly overlay: Overlay | null;
}

/** The list of an entity type, with nothing on show over it. */
export function listPlace(entityType: string): Place {
  return { entityType, recordId: null, creating: false, editing: false, overlay: null };
}

/** A record of an entity type, on show to be read. */
export function recordPlace(entityType: string, recordId: string): Place {
  return { entityType, recordId, creating: false, editing: false, overlay: null };
}

/** A record of an entity type, on show to be changed. */
export function editPlace(entityType: string, recordId: string): Place {
  return { entityType, recordId, creating: false, editing: true, overlay: null };
}

/** A new record of an entity type, on show to be written. */
export function newPlace(entityType: string): Place {
  return { entityType, recordId: null, creating: true, editing: true, overlay: null };
}

/** The list of an entity type, with a panel on show over it. */
export function overlayPlace(entityType: string, overlay: Overlay): Place {
  return { entityType, recordId: null, creating: false, editing: false, overlay };
}

/**
 * Read a place out of a history entry.
 *
 * Anything that is not a place — the entry the page was opened with, or one
 * left behind by something else — reads as null, and the caller falls back
 * to the list.
 */
export function readPlace(state: unknown): Place | null {
  if (typeof state !== "object" || state === null) {
    return null;
  }
  const candidate = state as Partial<Place>;
  if (typeof candidate.entityType !== "string" || candidate.entityType === "") {
    return null;
  }
  const overlay = candidate.overlay;
  const creating = candidate.creating === true;
  return {
    entityType: candidate.entityType,
    recordId: typeof candidate.recordId === "string" ? candidate.recordId : null,
    creating,
    editing: creating || candidate.editing === true,
    overlay: overlay === "import" || overlay === "connect" ? overlay : null,
  };
}

export interface Navigation {
  /** Where the user is. */
  readonly place: Place;
  /** Go somewhere, leaving the place behind in the history. */
  readonly show: (place: Place) => void;
  /** Go back to where the user was. */
  readonly back: () => void;
}

/**
 * Keep the place in step with the browser's history.
 *
 * Going somewhere adds an entry, so the back button returns to the list the
 * user came from. Going back takes the browser back rather than inventing a
 * place, so that the list, the record and the panel are visited in the
 * order the user visited them.
 */
export function useNavigation(firstEntityType: string): Navigation {
  const [place, setPlace] = useState<Place>(
    () => readPlace(window.history.state) ?? listPlace(firstEntityType),
  );

  useEffect(() => {
    // The place the application was opened at is written into the history
    // entry the page was opened with, so that the back button returns to it
    // rather than to whatever was on the screen before it.
    window.history.replaceState(readPlace(window.history.state) ?? listPlace(firstEntityType), "");
    const onPop = (event: PopStateEvent): void => {
      const next = readPlace(event.state) ?? listPlace(firstEntityType);
      if (!mayLeave()) {
        // The browser has already gone somewhere; put the place back.
        window.history.pushState(place, "");
        return;
      }
      setPlace(next);
    };
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
    };
    // The place is read when the listener is put back, which is when the
    // effect runs, so it does not need to run again for it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firstEntityType]);

  const show = (next: Place): void => {
    if (!mayLeave()) {
      return;
    }
    window.history.pushState(next, "");
    setPlace(next);
  };

  const back = (): void => {
    if (!mayLeave()) {
      return;
    }
    window.history.back();
  };

  return { place, show, back };
}
