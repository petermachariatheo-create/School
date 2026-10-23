import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { registry } from "@school/shared";
import { ENTITY_TABLES, MIGRATIONS } from "../src/db/migrations.ts";

/**
 * Guard against the schema specification and the entity registry drifting
 * apart.
 *
 * The migration stores the business key of every table as an index, and the
 * registry uses the same keys to detect duplicates during import. If the two
 * ever disagree, an import could report a duplicate that the database does
 * not enforce, or fail to detect one that it does.
 */

describe("schema specification", () => {
  test("every registered entity has a table", () => {
    const tables = new Set(ENTITY_TABLES.map((spec) => spec.table));
    for (const definition of registry.all()) {
      assert.ok(tables.has(definition.table), `${definition.type} has no table`);
    }
  });

  test("every table corresponds to a registered entity", () => {
    const known = new Set(registry.all().map((definition) => definition.table));
    for (const spec of ENTITY_TABLES) {
      assert.ok(known.has(spec.table), `${spec.table} is not registered`);
    }
  });

  test("business keys agree between the registry and the table specification", () => {
    for (const spec of ENTITY_TABLES) {
      const definition = registry.all().find((candidate) => candidate.table === spec.table);
      assert.ok(definition !== undefined);
      assert.deepEqual(
        [...definition.naturalKey].sort(),
        [...spec.naturalKey].sort(),
        `${spec.table} business key differs`,
      );
    }
  });

  test("migration versions are unique and ordered", () => {
    const versions = MIGRATIONS.map((migration) => migration.version);
    assert.deepEqual(
      versions,
      [...versions].sort((a, b) => a - b),
    );
    assert.equal(new Set(versions).size, versions.length);
  });

  test("migration statements are non-empty", () => {
    for (const migration of MIGRATIONS) {
      assert.ok(migration.sql.trim().length > 0, `migration ${migration.version} is empty`);
      assert.ok(migration.name.length > 0);
    }
  });
});
