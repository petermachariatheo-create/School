import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { ulid } from "@school/shared";
import { createTestContext, studentFixture, type TestContext } from "./helpers.ts";

describe("entity repository", () => {
  let context: TestContext;

  beforeEach(() => {
    context = createTestContext();
  });

  afterEach(() => {
    context.cleanup();
  });

  test("stores a record and assigns an identifier, revision and sequence", () => {
    const repository = context.repositories.get("student");
    const { record, seq } = repository.upsert({ ...studentFixture(), id: ulid() });

    assert.equal(record["revision"], 1);
    assert.ok(seq > 0);
    assert.ok(record["createdAt"]);
    assert.ok(record["updatedAt"]);
    assert.equal(record["deletedAt"], null);
  });

  test("returns a stored record", () => {
    const repository = context.repositories.get("student");
    const id = ulid();
    repository.upsert({ ...studentFixture(), id });

    const stored = repository.get(id);
    assert.ok(stored !== null);
    assert.equal(stored?.["admissionNumber"], "ADM-001");
    assert.equal(stored?.["firstName"], "Ada");
  });

  test("increments the revision on update and preserves the creation time", () => {
    const repository = context.repositories.get("student");
    const id = ulid();
    const first = repository.upsert({ ...studentFixture(), id });
    const second = repository.upsert({ ...studentFixture({ firstName: "Augusta" }), id });

    assert.equal(first.record["revision"], 1);
    assert.equal(second.record["revision"], 2);
    assert.equal(second.record["createdAt"], first.record["createdAt"]);
    assert.ok(String(second.record["updatedAt"]) >= String(first.record["updatedAt"]));
  });

  test("merges a partial update onto the stored record", () => {
    const repository = context.repositories.get("student");
    const id = ulid();
    repository.upsert({ ...studentFixture(), id });
    const { record } = repository.upsert({ firstName: "Augusta", id });

    assert.equal(record["firstName"], "Augusta");
    assert.equal(record["lastName"], "Lovelace", "unrelated fields survive the merge");
  });

  test("rejects a record that fails validation", () => {
    const repository = context.repositories.get("student");
    assert.throws(
      () => repository.upsert({ ...studentFixture({ admissionNumber: "" }), id: ulid() }),
      /Invalid student/,
    );
  });

  test("soft-deletes a record and hides it from listings", () => {
    const repository = context.repositories.get("student");
    const id = ulid();
    repository.upsert({ ...studentFixture(), id });

    const result = repository.softDelete(id);
    assert.ok(result !== null);
    assert.ok(result.record["deletedAt"] !== null);

    assert.equal(repository.get(id), null, "deleted records are hidden by default");
    assert.notEqual(repository.get(id, { includeDeleted: true }), null);
    assert.equal(repository.list().items.length, 0);
  });

  test("finds a record by its business key", () => {
    const repository = context.repositories.get("student");
    const id = ulid();
    repository.upsert({ ...studentFixture(), id });

    const found = repository.findByNaturalKey({ admissionNumber: "ADM-001" });
    assert.ok(found !== null);
    assert.equal(found?.["id"], id);
    assert.equal(repository.findByNaturalKey({ admissionNumber: "MISSING" }), null);
  });

  test("paginates with a keyset cursor", () => {
    const repository = context.repositories.get("student");
    const ids = [ulid(), ulid(), ulid()].sort();
    for (const [index, id] of ids.entries()) {
      repository.upsert({ ...studentFixture({ admissionNumber: `ADM-${index}` }), id });
    }

    const firstPage = repository.list({ limit: 2 });
    assert.equal(firstPage.items.length, 2);
    assert.notEqual(firstPage.nextCursor, null);

    const secondPage = repository.list({ limit: 2, cursor: firstPage.nextCursor ?? undefined });
    assert.equal(secondPage.items.length, 1);
    assert.equal(secondPage.nextCursor, null);
  });

  test("filters on business fields", () => {
    const repository = context.repositories.get("student");
    repository.upsert({ ...studentFixture({ admissionNumber: "ADM-A" }), id: ulid() });
    repository.upsert({
      ...studentFixture({ admissionNumber: "ADM-B", status: "inactive" }),
      id: ulid(),
    });

    const active = repository.list({ filters: { status: "active" } });
    assert.equal(active.items.length, 1);
    assert.equal(active.items[0]?.["admissionNumber"], "ADM-A");
  });

  test("rejects a filter value that cannot be compared", () => {
    const repository = context.repositories.get("student");
    assert.throws(
      () => repository.list({ filters: { status: { nested: true } } }),
      /cannot be compared/,
    );
  });
});
