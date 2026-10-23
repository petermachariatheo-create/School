import type { DatabaseSync } from "node:sqlite";
import {
  registry,
  type SyncChange,
  type SyncOperation,
  type SyncOperationResult,
  type SyncPullResponse,
  type SyncPushRequest,
  type SyncPushResponse,
} from "@school/shared";
import { StatementCache, transaction } from "../db/database.ts";
import { DomainError, type RepositorySet, type StoredRecord } from "../db/repository.ts";

/**
 * Synchronisation engine.
 *
 * The server is authoritative. Clients keep a replica and exchange changes
 * through a cursor-based feed.
 *
 * Conflict model — field-level last-writer-wins, evaluated in the order the
 * server applies operations:
 *
 *   1. A client sends only the fields it changed, plus the `baseRevision`
 *      its edit was based on.
 *   2. The server compares each changed field against the value it held at
 *      `baseRevision` (recovered from the change history).
 *   3. A field that the server has not changed since `baseRevision` is
 *      applied. A field the server *has* changed is a conflict: the
 *      client's value is discarded and the server's value stands.
 *   4. The result reports which fields conflicted, so the client can tell
 *      the user what was overwritten instead of silently losing an edit.
 *
 * This keeps concurrent edits from different devices from destroying each
 * other, without the complexity of a CRDT, and it is explainable to a
 * school administrator.
 */

export class SyncEngine {
  readonly #db: DatabaseSync;
  readonly #repositories: RepositorySet;
  readonly #batchSize: number;
  readonly #clientRetentionDays: number;
  readonly #statements: StatementCache;

  constructor(options: {
    db: DatabaseSync;
    repositories: RepositorySet;
    batchSize: number;
    clientRetentionDays: number;
  }) {
    this.#db = options.db;
    this.#repositories = options.repositories;
    this.#batchSize = options.batchSize;
    this.#clientRetentionDays = options.clientRetentionDays;
    this.#statements = new StatementCache(options.db);
  }

  /** Highest allocated change sequence number. */
  currentCursor(): number {
    const row = this.#statements.get("SELECT value FROM sync_sequence WHERE id = 1").get() as
      | { value?: number }
      | undefined;
    return row?.value ?? 0;
  }

  /** Changes after `since`, ordered by sequence number. */
  pull(since: number, limit?: number): SyncPullResponse {
    const max = Math.min(limit ?? this.#batchSize, 1000);
    const rows = this.#statements
      .get(
        `SELECT seq, entity_type, entity_id, operation, revision, changed_at, data
         FROM changes WHERE seq > ? ORDER BY seq LIMIT ?`,
      )
      .all(since, max + 1) as Record<string, unknown>[];

    const hasMore = rows.length > max;
    const page = hasMore ? rows.slice(0, max) : rows;

    const changes: SyncChange[] = page.map((row) => ({
      entityType: String(row["entity_type"]),
      entityId: String(row["entity_id"]),
      operation: row["operation"] === "delete" ? "delete" : "upsert",
      seq: Number(row["seq"]),
      changedAt: String(row["changed_at"]),
      revision: Number(row["revision"]),
      record: row["data"] === null ? null : (JSON.parse(String(row["data"])) as unknown),
    }));

    const last = page[page.length - 1];
    const logFloor = this.#logFloor();
    return {
      changes,
      cursor: last === undefined ? since : Number(last["seq"]),
      hasMore,
      logFloor,
      // A cursor below the floor means the client missed changes that have
      // already been pruned, so it must start again from a snapshot.
      requiresSnapshot: since < logFloor - 1,
      serverTime: new Date().toISOString(),
    };
  }

  /**
   * Lowest sequence number still retained in the change log.
   *
   * When the log has been emptied the floor is one past the current
   * sequence, which means every client with an older cursor has a gap.
   */
  #logFloor(): number {
    const row = this.#statements.get("SELECT MIN(seq) AS floor FROM changes").get() as
      | { floor?: number | null }
      | undefined;
    const floor = row?.floor;
    return floor === null || floor === undefined ? this.currentCursor() + 1 : Number(floor);
  }

  /** Complete dataset plus the cursor a client should start from. */
  snapshot(): {
    cursor: number;
    serverTime: string;
    entities: Record<string, StoredRecord[]>;
  } {
    const entities: Record<string, StoredRecord[]> = {};
    for (const repository of this.#repositories.all()) {
      // Page through the whole collection: a snapshot that silently stopped
      // at the first page would leave the client with a partial replica.
      const items: StoredRecord[] = [];
      let cursor: string | undefined;
      do {
        const page = repository.list({ limit: 500, cursor, includeDeleted: false });
        items.push(...page.items);
        cursor = page.nextCursor ?? undefined;
      } while (cursor !== undefined);
      entities[repository.definition.type] = items;
    }
    return { cursor: this.currentCursor(), serverTime: new Date().toISOString(), entities };
  }

