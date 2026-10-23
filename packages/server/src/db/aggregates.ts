import { registry, type AggregateField } from "@school/shared";
import type { RepositorySet, StoredRecord } from "./repository.ts";

/**
 * Keeping the totals right.
 *
 * Some fields are totals of other records: an invoice's amount paid is the
 * sum of the payments received against it. The declaration lives in the
 * shared registry, so there is one answer to "which fields are totals", and
 * this class does the work the declaration asks for.
 *
 * The work happens inside the transaction of the write that caused it, so a
 * payment and the invoice it changes are committed together or not at all.
 */

export class AggregateMaintainer {
  readonly #repositories: RepositorySet;
  /**
   * The records whose totals are being worked out right now.
   *
   * Writing a total is itself a write, and that write asks for the totals
   * to be worked out again. The set stops that from going round for ever if
   * two entity types were ever to hold a total of each other; the contract
   * check rejects such a declaration outright, so this is the belt to that
   * braces.
   */
  readonly #working = new Set<string>();

  constructor(repositories: RepositorySet) {
    this.#repositories = repositories;
  }

  /**
   * Recompute the totals a write may have changed.
   *
   * Two things can make a total stale: the record that holds it was written
   * (so the total may no longer match its sources), or one of its sources
   * was written (so the total no longer matches the source). Both are
   * handled here, and neither needs to know what kind of record it is.
   */
  maintain(entityType: string, record: StoredRecord): void {
    const key = `${entityType}:${String(record["id"])}`;
    if (this.#working.has(key)) {
      return;
    }
    this.#working.add(key);
    try {
      this.#maintain(entityType, record);
    } finally {
      this.#working.delete(key);
    }
  }

  #maintain(entityType: string, record: StoredRecord): void {
    for (const definition of registry.all()) {
      for (const aggregate of registry.aggregateFields(definition.type)) {
        if (aggregate.source !== entityType) {
          continue;
        }
        const targetId = record[aggregate.via];
        if (typeof targetId !== "string" || targetId === "") {
          continue;
        }
        this.#recompute(definition.type, aggregate, targetId);
      }
    }

    for (const aggregate of registry.aggregateFields(entityType)) {
      const id = record["id"];
      if (typeof id !== "string" || id === "") {
        continue;
      }
      this.#recompute(entityType, aggregate, id);
    }
  }

  /**
   * Work out the total for one record and write it if it has moved.
   *
   * The record is written through the ordinary repository, so the total is
   * validated like any other value, its revision moves on, and the change
   * reaches the clients through the feed.
   */
  #recompute(targetType: string, aggregate: AggregateField, targetId: string): void {
    const repository = this.#repositories.get(targetType);
    const target = repository.get(targetId);
    if (target === null || target["deletedAt"] !== null) {
      // A deleted record has no total to keep right.
      return;
    }

    const filters: Record<string, unknown> = { [aggregate.via]: targetId };
    for (const [sourceField, targetField] of Object.entries(aggregate.match ?? {})) {
      const value = target[targetField];
      if (value === undefined) {
        // The value the sources have to match is not on the record, so
        // there is no safe way to say which sources count.
        return;
      }
      filters[sourceField] = value;
    }

    const total = this.#repositories.get(aggregate.source).sum(aggregate.sumOf, filters);
    const current = target[aggregate.field];
    if (typeof current === "number" && current === total) {
      return;
    }

    repository.upsert({ ...target, [aggregate.field]: total });
  }
}
