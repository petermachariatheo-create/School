import type { SyncOperation, SyncOperationResult, SyncPullResponse } from "@school/shared";
import { ulid } from "@school/shared";
import { ApiError, NetworkError } from "../api/client.ts";
import type { ApiClient } from "../api/client.ts";
import type { OutboxEntry } from "../data/db.ts";
import type { Outbox } from "../data/outbox.ts";
import type { Replica } from "../data/replica.ts";

/**
 * The client synchronisation engine.
 *
 * A sync runs in two directions:
 *
 *   push — every queued local change is sent to the server. The server is
 *          authoritative: it either applies the change, reports a conflict
 *          or rejects it. A rejected change is not retried automatically,
 *          because a change the server refuses will never be accepted.
 *   pull — every change the server has recorded after the client's cursor
 *          is applied to the local replica.
 *
 * When the server reports that the client's cursor is older than the
 * retained change log, the client takes a fresh snapshot instead of
 * pretending it can catch up incrementally.
 */

export interface SyncStatus {
  /** True while a sync is running. */
  readonly syncing: boolean;
  /** Last known network reachability of the server. */
  readonly online: boolean;
  /** Sequence number of the last change applied locally. */
  readonly cursor: number;
  /** Local changes still waiting to be pushed. */
  readonly pending: number;
  /** Local changes the server refused. */
  readonly failed: number;
  /** ISO timestamp of the last successful sync. */
  readonly lastSyncAt: string | null;
  /** Message from the last failed attempt. */
  readonly lastError: string | null;
  /** Server's current sequence number, when known. */
  readonly serverCursor: number | null;
}

export interface SyncReport {
  readonly pushed: number;
  readonly pulled: number;
  readonly conflicts: number;
  readonly rejected: number;
  readonly snapshot: boolean;
}

export interface SyncEngineOptions {
  readonly api: ApiClient;
  readonly replica: Replica;
  readonly outbox: Outbox;
}

const CURSOR_KEY = "cursor";
const CLIENT_ID_KEY = "clientId";
const LAST_SYNC_KEY = "lastSyncAt";

export class SyncEngine {
  readonly #api: ApiClient;
  readonly #replica: Replica;
  readonly #outbox: Outbox;
  #clientId: string | null = null;
  #inFlight: Promise<SyncReport> | null = null;

  constructor(options: SyncEngineOptions) {
    this.#api = options.api;
    this.#replica = options.replica;
    this.#outbox = options.outbox;
  }

  /** Stable identifier for this device. */
  async clientId(): Promise<string> {
    if (this.#clientId !== null) {
      return this.#clientId;
    }
    const stored = await this.#replica.getMeta<string>(CLIENT_ID_KEY);
    if (stored !== undefined && stored !== "") {
      this.#clientId = stored;
      return stored;
    }
    const created = `client-${ulid()}`;
    await this.#replica.setMeta(CLIENT_ID_KEY, created);
    this.#clientId = created;
    return created;
  }

  /** Cursor of the last change applied locally. */
  async cursor(): Promise<number> {
    return (await this.#replica.getMeta<number>(CURSOR_KEY)) ?? 0;
  }

  /** Current status of the client, for display. */
  async status(): Promise<SyncStatus> {
    const entries = await this.#outbox.all();
    return {
      syncing: this.#inFlight !== null,
      online: true,
      cursor: await this.cursor(),
      pending: entries.filter((entry) => entry.status === "pending").length,
      failed: entries.filter((entry) => entry.status === "failed").length,
      lastSyncAt: (await this.#replica.getMeta<string>(LAST_SYNC_KEY)) ?? null,
      lastError: null,
      serverCursor: null,
    };
  }

  /**
   * Run a synchronisation cycle.
   *
   * Concurrent calls share one cycle: the service worker, the UI and the
   * online/offline listener can all ask for a sync without the server
   * receiving the same batch twice.
   */
  async sync(): Promise<SyncReport> {
    if (this.#inFlight !== null) {
      return this.#inFlight;
    }
    const cycle = this.#run().finally(() => {
      this.#inFlight = null;
    });
    this.#inFlight = cycle;
    return cycle;
  }