  /** Record a client's progress so that the change log can be pruned safely. */
  registerClient(clientId: string, cursor: number): void {
    this.#statements
      .get(
        `INSERT INTO sync_clients (client_id, cursor, last_seen_at) VALUES (?, ?, ?)
         ON CONFLICT(client_id) DO UPDATE SET cursor = excluded.cursor, last_seen_at = excluded.last_seen_at`,
      )
      .run(clientId, cursor, new Date().toISOString());
  }

  /**
   * Remove change-log entries that every known client has already seen.
   *
   * The log is only pruned below the oldest cursor among clients that have
   * checked in recently; an offline device with an old cursor keeps the
   * log intact. A safety margin of 1000 entries absorbs clock skew and
   * in-flight requests.
   */
  pruneChanges(): number {
    const cutoffDate = new Date(Date.now() - this.#clientRetentionDays * 86_400_000).toISOString();
    const row = this.#statements
      .get("SELECT MIN(cursor) AS oldest FROM sync_clients WHERE last_seen_at >= ?")
      .get(cutoffDate) as { oldest?: number | null } | undefined;

    const oldest = row?.oldest;
    if (oldest === null || oldest === undefined) {
      return 0;
    }

    const boundary = Math.max(0, oldest - 1000);
    if (boundary <= 0) {
      return 0;
    }
    const result = this.#statements.get("DELETE FROM changes WHERE seq <= ?").run(boundary);
    return Number(result.changes ?? 0);
  }

  /**
   * Apply a batch of client operations.
   *
   * The whole batch is applied in one transaction, so a batch is atomic: a
   * client that retries after a timeout never applies half of it twice, and
   * the server is never left with a partially applied batch.
   *
   * Each operation still gets its own savepoint, so one invalid operation
   * is rejected individually and does not discard the rest of the batch.
   */
  push(request: SyncPushRequest): SyncPushResponse {
    const results: SyncOperationResult[] = [];
    transaction(this.#db, () => {
      let savepoint = 0;
      for (const operation of request.operations) {
        results.push(this.#applyOperationSafely(operation, savepoint));
        savepoint += 1;
      }
    });
    return {
      results,
      cursor: this.currentCursor(),
      serverTime: new Date().toISOString(),
    };
  }

  /**
   * Apply one operation inside its own savepoint.
   *
   * A failure rolls back only this operation; the enclosing transaction
   * survives and the remaining operations are still applied.
   */
  #applyOperationSafely(operation: SyncOperation, index: number): SyncOperationResult {
    const name = `op_${index}`;
    this.#db.exec(`SAVEPOINT ${name}`);
    try {
      const result = this.#applyOperation(operation);
      this.#db.exec(`RELEASE ${name}`);
      return result;
    } catch (error) {
      this.#db.exec(`ROLLBACK TO ${name}`);
      this.#db.exec(`RELEASE ${name}`);
      if (error instanceof DomainError) {
        return {
          opId: operation.opId,
          entityType: operation.entityType,
          entityId: operation.entityId,
          status: "rejected",
          errors: error.problems.map((message) => ({
            path: "",
            message,
            code: "invalid_record",
          })),
        };
      }
      throw error;
    }
  }

  #applyOperation(operation: SyncOperation): SyncOperationResult {
    const existingResult = this.#findAppliedOperation(operation.opId);
    if (existingResult !== null) {
      // The operation was already applied. Returning the original outcome
      // is what stops a retried push from duplicating a payment.
      return { ...existingResult, status: "duplicate" };
    }

    const base = {
      opId: operation.opId,
      entityType: operation.entityType,
      entityId: operation.entityId,
    };

