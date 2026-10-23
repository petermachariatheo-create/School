/**
 * Schema migrations.
 *
 * Migrations are ordered, immutable and recorded in `schema_migrations`.
 * A migration that has been applied is never edited; corrections are made
 * by adding a new migration. This keeps upgrades and rollbacks auditable,
 * which matters when the only copy of a school's data is one laptop.
 */

/**
 * Storage shape shared by every synced entity.
 *
 * `data` holds the business fields only. Identity, revision, timestamps and
 * the sync sequence live in their own columns so that they can be indexed
 * and filtered in SQL without parsing JSON. The repository is the single
 * writer that keeps the two representations consistent.
 */
const ENTITY_TABLE_COLUMNS = `
  id          TEXT    PRIMARY KEY,
  revision    INTEGER NOT NULL,
  created_at  TEXT    NOT NULL,
  updated_at  TEXT    NOT NULL,
  deleted_at  TEXT,
  seq         INTEGER NOT NULL,
  data        TEXT    NOT NULL
`;

/**
 * Entity tables.
 *
 * The business key of each table is indexed so that lookups and import
 * duplicate detection stay fast as the data grows. Keys whose members may
 * be null use a non-unique index: enforcing uniqueness in the database
 * would reject legitimate records that merely share a partial name.
 */
interface EntityTableSpec {
  readonly table: string;
  readonly naturalKey: readonly string[];
  readonly unique: boolean;
}

/**
 * The tables the first entity migration created.
 *
 * They are listed separately because that migration has been applied
 * everywhere and is never edited: a table added since then goes in
 * `LATER_TABLES` and gets a migration of its own.
 */
const FOUNDATION_TABLES: readonly EntityTableSpec[] = [
  { table: "students", naturalKey: ["admissionNumber"], unique: true },
  { table: "guardians", naturalKey: ["firstName", "lastName", "email"], unique: false },
  { table: "student_guardians", naturalKey: ["studentId", "guardianId"], unique: true },
  { table: "classes", naturalKey: ["name", "academicYear"], unique: true },
  { table: "enrollments", naturalKey: ["studentId", "classId"], unique: true },
  { table: "attendance", naturalKey: ["studentId", "classId", "date"], unique: true },
  { table: "assessments", naturalKey: ["classId", "title", "date"], unique: false },
  { table: "assessment_results", naturalKey: ["assessmentId", "studentId"], unique: true },
  { table: "invoices", naturalKey: ["invoiceNumber"], unique: true },
  { table: "payments", naturalKey: ["paymentNumber"], unique: true },
];

/** The tables added after the first entity migration. */
const LATER_TABLES: readonly EntityTableSpec[] = [
  { table: "timetables", naturalKey: ["classId", "day", "startTime"], unique: true },
];

export const ENTITY_TABLES: readonly EntityTableSpec[] = [...FOUNDATION_TABLES, ...LATER_TABLES];

function renderEntityTables(specs: readonly EntityTableSpec[]): string {
  const statements: string[] = [];

  for (const spec of specs) {
    statements.push(`CREATE TABLE ${spec.table} (${ENTITY_TABLE_COLUMNS});`);
    statements.push(`CREATE INDEX idx_${spec.table}_seq ON ${spec.table}(seq);`);
    const keyColumns = spec.naturalKey
      .map((column) => `json_extract(data, '$.${column}')`)
      .join(", ");
    if (spec.unique) {
      // Partial index: soft-deleted rows do not block re-creation.
      statements.push(
        `CREATE UNIQUE INDEX uq_${spec.table}_natural ON ${spec.table}(${keyColumns}) WHERE deleted_at IS NULL;`,
      );
    } else {
      statements.push(`CREATE INDEX idx_${spec.table}_natural ON ${spec.table}(${keyColumns});`);
    }
  }
  return statements.join("\n");
}

export interface Migration {
  readonly version: number;
  readonly name: string;
  readonly sql: string;
}

export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: "foundation",
    sql: `
      CREATE TABLE schema_migrations (
        version    INTEGER PRIMARY KEY,
        name       TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );

      -- Global monotonic sequence. Allocated explicitly with RETURNING
      -- rather than relying on lastInsertRowid, which the SQLite binding
      -- may narrow for large values.
      CREATE TABLE sync_sequence (
        id    INTEGER PRIMARY KEY CHECK (id = 1),
        value INTEGER NOT NULL
      );
      INSERT INTO sync_sequence (id, value) VALUES (1, 0);

      -- The change feed. Clients pull rows with seq greater than their
      -- cursor, so every write is transferred exactly once.
      CREATE TABLE changes (
        seq         INTEGER PRIMARY KEY,
        entity_type TEXT NOT NULL,
        entity_id   TEXT NOT NULL,
        operation   TEXT NOT NULL CHECK (operation IN ('upsert', 'delete')),
        revision    INTEGER NOT NULL,
        changed_at  TEXT NOT NULL,
        data        TEXT
      );
      CREATE INDEX idx_changes_entity ON changes(entity_type, entity_id);

      -- Records the outcome of every applied client operation so that a
      -- repeated push is recognised instead of being applied twice.
      CREATE TABLE applied_operations (
        op_id       TEXT PRIMARY KEY,
        entity_type TEXT NOT NULL,
        entity_id   TEXT NOT NULL,
        result      TEXT NOT NULL,
        applied_at  TEXT NOT NULL
      );

      -- Client progress, used to decide how far the change log may be pruned.
      CREATE TABLE sync_clients (
        client_id    TEXT PRIMARY KEY,
        cursor       INTEGER NOT NULL DEFAULT 0,
        last_seen_at TEXT NOT NULL
      );

      -- Durable queue for work that must reach an external system.
      CREATE TABLE outbox (
        id               TEXT PRIMARY KEY,
        topic            TEXT NOT NULL,
        payload          TEXT NOT NULL,
        contract_version TEXT NOT NULL,
        idempotency_key  TEXT NOT NULL,
        status           TEXT NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending', 'processing', 'done', 'failed')),
        attempts         INTEGER NOT NULL DEFAULT 0,
        available_at     TEXT NOT NULL,
        created_at       TEXT NOT NULL,
        updated_at       TEXT NOT NULL,
        last_error       TEXT
      );
      CREATE INDEX idx_outbox_due ON outbox(status, available_at);

      -- Append-only audit trail of consequential actions.
      CREATE TABLE audit_log (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        at          TEXT NOT NULL,
        actor       TEXT,
        action      TEXT NOT NULL,
        entity_type TEXT,
        entity_id   TEXT,
        detail      TEXT
      );
      CREATE INDEX idx_audit_entity ON audit_log(entity_type, entity_id);
    `,
  },
  {
    version: 2,
    name: "entity_tables",
    sql: renderEntityTables(FOUNDATION_TABLES),
  },
  {
    version: 3,
    name: "timetables",
    sql: renderEntityTables(LATER_TABLES),
  },
];