  async #run(): Promise<SyncReport> {
    let pushed = 0;
    let pulled = 0;
    let conflicts = 0;
    let rejected = 0;
    let snapshot = false;

    // ---- push ----------------------------------------------------------
    const pending = await this.#outbox.pending();
    if (pending.length > 0) {
      const operations = pending.map(toOperation);
      try {
        const response = await this.#api.post<{ results: SyncOperationResult[] }>(
          "/api/v1/sync/push",
          {
            operations,
          },
        );
        const settled: string[] = [];
        for (const result of response.results) {
          if (result.status === "applied" || result.status === "duplicate") {
            settled.push(result.opId);
            pushed += 1;
            await this.#replica.clearPending(result.entityType, result.entityId);
          } else if (result.status === "conflict") {
            // The server kept its own value for the conflicting fields. The
            // entry is settled — the next pull brings the server's version.
            settled.push(result.opId);
            conflicts += 1;
            await this.#replica.clearPending(result.entityType, result.entityId);
          } else {
            rejected += 1;
            await this.#outbox.fail(
              result.opId,
              result.errors?.map((detail) => `${detail.path}: ${detail.message}`).join("; ") ??
                "The server rejected this change",
            );
          }
        }
        await this.#outbox.remove(settled);
      } catch (error) {
        const message = describeError(error);
        for (const entry of pending) {
          await this.#outbox.fail(entry.opId, message);
        }
        throw error;
      }
    }

    // ---- pull ----------------------------------------------------------
    let cursor = await this.cursor();
    for (let page = 0; page < 50; page++) {
      const response = await this.#api.get<SyncPullResponse>(
        `/api/v1/sync/changes?since=${cursor}&limit=500`,
      );

      if (response.requiresSnapshot) {
        await this.#takeSnapshot();
        snapshot = true;
        cursor = await this.cursor();
        pulled += 0;
        continue;
      }

      if (response.changes.length > 0) {
        pulled += await this.#replica.applyChanges(response.changes);
        cursor = response.cursor;
        await this.#replica.setMeta(CURSOR_KEY, cursor);
      }

      if (!response.hasMore) {
        break;
      }
    }

    // ---- report --------------------------------------------------------
    await this.#replica.setMeta(LAST_SYNC_KEY, new Date().toISOString());

    // Tell the server how far this device has read, so the change log is
    // not pruned out from under it.
    try {
      await this.#api.post("/api/v1/sync/clients", {
        clientId: await this.clientId(),
        cursor,
      });
    } catch {
      // Registering is best effort; a failure only delays log pruning.
    }

    return { pushed, pulled, conflicts, rejected, snapshot };
  }

  /** Replace the local replica with the server's current dataset. */
  async #takeSnapshot(): Promise<void> {
    const response = await this.#api.get<{
      cursor: number;
      entities: Record<string, unknown[]>;
    }>("/api/v1/sync/snapshot");
    await this.#replica.applySnapshot(response.entities);
    await this.#replica.setMeta(CURSOR_KEY, response.cursor);
  }

  /** Discard the local replica and download the server's dataset again. */
  async resetFromServer(): Promise<void> {
    await this.#takeSnapshot();
  }
}

function toOperation(entry: OutboxEntry): SyncOperation {
  return {
    opId: entry.opId,
    entityType: entry.entityType,
    entityId: entry.entityId,
    operation: entry.operation,
    patch: entry.patch,
    baseRevision: entry.baseRevision,
    clientTime: entry.clientTime,
  };
}

/** Human-readable message for an error raised by the API client. */
export function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    const fields = error.fieldErrors
      .map((detail) => `${detail.path}: ${detail.message}`)
      .join("; ");
    return fields === "" ? error.problem.title : `${error.problem.title} — ${fields}`;
  }
  if (error instanceof NetworkError) {
    return "The server could not be reached. Changes are kept locally and will be sent when the connection returns.";
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
