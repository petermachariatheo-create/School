import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { ulid } from "@school/shared";
import { Sweeper } from "../src/db/sweep.ts";
import { createTestContext, type TestContext } from "./helpers.ts";

/**
 * The daily sweep.
 *
 * An invoice that falls due today is overdue today, and nothing about the
 * record changed to say so. The server has to go and look for it, and the
 * sweep is where it looks: it asks the registry which fields the server
 * decides and re-decides them, so it does not need to know what an invoice
 * is.
 */

function invoiceFixture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    invoiceNumber: "INV-1",
    studentId: ulid(),
    guardianId: null,
    term: "Term 1",
    issueDate: "2026-01-05",
    dueDate: "2026-03-31",
    currency: "USD",
    status: "issued",
    lineItems: [{ description: "Tuition", quantity: 2, unitAmount: 100 }],
    notes: null,
    ...overrides,
  };
}

describe("the daily sweep", () => {
  let context: TestContext;

  beforeEach(() => {
    context = createTestContext();
  });

  afterEach(() => {
    context.cleanup();
  });

  test("an invoice is issued while it is not yet due", () => {
    const invoices = context.repositories.get("invoice");
    const { record } = invoices.upsert(
      { ...invoiceFixture(), id: ulid() },
      { now: "2026-03-01T00:00:00.000Z" },
    );

    assert.equal(record["status"], "issued");
  });

  test("an invoice is overdue once the day has passed", () => {
    const invoices = context.repositories.get("invoice");
    const id = ulid();
    invoices.upsert({ ...invoiceFixture(), id }, { now: "2026-03-01T00:00:00.000Z" });

    const result = new Sweeper({ repositories: context.repositories }).run(
      "2026-04-01T06:00:00.000Z",
    );

    assert.equal(result.changed, 1);
    assert.equal(invoices.get(id)?.["status"], "overdue");
  });

  test("a sweep changes nothing when there is nothing to change", () => {
    const invoices = context.repositories.get("invoice");
    invoices.upsert({ ...invoiceFixture(), id: ulid() }, { now: "2026-03-01T00:00:00.000Z" });

    const sweeper = new Sweeper({ repositories: context.repositories });
    const first = sweeper.run("2026-04-01T06:00:00.000Z");
    const second = sweeper.run("2026-04-02T06:00:00.000Z");

    assert.equal(first.changed, 1);
    assert.equal(second.changed, 0);
  });

  test("a decision the school made is not undone by the sweep", () => {
    const invoices = context.repositories.get("invoice");
    const draft = ulid();
    const voided = ulid();
    invoices.upsert(
      { ...invoiceFixture({ invoiceNumber: "INV-2", status: "draft" }), id: draft },
      { now: "2026-03-01T00:00:00.000Z" },
    );
    invoices.upsert(
      { ...invoiceFixture({ invoiceNumber: "INV-3", status: "void" }), id: voided },
      { now: "2026-03-01T00:00:00.000Z" },
    );

    const result = new Sweeper({ repositories: context.repositories }).run(
      "2026-04-01T06:00:00.000Z",
    );

    assert.equal(result.changed, 0);
    assert.equal(invoices.get(draft)?.["status"], "draft");
    assert.equal(invoices.get(voided)?.["status"], "void");
  });

  test("a deleted invoice is left alone", () => {
    const invoices = context.repositories.get("invoice");
    const id = ulid();
    invoices.upsert({ ...invoiceFixture(), id }, { now: "2026-03-01T00:00:00.000Z" });
    invoices.softDelete(id, { now: "2026-03-02T00:00:00.000Z" });

    const result = new Sweeper({ repositories: context.repositories }).run(
      "2026-04-01T06:00:00.000Z",
    );

    assert.equal(result.inspected, 0);
    assert.equal(result.changed, 0);
  });

  test("only the records the server decides for are looked at", () => {
    const invoices = context.repositories.get("invoice");
    const students = context.repositories.get("student");
    invoices.upsert({ ...invoiceFixture(), id: ulid() }, { now: "2026-03-01T00:00:00.000Z" });
    students.upsert({
      id: ulid(),
      admissionNumber: "ADM-1",
      firstName: "Ada",
      lastName: "Lovelace",
    });

    const result = new Sweeper({ repositories: context.repositories }).run(
      "2026-04-01T06:00:00.000Z",
    );

    assert.equal(result.inspected, 1);
  });

  test("the change is an ordinary write, so the clients see it", () => {
    const invoices = context.repositories.get("invoice");
    const id = ulid();
    const written = invoices.upsert(
      { ...invoiceFixture(), id },
      { now: "2026-03-01T00:00:00.000Z" },
    );

    const before = context.sync.currentCursor();
    new Sweeper({ repositories: context.repositories }).run("2026-04-01T06:00:00.000Z");

    const changes = context.sync.pull(before).changes;
    const change = changes.find((entry) => entry.entityType === "invoice" && entry.entityId === id);
    assert.ok(change !== undefined, "the invoice was not changed in the feed");
    assert.equal((change?.record as Record<string, unknown> | null)?.["status"], "overdue");
    assert.equal(invoices.get(id)?.["revision"], Number(written.record["revision"]) + 1);
  });
});