    if (!this.#repositories.has(operation.entityType)) {
      return this.#record(base, {
        status: "rejected",
        errors: [
          {
            path: "entityType",
            message: `Unknown entity type "${operation.entityType}"`,
            code: "unknown_entity_type",
          },
        ],
      });
    }

    const repository = this.#repositories.get(operation.entityType);

    try {
      const outcome =
        operation.operation === "delete"
          ? this.#applyDelete(repository, operation)
          : this.#applyUpsert(repository, operation);

      return this.#record(base, outcome);
    } catch (error) {
      if (error instanceof DomainError) {
        return this.#record(base, {
          status: "rejected",
          errors: error.problems.map((message) => ({
            path: "",
            message,
            code: "invalid_record",
          })),
        });
      }
      throw error;
    }
  }

  #applyUpsert(
    repository: ReturnType<RepositorySet["get"]>,
    operation: SyncOperation,
  ): Omit<SyncOperationResult, "opId" | "entityType" | "entityId"> {
    const patch = operation.patch ?? {};
    // Server-owned fields are ignored rather than rejected, so that a client
    // which sends a whole record still succeeds and stays forward
    // compatible with newer field sets. The fields the server computes are
    // in the same list: the server works them out from the record, so a
    // client cannot state a value the school already knows.
    const serverOwned = new Set(registry.serverOwnedFields(operation.entityType));
    const cleanPatch: Record<string, unknown> = {};
    for (const [field, value] of Object.entries(patch)) {
      if (!serverOwned.has(field)) {
        cleanPatch[field] = value;
      }
    }

    const existing = repository.get(operation.entityId, { includeDeleted: true });

    if (existing === null) {
      const created = transaction(this.#db, () =>
        repository.upsert({ ...cleanPatch, id: operation.entityId } as StoredRecord),
      );
      return { status: "applied", revision: Number(created.record["revision"]), seq: created.seq };
    }

    // A record deleted on the server is not resurrected by an offline edit.
    if (existing["deletedAt"] !== null) {
      return {
        status: "rejected",
        errors: [
          {
            path: "id",
            message: "The record was deleted on the server and cannot be modified.",
            code: "deleted",
          },
        ],
      };
    }

    const baseline = this.#revisionSnapshot(
      operation.entityType,
      operation.entityId,
      operation.baseRevision,
    );
    const serverChangedSinceBase = Number(existing["revision"]) !== operation.baseRevision;
    const conflictingFields: string[] = [];

    if (serverChangedSinceBase) {
      for (const field of Object.keys(cleanPatch)) {
        const baselineValue = baseline === null ? undefined : baseline[field];
        const currentValue = existing[field];
        const clientValue = cleanPatch[field];

        // A conflict requires *both* sides to have changed the field. If
        // only the client changed it, the client's value is applied. If only
        // the server changed it, the client's value is discarded.
        const serverChanged =
          baseline === null ? true : JSON.stringify(currentValue) !== JSON.stringify(baselineValue);
        const clientChanged = JSON.stringify(clientValue) !== JSON.stringify(baselineValue);

        if (serverChanged && clientChanged) {
          conflictingFields.push(field);
        }
      }
    }

    const applied: Record<string, unknown> = {};
    for (const field of Object.keys(cleanPatch)) {
      if (!conflictingFields.includes(field)) {
        applied[field] = cleanPatch[field];
      }
    }

    const result = transaction(this.#db, () =>
      repository.upsert({ ...applied, id: operation.entityId } as StoredRecord),
    );

    return {
      status: conflictingFields.length > 0 ? "conflict" : "applied",
      revision: Number(result.record["revision"]),
      seq: result.seq,
      ...(conflictingFields.length > 0 ? { conflictingFields } : {}),
    };
  }

  #applyDelete(
    repository: ReturnType<RepositorySet["get"]>,
    operation: SyncOperation,
  ): Omit<SyncOperationResult, "opId" | "entityType" | "entityId"> {
    const existing = repository.get(operation.entityId, { includeDeleted: true });
    if (existing === null) {
      return {
        status: "rejected",
        errors: [{ path: "id", message: "The record does not exist.", code: "not_found" }],
      };
    }
    if (existing["deletedAt"] !== null) {
      // Already deleted: the desired state is reached, so this succeeds
      // without producing a new change.
      return { status: "applied", revision: Number(existing["revision"]) };
    }
    const result = transaction(this.#db, () => repository.softDelete(operation.entityId));
    if (result === null) {
      return {
        status: "rejected",
        errors: [{ path: "id", message: "The record does not exist.", code: "not_found" }],
      };
    }
    return { status: "applied", revision: Number(result.record["revision"]), seq: result.seq };
  }

  /** The value a record's fields had at a given revision, from the change history. */
  #revisionSnapshot(
    entityType: string,
    entityId: string,
    revision: number,
  ): Record<string, unknown> | null {
    if (revision <= 0) {
      return null;
    }
    const row = this.#statements
      .get(
        `SELECT data FROM changes
         WHERE entity_type = ? AND entity_id = ? AND revision = ? AND data IS NOT NULL
         ORDER BY seq DESC LIMIT 1`,
      )
      .get(entityType, entityId, revision) as { data?: string } | undefined;
    if (row?.data === undefined) {
      return null;
    }
    return JSON.parse(row.data) as Record<string, unknown>;
  }

  #findAppliedOperation(opId: string): SyncOperationResult | null {
    const row = this.#statements
      .get("SELECT result FROM applied_operations WHERE op_id = ?")
      .get(opId) as { result?: string } | undefined;
    if (row?.result === undefined) {
      return null;
    }
    return JSON.parse(row.result) as SyncOperationResult;
  }

  #record(
    base: { opId: string; entityType: string; entityId: string },
    outcome: Omit<SyncOperationResult, "opId" | "entityType" | "entityId">,
  ): SyncOperationResult {
    const result: SyncOperationResult = { ...base, ...outcome };
    this.#statements
      .get(
        "INSERT INTO applied_operations (op_id, entity_type, entity_id, result, applied_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(
        base.opId,
        base.entityType,
        base.entityId,
        JSON.stringify(result),
        new Date().toISOString(),
      );
    return result;
  }
}
