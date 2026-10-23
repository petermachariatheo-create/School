import type { DatabaseSync } from "node:sqlite";
import {
  calendarDate,
  registry,
  SERVER_MANAGED_FIELDS,
  type EntityDefinition,
} from "@school/shared";
import { AggregateMaintainer } from "./aggregates.ts";
import { StatementCache, transaction } from "./database.ts";

/**
 * Generic persistence for every synced entity.
 *
 * All entity types share one storage shape, so one repository implementation
 * serves the whole system. Adding an entity type means registering it â€” no
 * new SQL, no new data-access code, no new sync code.
 */

export type StoredRecord = Record<string, unknown>;

export interface EntityRow {
  readonly id: string;
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly deletedAt: string | null;
  readonly seq: number;
  /** Business fields, serialised as JSON. */
  readonly data: string;
}

export interface ListQuery {
  readonly limit?: number;
  /** Keyset cursor: the id of the last row of the previous page. */
  readonly cursor?: string | undefined;
  /** Equality filters on business fields. */
  readonly filters?: Readonly<Record<string, unknown>>;
  /** Include soft-deleted records. Off by default. */
  readonly includeDeleted?: boolean;
}

export interface ListResult {
  readonly items: StoredRecord[];
  readonly nextCursor: string | null;
  readonly total: number;
}

export class DomainError extends Error {
  readonly problems: string[];
  constructor(message: string, problems: string[] = []) {
    super(message);
    this.name = "DomainError";
    this.problems = problems;
  }
}

/**
 * Something that keeps the totals of other records up to date.
 *
 * The repository does not know what a total is: it asks the sink after a
 * write, and the sink is the one that reads the registry and works out
 * what has to change.
 */
export interface AggregateSink {
  /** Recompute the totals a write may have changed. */
  maintain(entityType: string, record: StoredRecord): void;
}

/** Values SQLite can bind directly. */
type SqlValue = null | number | bigint | string | Uint8Array;

/**
 * Coerce an arbitrary value into something SQLite can bind.
 *
 * Filters arrive from query strings, so their types are not known in
 * advance. Anything that cannot be represented is rejected rather than
 * silently stringified.
 */
function toSqlValue(value: unknown, column: string): SqlValue {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "bigint") {
    return value;
  }
  if (value instanceof Uint8Array) {
    return value;
  }
  if (typeof value === "boolean") {
    return value ? 1 : 0;
  }
  throw new DomainError(`Filter on "${column}" has a value that cannot be compared`);
}

/**
 * Metadata fields live in dedicated columns and are therefore excluded
 * from the stored business payload.
 */
const META_FIELD_SET = new Set<string>(SERVER_MANAGED_FIELDS);

export class EntityRepository {
  readonly #db: DatabaseSync;
  readonly #definition: EntityDefinition;
  readonly #table: string;
  readonly #businessFields: string[];
  readonly #statements: StatementCache;
  readonly #sink: AggregateSink | null;

