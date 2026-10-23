/**
 * Guards on navigation.
 *
 * A form holds work that the record does not. Leaving it has to be asked
 * about, and the question has to be asked of every way of leaving: the
 * buttons in the form, and the browser's back button, which is how a phone
 * is navigated.
 *
 * A guard is a function that returns the question to ask, or null when there
 * is nothing to ask about. The navigation asks every guard before it goes
 * anywhere.
 */

export type Guard = () => string | null;

const guards = new Set<Guard>();

/**
 * Register a guard.
 *
 * The returned function takes the guard away again, which is what a form
 * does when it closes.
 */
export function registerGuard(guard: Guard): () => void {
  guards.add(guard);
  return () => {
    guards.delete(guard);
  };
}

/**
 * The first question that has to be asked before leaving, or null.
 */
export function pendingQuestion(): string | null {
  for (const guard of guards) {
    const question = guard();
    if (question !== null) {
      return question;
    }
  }
  return null;
}

/**
 * True when it is all right to leave.
 *
 * The question is asked of the person, so this has to be called from
 * something the browser can block on.
 */
export function mayLeave(): boolean {
  const question = pendingQuestion();
  if (question === null) {
    return true;
  }
  return window.confirm(question);
}
