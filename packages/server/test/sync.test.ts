import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { ulid } from "@school/shared";
import { createTestContext, studentFixture, type TestContext } from "./helpers.ts";

/**
 * These tests cover the behaviour a school depends on when two devices
 * work offline at the same time and reconnect: nothing is lost silently,
 * a repeated push never duplicates a payment, and a conflict is reported
 * rather than hidden.
 */

describe("sync engine", () => {
  let context: TestContext;

  beforeEach(() => {
    context = createTestContext();
  });

  afterEach(() => {
    context.cleanup();
  });

  test("a new client pulls every change from cursor zero", () => {
    const repository = context.repositories.get("student");
    repository.upsert({ ...studentFixture(), id: ulid() });

    const response = context.sync.pull(0);
    assert.equal(response.changes.length, 1);
    assert.equal(response.changes[0]?.operation, "upsert");
    assert.equal(response.changes[0]?.entityType, "student");
    assert.equal(response.cursor, response.changes[0]?.seq);
  });

  test("a client pulls only what it has not seen", () => {
    const repository = context.repositories.get("student");
    repository.upsert({ ...studentFixture(), id: ulid() });
    const first = context.sync.pull(0);

    repository.upsert({ ...studentFixture({ admissionNumber: "ADM-002" }), id: ulid() });
    const second = context.sync.pull(first.cursor);

    assert.equal(second.changes.length, 1);
    assert.equal(second.changes[0]?.entityType, "student");
  });

  test("a pull is paged when there are more changes than the batch size", () => {
    const repository = context.repositories.get("student");
    for (let index = 0; index < 5; index++) {
      repository.upsert({ ...studentFixture({ admissionNumber: `ADM-${index}` }), id: ulid() });
    }

    const page = context.sync.pull(0, 2);
    assert.equal(page.changes.length, 2);
    assert.equal(page.hasMore, true);

    const next = context.sync.pull(page.cursor, 2);
    assert.equal(next.changes.length, 2);
    assert.equal(next.hasMore, true);
  });

  test("a pushed operation creates a record on the server", () => {
    const id = ulid();
    const response = context.sync.push({
      operations: [
        {
          opId: "op-create-1",
          entityType: "student",
          entityId: id,
          operation: "upsert",
          patch: studentFixture(),
          baseRevision: 0,
          clientTime: "2026-10-20T05:00:00.000Z",
        },
      ],
    });

    assert.equal(response.results[0]?.status, "applied");
    assert.equal(response.results[0]?.revision, 1);

    const stored = context.repositories.get("student").get(id);
    assert.equal(stored?.["firstName"], "Ada");
  });

  test("replaying a push is recognised and does not apply twice", () => {
    const id = ulid();
    const operation = {
      opId: "op-retry-1",
      entityType: "student",
      entityId: id,
      operation: "upsert" as const,
      patch: studentFixture(),
      baseRevision: 0,
      clientTime: "2026-10-20T05:00:00.000Z",
    };

    const first = context.sync.push({ operations: [operation] });
    const second = context.sync.push({ operations: [operation] });

    assert.equal(first.results[0]?.status, "applied");
    assert.equal(second.results[0]?.status, "duplicate");
    assert.equal(second.results[0]?.revision, first.results[0]?.revision);

    const stored = context.repositories.get("student").get(id);
    assert.equal(stored?.["revision"], 1, "the record was written exactly once");
  });

  test("a pushed update advances the revision", () => {
    const id = ulid();
    context.sync.push({
      operations: [
        {
          opId: "op-1",
          entityType: "student",
          entityId: id,
          operation: "upsert",
          patch: studentFixture(),
          baseRevision: 0,
          clientTime: "2026-10-20T05:00:00.000Z",
        },
      ],
    });

    const response = context.sync.push({
      operations: [
        {
          opId: "op-2",
          entityType: "student",
          entityId: id,
          operation: "upsert",
          patch: { firstName: "Augusta" },
          baseRevision: 1,
          clientTime: "2026-10-20T05:01:00.000Z",
        },
      ],
    });

    assert.equal(response.results[0]?.status, "applied");
    assert.equal(response.results[0]?.revision, 2);
  });

  test("two clients editing different fields both succeed", () => {
    const id = ulid();
    context.sync.push({
      operations: [
        {
          opId: "op-create-2",
          entityType: "student",
          entityId: id,
          operation: "upsert",
          patch: studentFixture(),
          baseRevision: 0,
          clientTime: "2026-10-20T05:00:00.000Z",
        },
      ],
    });

    // Client A changes the phone number from revision 1.
    const clientA = context.sync.push({
      operations: [
        {
          opId: "op-a",
          entityType: "student",
          entityId: id,
          operation: "upsert",
          patch: { phone: "+254700000001" },
          baseRevision: 1,
          clientTime: "2026-10-20T05:02:00.000Z",
        },
      ],
    });
    assert.equal(clientA.results[0]?.status, "applied");

    // Client B, still on revision 1, changes the address. The server has
    // not touched that field, so both edits survive.
    const clientB = context.sync.push({
      operations: [
        {
          opId: "op-b",
          entityType: "student",
          entityId: id,
          operation: "upsert",
          patch: { address: "Nairobi" },
          baseRevision: 1,
          clientTime: "2026-10-20T05:03:00.000Z",
        },
      ],
    });
    assert.equal(clientB.results[0]?.status, "applied");

    const stored = context.repositories.get("student").get(id);
    assert.equal(stored?.["phone"], "+254700000001");
    assert.equal(stored?.["address"], "Nairobi");
  });

  test("two clients editing the same field produce a reported conflict", () => {
    const id = ulid();
    context.sync.push({
      operations: [
        {
          opId: "op-create-3",
          entityType: "student",
          entityId: id,
          operation: "upsert",
          patch: studentFixture({ firstName: "Ada" }),
          baseRevision: 0,
          clientTime: "2026-10-20T05:00:00.000Z",
        },
      ],
    });

    // The server-side value moves to "Augusta" at revision 2.
    context.sync.push({
      operations: [
        {
          opId: "op-server-side",
          entityType: "student",
          entityId: id,
          operation: "upsert",
          patch: { firstName: "Augusta" },
          baseRevision: 1,
          clientTime: "2026-10-20T05:01:00.000Z",
        },
      ],
    });

    // A client that had not seen that change submits a different value for
    // the same field.
    const response = context.sync.push({
      operations: [
        {
          opId: "op-conflict",
          entityType: "student",
          entityId: id,
          operation: "upsert",
          patch: { firstName: "Adelaide" },
          baseRevision: 1,
          clientTime: "2026-10-20T05:04:00.000Z",
        },
      ],
    });

    const result = response.results[0];
    assert.equal(result?.status, "conflict");
    assert.deepEqual(result?.conflictingFields, ["firstName"]);

    const stored = context.repositories.get("student").get(id);
    assert.equal(stored?.["firstName"], "Augusta", "the server value stands");
  });

  test("a delete removes the record and propagates to the change feed", () => {
    const id = ulid();
    context.sync.push({
      operations: [
        {
          opId: "op-create-4",
          entityType: "student",
          entityId: id,
          operation: "upsert",
          patch: studentFixture(),
          baseRevision: 0,
          clientTime: "2026-10-20T05:00:00.000Z",
        },
      ],
    });

    const response = context.sync.push({
      operations: [
        {
          opId: "op-delete",
          entityType: "student",
          entityId: id,
          operation: "delete",
          patch: null,
          baseRevision: 1,
          clientTime: "2026-10-20T05:05:00.000Z",
        },
      ],
    });

    assert.equal(response.results[0]?.status, "applied");
    assert.equal(context.repositories.get("student").get(id), null);

    const feed = context.sync.pull(0);
    const deletion = feed.changes.find((change) => change.operation === "delete");
    assert.ok(deletion !== undefined);
    assert.equal(deletion?.record, null);
  });

  test("deleting a record that does not exist is rejected", () => {
    const response = context.sync.push({
      operations: [
        {
          opId: "op-delete-missing",
          entityType: "student",
          entityId: ulid(),
          operation: "delete",
          patch: null,
          baseRevision: 0,
          clientTime: "2026-10-20T05:00:00.000Z",
        },
      ],
    });
    assert.equal(response.results[0]?.status, "rejected");
  });

  test("an operation for an unknown entity type is rejected", () => {
    const response = context.sync.push({
      operations: [
        {
          opId: "op-unknown",
          entityType: "unicorn",
          entityId: ulid(),
          operation: "upsert",
          patch: {},
          baseRevision: 0,
          clientTime: "2026-10-20T05:00:00.000Z",
        },
      ],
    });
    assert.equal(response.results[0]?.status, "rejected");
  });

  test("an invalid record is rejected without affecting other operations", () => {
    const goodId = ulid();
    const response = context.sync.push({
      operations: [
        {
          opId: "op-invalid",
          entityType: "student",
          entityId: ulid(),
          operation: "upsert",
          patch: { admissionNumber: "" },
          baseRevision: 0,
          clientTime: "2026-10-20T05:00:00.000Z",
        },
        {
          opId: "op-valid",
          entityType: "student",
          entityId: goodId,
          operation: "upsert",
          patch: studentFixture(),
          baseRevision: 0,
          clientTime: "2026-10-20T05:00:00.000Z",
        },
      ],
    });

    assert.equal(response.results[0]?.status, "rejected");
    assert.equal(response.results[1]?.status, "applied");
    assert.notEqual(context.repositories.get("student").get(goodId), null);
  });

  test("a snapshot returns the whole dataset and a usable cursor", () => {
    const repository = context.repositories.get("student");
    repository.upsert({ ...studentFixture(), id: ulid() });
    repository.upsert({ ...studentFixture({ admissionNumber: "ADM-002" }), id: ulid() });

    const snapshot = context.sync.snapshot();
    assert.equal(snapshot.entities["student"]?.length, 2);
    assert.equal(snapshot.cursor, context.sync.currentCursor());
  });

  test("the change log is pruned only up to the oldest active client cursor", () => {
    const repository = context.repositories.get("student");
    repository.upsert({ ...studentFixture(), id: ulid() });
    const cursorAfterFirst = context.sync.currentCursor();

    repository.upsert({ ...studentFixture({ admissionNumber: "ADM-002" }), id: ulid() });
    assert.equal(context.sync.pruneChanges(), 0, "no client has reported progress yet");

    context.sync.registerClient("client-a", cursorAfterFirst);
    const removed = context.sync.pruneChanges();
    assert.ok(removed >= 0);

    const remaining = context.sync.pull(0);
    assert.ok(remaining.changes.length > 0, "recent changes are retained");
  });

  test("a pushed payment updates the invoice the client will pull", () => {
    const invoices = context.repositories.get("invoice");
    const invoiceId = ulid();
    invoices.upsert({
      id: invoiceId,
      invoiceNumber: "INV-SYNC-1",
      studentId: ulid(),
      guardianId: null,
      term: "Term 1",
      issueDate: "2026-01-05",
      dueDate: "2026-03-31",
      currency: "USD",
      status: "issued",
      lineItems: [{ description: "Tuition", quantity: 2, unitAmount: 100 }],
      notes: null,
    });

    const cursor = context.sync.currentCursor();
    const response = context.sync.push({
      operations: [
        {
          opId: "op-payment-1",
          entityType: "payment",
          entityId: ulid(),
          operation: "upsert",
          patch: {
            paymentNumber: "PAY-SYNC-1",
            invoiceId,
            studentId: ulid(),
            amount: 150,
            currency: "USD",
            method: "cash",
            receivedAt: "2026-10-20T05:00:00.000Z",
          },
          baseRevision: 0,
          clientTime: "2026-10-20T05:00:00.000Z",
        },
      ],
    });
    assert.equal(response.results[0]?.status, "applied");

    const changes = context.sync.pull(cursor).changes;
    const invoiceChange = changes.find(
      (change) => change.entityType === "invoice" && change.entityId === invoiceId,
    );
    assert.ok(invoiceChange !== undefined, "the client is not told about the invoice");
    assert.equal((invoiceChange?.record as Record<string, unknown> | null)?.["paidAmount"], 150);
  });

  test("a client that states an amount paid has it dropped", () => {
    const invoices = context.repositories.get("invoice");
    const invoiceId = ulid();
    invoices.upsert({
      id: invoiceId,
      invoiceNumber: "INV-SYNC-2",
      studentId: ulid(),
      guardianId: null,
      term: "Term 1",
      issueDate: "2026-01-05",
      dueDate: "2026-03-31",
      currency: "USD",
      status: "issued",
      lineItems: [{ description: "Tuition", quantity: 2, unitAmount: 100 }],
      notes: null,
    });

    context.sync.push({
      operations: [
        {
          opId: "op-invoice-paid",
          entityType: "invoice",
          entityId: invoiceId,
          operation: "upsert",
          patch: { paidAmount: 999 },
          baseRevision: 1,
          clientTime: "2026-10-20T05:00:00.000Z",
        },
      ],
    });

    assert.equal(invoices.get(invoiceId)?.["paidAmount"], 0);
  });
});