  constructor(db: DatabaseSync, definition: EntityDefinition, sink: AggregateSink | null = null) {
    this.#db = db;
    this.#definition = definition;
    this.#table = definition.table;
    this.#statements = new StatementCache(db);
    this.#sink = sink;

    const schema = registry.jsonSchema(definition.type) as { properties?: Record<string, unknown> };
    this.#businessFields = Object.keys(schema.properties ?? {}).filter(
      (name) => !META_FIELD_SET.has(name),
    );
  }

  get definition(): EntityDefinition {
    return this.#definition;
  }

  get table(): string {
    return this.#table;
  }

  get businessFields(): readonly string[] {
    return this.#businessFields;
  }

  /** Allocate the next global change sequence number. */
  allocateSequence(): number {
    const row = this.#statements
      .get("UPDATE sync_sequence SET value = value + 1 WHERE id = 1 RETURNING value")
      .get() as { value?: number } | undefined;
    const value = row?.value;
    if (typeof value !== "number") {
      throw new Error("Failed to allocate a sync sequence number");
    }
    return value;
  }

  /** Rebuild a full record from a stored row. */
  static toRecord(row: EntityRow): StoredRecord {
    const data = JSON.parse(row.data) as StoredRecord;
    return {
      ...data,
      id: row.id,
      revision: row.revision,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      deletedAt: row.deletedAt,
    };
  }

  get(id: string, options: { includeDeleted?: boolean } = {}): StoredRecord | null {
    const sql =
      options.includeDeleted === true
        ? `SELECT * FROM ${this.#table} WHERE id = ?`
        : `SELECT * FROM ${this.#table} WHERE id = ? AND deleted_at IS NULL`;
    const row = this.#statements.get(sql).get(id) as Record<string, unknown> | undefined;
    if (row === undefined) {
      return null;
    }
    return EntityRepository.toRecord({
      id: String(row["id"]),
      revision: Number(row["revision"]),
      createdAt: String(row["created_at"]),
      updatedAt: String(row["updated_at"]),
      deletedAt: row["deleted_at"] === null ? null : String(row["deleted_at"]),
      seq: Number(row["seq"]),
      data: String(row["data"]),
    });
  }

  /** Find a record by its business key. */
  findByNaturalKey(key: Partial<Record<string, unknown>>): StoredRecord | null {
    const entries = Object.entries(key).filter(
      ([, value]) => value !== undefined && value !== null,
    );
    if (entries.length === 0) {
      return null;
    }
    const conditions = entries.map(([column]) => `json_extract(data, '$.${column}') = ?`);
    const sql = `SELECT * FROM ${this.#table} WHERE ${conditions.join(" AND ")} AND deleted_at IS NULL LIMIT 1`;
    const statement = this.#statements.get(sql);
    const row = statement.get(...entries.map(([column, value]) => toSqlValue(value, column))) as
      | Record<string, unknown>
      | undefined;
    if (row === undefined) {
      return null;
    }
    return EntityRepository.toRecord({
      id: String(row["id"]),
      revision: Number(row["revision"]),
      createdAt: String(row["created_at"]),
      updatedAt: String(row["updated_at"]),
      deletedAt: row["deleted_at"] === null ? null : String(row["deleted_at"]),
      seq: Number(row["seq"]),
      data: String(row["data"]),
    });
  }

  list(query: ListQuery = {}): ListResult {
    const limit = Math.min(Math.max(query.limit ?? 50, 1), 500);
    const conditions: string[] = [];
    const parameters: SqlValue[] = [];

    if (query.includeDeleted !== true) {
      conditions.push("deleted_at IS NULL");
    }
    if (query.cursor !== undefined && query.cursor !== "") {
      // ULIDs sort lexicographically by creation time, so the id is a valid
      // keyset cursor.
      conditions.push("id > ?");
      parameters.push(query.cursor);
    }
    for (const [column, value] of Object.entries(query.filters ?? {})) {
      if (value === undefined) {
        continue;
      }
      conditions.push(`json_extract(data, '$.${column}') = ?`);
      parameters.push(toSqlValue(value, column));
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const rows = this.#statements
      .get(`SELECT * FROM ${this.#table} ${where} ORDER BY id LIMIT ?`)
      .all(...parameters, limit + 1) as Record<string, unknown>[];

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const items = page.map((row) =>
      EntityRepository.toRecord({
        id: String(row["id"]),
        revision: Number(row["revision"]),
        createdAt: String(row["created_at"]),
        updatedAt: String(row["updated_at"]),
        deletedAt: row["deleted_at"] === null ? null : String(row["deleted_at"]),
        seq: Number(row["seq"]),
        data: String(row["data"]),
      }),
    );

    const countRow = this.#statements
      .get(`SELECT COUNT(*) AS total FROM ${this.#table} ${where}`)
      .get(...parameters) as { total?: number } | undefined;

    return {
      items,
      nextCursor: hasMore
        ? ((items[items.length - 1]?.["id"] as string | undefined) ?? null)
        : null,
      total: countRow?.total ?? items.length,
    };
  }

  count(includeDeleted = false): number {
    const sql = includeDeleted
      ? `SELECT COUNT(*) AS total FROM ${this.#table}`
      : `SELECT COUNT(*) AS total FROM ${this.#table} WHERE deleted_at IS NULL`;
    const row = this.#statements.get(sql).get() as { total?: number } | undefined;
    return Number(row?.total ?? 0);
  }

  /**
   * The total of a numeric field over the records that match.
   *
   * One statement, so a total over thousands of records does not pull them
   * all into memory. Deleted records do not count, and a record without the
   * field contributes nothing.
   */
  sum(field: string, filters: Readonly<Record<string, unknown>> = {}): number {
    const conditions = ["deleted_at IS NULL"];
    const parameters: SqlValue[] = [];

    for (const [column, value] of Object.entries(filters)) {
      if (value === undefined) {
        continue;
      }
      if (value === null) {
        conditions.push(`json_extract(data, '$.${column}') IS NULL`);
        continue;
      }
      conditions.push(`json_extract(data, '$.${column}') = ?`);
      parameters.push(toSqlValue(value, column));
    }

    const sql = `SELECT COALESCE(SUM(json_extract(data, '$.${field}')), 0) AS total FROM ${this.#table} WHERE ${conditions.join(" AND ")}`;
    const row = this.#statements.get(sql).get(...parameters) as { total?: number } | undefined;
    return Number(row?.total ?? 0);
  }

  /**
   * Insert or update a record and record the change in the feed.
   *
   * The caller is responsible for wrapping this in a transaction when
   * several records must change atomically.
   */
  upsert(
    record: StoredRecord,
    options: { now?: string } = {},
  ): { record: StoredRecord; seq: number } {
    return transaction(this.#db, () => this.#upsertWithinTransaction(record, options));
  }

  /** The write itself; always runs inside a transaction. */
  #upsertWithinTransaction(
    record: StoredRecord,
    options: { now?: string },
  ): { record: StoredRecord; seq: number } {
    const now = options.now ?? new Date().toISOString();
    const existing = this.get(String(record["id"]), { includeDeleted: true });

    const merged: StoredRecord = { ...existing, ...record };
    merged["id"] = record["id"];
    merged["createdAt"] = existing?.["createdAt"] ?? merged["createdAt"] ?? now;
    merged["updatedAt"] = now;
    merged["deletedAt"] = existing?.["deletedAt"] ?? null;
    merged["revision"] = Number(existing?.["revision"] ?? 0) + 1;

    // The rules the server decides are applied for the day of the write, so
    // that a record written late at night is judged by the date on it.
    const validation = registry.validate(this.#definition.type, merged, {
      today: calendarDate(now),
    });
    if (!validation.ok) {
      throw new DomainError(`Invalid ${this.#definition.label.toLowerCase()}`, validation.problems);
    }

    const businessData: StoredRecord = {};
    for (const field of this.#businessFields) {
      if (validation.value[field] !== undefined) {
        businessData[field] = validation.value[field];
      }
    }

    const seq = this.allocateSequence();
    this.#statements
      .get(
        `INSERT INTO ${this.#table} (id, revision, created_at, updated_at, deleted_at, seq, data)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           revision = excluded.revision,
           created_at = excluded.created_at,
           updated_at = excluded.updated_at,
           deleted_at = excluded.deleted_at,
           seq = excluded.seq,
           data = excluded.data`,
      )
      .run(
        String(validation.value["id"]),
        Number(validation.value["revision"]),
        String(validation.value["createdAt"]),
        String(validation.value["updatedAt"]),
        validation.value["deletedAt"] === null ? null : String(validation.value["deletedAt"]),
        seq,
        JSON.stringify(businessData),
      );

    this.#recordChange(seq, "upsert", validation.value);

    // The write may have moved a total that this record holds, or may
    // have been a source of somebody else's total.
    this.#sink?.maintain(this.#definition.type, validation.value);

    return { record: validation.value, seq };
  }

  /** Soft-delete a record so that the deletion propagates through the feed. */
  softDelete(
    id: string,
    options: { now?: string } = {},
  ): { record: StoredRecord; seq: number } | null {
    return transaction(this.#db, () => this.#softDeleteWithinTransaction(id, options));
  }

  #softDeleteWithinTransaction(
    id: string,
    options: { now?: string },
  ): { record: StoredRecord; seq: number } | null {
    const now = options.now ?? new Date().toISOString();
    const existing = this.get(id, { includeDeleted: true });
    if (existing === null || existing["deletedAt"] !== null) {
      return null;
    }

    const revision = Number(existing["revision"]) + 1;
    const seq = this.allocateSequence();

    this.#statements
      .get(
        `UPDATE ${this.#table}
         SET deleted_at = ?, updated_at = ?, revision = ?, seq = ?
         WHERE id = ?`,
      )
      .run(now, now, revision, seq, id);

    const record: StoredRecord = { ...existing, deletedAt: now, updatedAt: now, revision };
    this.#recordChange(seq, "delete", record);

    // A deleted record no longer counts towards the totals it fed.
    this.#sink?.maintain(this.#definition.type, record);

    return { record, seq };
  }

  #recordChange(seq: number, operation: "upsert" | "delete", record: StoredRecord): void {
    this.#statements
      .get(
        `INSERT INTO changes (seq, entity_type, entity_id, operation, revision, changed_at, data)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        seq,
        this.#definition.type,
        String(record["id"]),
        operation,
        Number(record["revision"]),
        String(record["updatedAt"]),
        operation === "delete" ? null : JSON.stringify(record),
      );
  }

  /** Append to the audit trail. */
  audit(
    action: string,
    entityId: string | null,
    detail: unknown,
    actor: string | null = null,
  ): void {
    this.#statements
      .get(
        "INSERT INTO audit_log (at, actor, action, entity_type, entity_id, detail) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(
        new Date().toISOString(),
        actor,
        action,
        this.#definition.type,
        entityId,
        detail === undefined ? null : JSON.stringify(detail),
      );
  }
}

/** One repository per registered entity type. */
export class RepositorySet {
  readonly #repositories = new Map<string, EntityRepository>();
  readonly #maintainer: AggregateMaintainer;

  constructor(db: DatabaseSync) {
    this.#maintainer = new AggregateMaintainer(this);
    for (const definition of registry.all()) {
      this.#repositories.set(
        definition.type,
        new EntityRepository(db, definition, this.#maintainer),
      );
    }
  }

  has(entityType: string): boolean {
    return this.#repositories.has(entityType);
  }

  get(entityType: string): EntityRepository {
    const repository = this.#repositories.get(entityType);
    if (repository === undefined) {
      throw new Error(`Unknown entity type "${entityType}"`);
    }
    return repository;
  }

  all(): EntityRepository[] {
    return [...this.#repositories.values()];
  }
}
