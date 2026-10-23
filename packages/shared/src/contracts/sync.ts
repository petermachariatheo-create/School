import * as z from "zod";
import { EntityId, IsoDateTime } from "../domain/common.ts";
import { ErrorDetail } from "./errors.ts";

/**
 * Synchronisation contract.
 *
 * The server is authoritative. Clients keep a local replica and exchange
 * changes with the server through two operations:
 *
 *   pull  — `GET /sync/changes?since=<cursor>` returns every change with a
 *           sequence number above the cursor, so a client downloads only
 *           what it has not seen.
 *   push  — `POST /sync/push` submits locally-made changes. Every
 *           operation carries a client-generated `opId`, so replaying a
 *           push after a timeout cannot duplicate a write.
 *
 * Conflict model: field-level last-writer-wins, evaluated in the order the
 * server applies operations. See `docs/decisions/0002-sync-conflict-model.md`.
 */

export const ChangeOperation = z.enum(["upsert", "delete"]);
export type ChangeOperation = z.infer<typeof ChangeOperation>;

export const SyncChange = z.object({
  entityType: z.string().min(1).max(64),
  entityId: EntityId,
  operation: ChangeOperation,
  /** Global monotonic sequence number assigned by the server. */
  seq: z.int().min(1),
  changedAt: IsoDateTime,
  /** Revision of the record after this change. */
  revision: z.int().min(1),
  /** Full record for `upsert`; null for `delete`. */
  record: z.unknown().nullable(),
});
export type SyncChange = z.infer<typeof SyncChange>;

export const SyncPullQuery = z.object({
  /** Last sequence number the client has applied. */
  since: z.coerce.number().int().min(0).default(0),
  /** Maximum number of changes to return in one response. */
  limit: z.coerce.number().int().min(1).max(1000).default(500),
});
export type SyncPullQuery = z.infer<typeof SyncPullQuery>;

export const SyncPullResponse = z.object({
  changes: z.array(SyncChange),
  /** Cursor to send as `since` on the next pull. */
  cursor: z.int().min(0),
  /** True when the server has more changes beyond this page. */
  hasMore: z.boolean(),
  /**
   * Lowest sequence number still retained in the change log.
   *
   * The log is pruned once every client has caught up, so a client that was
   * offline for a long time can end up with a cursor older than the log.
   * Comparing the cursor with this value tells the client whether it missed
   * changes and must take a fresh snapshot.
   */
  logFloor: z.int().min(0),
  /** True when the client's cursor is older than the retained change log. */
  requiresSnapshot: z.boolean(),
  serverTime: IsoDateTime,
});
export type SyncPullResponse = z.infer<typeof SyncPullResponse>;

export const SyncOperation = z.object({
  /**
   * Client-generated identifier for this operation. The server records it
   * so that a repeated push returns the original result instead of
   * applying the change twice.
   */
  opId: z.string().min(8).max(64),
  entityType: z.string().min(1).max(64),
  entityId: EntityId,
  operation: ChangeOperation,
  /** Fields the client changed. Ignored for `delete`. */
  patch: z.record(z.string(), z.unknown()).nullable().default(null),
  /** Revision the client's edit was based on; 0 means "create". */
  baseRevision: z.int().min(0).default(0),
  /** Client clock time, used for ordering diagnostics only. */
  clientTime: IsoDateTime,
});
export type SyncOperation = z.infer<typeof SyncOperation>;

export const SyncPushRequest = z.object({
  operations: z.array(SyncOperation).min(1).max(500),
});
export type SyncPushRequest = z.infer<typeof SyncPushRequest>;

export const OPERATION_STATUSES = ["applied", "duplicate", "conflict", "rejected"] as const;
export const OperationStatus = z.enum(OPERATION_STATUSES);
export type OperationStatus = z.infer<typeof OperationStatus>;

export const SyncOperationResult = z.object({
  opId: z.string(),
  status: OperationStatus,
  entityType: z.string(),
  entityId: EntityId,
  /** Revision after applying; absent when rejected or conflicted. */
  revision: z.int().min(1).optional(),
  /** Sequence number assigned to the change; absent when not applied. */
  seq: z.int().min(1).optional(),
  /** Why the operation was rejected. */
  errors: z.array(ErrorDetail).optional(),
  /**
   * Fields whose client value lost to a concurrent server change. Present
   * on `conflict` results.
   */
  conflictingFields: z.array(z.string()).optional(),
});
export type SyncOperationResult = z.infer<typeof SyncOperationResult>;

export const SyncPushResponse = z.object({
  results: z.array(SyncOperationResult),
  /** Cursor the client should store after applying these results. */
  cursor: z.int().min(0),
  serverTime: IsoDateTime,
});
export type SyncPushResponse = z.infer<typeof SyncPushResponse>;
