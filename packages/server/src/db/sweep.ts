import { calendarDate, registry, type RefinedField } from "@school/shared";
import type { RepositorySet, StoredRecord } from "./repository.ts";

/**
 * The daily sweep.
 *
 * Some values depend on the passage of time rather than on a write. An
 * invoice that was issued last term and falls due today is overdue, and
 * nothing about the record has changed: there is no write to hang the
 * change on. The server has to go and look for it, once a day, and that is
 * what this does.
 *
 * The sweep does not know what an invoice is. It asks the registry which
 * fields the server decides, and re-decides them for every record that has
 * one, so a new kind of value that follows from the date needs no code here.
 */

/** How many records are read at a time. */
const PAGE_SIZE = 500;

export interface SweepResult {
  /** The records the sweep looked at. */
  readonly inspected: number;
  /** The records the sweep changed. */
  readonly changed: number;
}

export interface SweeperOptions {
  /** The repositories the sweep reads and writes through. */
  readonly repositories: RepositorySet;
}

/** True when a rule moved a field away from the value the record holds. */
function moved(
  refined: readonly RefinedField[],
  before: StoredRecord,
  after: StoredRecord,
): boolean {
  return refined.some((entry) => !Object.is(before[entry.field], after[entry.field]));
}

export class Sweeper {
  readonly #repositories: RepositorySet;

  constructor(options: SweeperOptions) {
    this.#repositories = options.repositories;
  }

  /**
   * Re-decide every field the server decides, for the day the sweep runs for.
   *
   * A change is an ordinary write: the record's revision moves on and the
   * change reaches the clients through the feed, so a device that has been
   * offline sees the same status the server holds.
   */
  run(now: string): SweepResult {
    const today = calendarDate(now);
    let inspected = 0;
    let changed = 0;

    for (const definition of registry.all()) {
      const refined = registry.refinedFields(definition.type);
      if (refined.length === 0) {
        // Nothing about this entity type depends on the date.
        continue;
      }

      const repository = this.#repositories.get(definition.type);
      let cursor: string | undefined;

      for (;;) {
        const page = repository.list({ limit: PAGE_SIZE, cursor });
        for (const record of page.items) {
          inspected += 1;
          const decided = registry.applyRefined(definition.type, record, { today });
          if (!moved(refined, record, decided)) {
            continue;
          }
          repository.upsert(decided, { now });
          changed += 1;
        }
        if (page.nextCursor === null) {
          break;
        }
        // The records keep their identifiers when they are written, so the
        // page the sweep is on does not move under it.
        cursor = page.nextCursor;
      }
    }

    return { inspected, changed };
  }
}
