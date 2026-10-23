import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { ulid } from "@school/shared";
import { createTestContext, type TestContext } from "./helpers.ts";

/**
 * The totals the server keeps.
 *
 * An invoice's amount paid is the sum of the payments received against it.
 * The rule is declared in the shared registry and the server works it out,
 * so no part of the system has to know what an invoice or a payment is.
 */

interface InvoiceOverrides {
  readonly [key: string]: unknown;
}

function invoiceFixture(overrides: InvoiceOverrides = {}): Record<string, unknown> {
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

function paymentFixture(
  invoiceId: string,
  overrides: InvoiceOverrides = {},
): Record<string, unknown> {
  return {
    paymentNumber: "PAY-1",
    invoiceId,
    studentId: ulid(),
    amount: 100,
    currency: "USD",
    method: "cash",
    receivedAt: "2026-01-10T09:00:00.000Z",
    recordedBy: null,
    externalReference: null,
    notes: null,
    ...overrides,
  };
}

describe("the totals the server keeps", () => {
  let context: TestContext;

  beforeEach(() => {
    context = createTestContext();
  });

  afterEach(() => {
    context.cleanup();
  });

  test("an invoice starts with nothing paid", () => {
    const invoices = context.repositories.get("invoice");
    const { record } = invoices.upsert({ ...invoiceFixture(), id: ulid() });

    assert.equal(record["paidAmount"], 0);
  });

  test("a payment adds to the amount paid on its invoice", () => {
    const invoices = context.repositories.get("invoice");
    const payments = context.repositories.get("payment");
    const invoiceId = ulid();
    invoices.upsert({ ...invoiceFixture(), id: invoiceId });

    payments.upsert({ ...paymentFixture(invoiceId, { amount: 150 }), id: ulid() });

    assert.equal(invoices.get(invoiceId)?.["paidAmount"], 150);
  });

  test("payments are added up", () => {
    const invoices = context.repositories.get("invoice");
    const payments = context.repositories.get("payment");
    const invoiceId = ulid();
    invoices.upsert({ ...invoiceFixture(), id: invoiceId });

    payments.upsert({ ...paymentFixture(invoiceId, { amount: 150 }), id: ulid() });
    payments.upsert({
      ...paymentFixture(invoiceId, { amount: 50, paymentNumber: "PAY-2" }),
      id: ulid(),
    });

    assert.equal(invoices.get(invoiceId)?.["paidAmount"], 200);
  });

  test("a payment against another invoice leaves this one alone", () => {
    const invoices = context.repositories.get("invoice");
    const payments = context.repositories.get("payment");
    const first = ulid();
    const second = ulid();
    invoices.upsert({ ...invoiceFixture(), id: first });
    invoices.upsert({ ...invoiceFixture({ invoiceNumber: "INV-2" }), id: second });

    payments.upsert({ ...paymentFixture(first, { amount: 150 }), id: ulid() });

    assert.equal(invoices.get(first)?.["paidAmount"], 150);
    assert.equal(invoices.get(second)?.["paidAmount"], 0);
  });

  test("deleting a payment takes the amount off the invoice", () => {
    const invoices = context.repositories.get("invoice");
    const payments = context.repositories.get("payment");
    const invoiceId = ulid();
    invoices.upsert({ ...invoiceFixture(), id: invoiceId });

    const paymentId = ulid();
    payments.upsert({ ...paymentFixture(invoiceId, { amount: 150 }), id: paymentId });
    assert.equal(invoices.get(invoiceId)?.["paidAmount"], 150);

    payments.softDelete(paymentId);
    assert.equal(invoices.get(invoiceId)?.["paidAmount"], 0);
  });

  test("a payment in another currency is not added up", () => {
    const invoices = context.repositories.get("invoice");
    const payments = context.repositories.get("payment");
    const invoiceId = ulid();
    invoices.upsert({ ...invoiceFixture({ currency: "USD" }), id: invoiceId });

    payments.upsert({ ...paymentFixture(invoiceId, { amount: 150, currency: "KES" }), id: ulid() });

    assert.equal(invoices.get(invoiceId)?.["paidAmount"], 0);
  });

  test("an invoice states its own amount paid and is told otherwise", () => {
    const invoices = context.repositories.get("invoice");
    const payments = context.repositories.get("payment");
    const invoiceId = ulid();

    invoices.upsert({ ...invoiceFixture({ paidAmount: 999 }), id: invoiceId });
    assert.equal(invoices.get(invoiceId)?.["paidAmount"], 0);

    payments.upsert({ ...paymentFixture(invoiceId, { amount: 150 }), id: ulid() });
    assert.equal(invoices.get(invoiceId)?.["paidAmount"], 150);
  });

  test("the invoice's total is still worked out from its line items", () => {
    const invoices = context.repositories.get("invoice");
    const invoiceId = ulid();
    invoices.upsert({ ...invoiceFixture({ paidAmount: 999 }), id: invoiceId });

    const stored = invoices.get(invoiceId);
    assert.equal(stored?.["totalAmount"], 200);
  });

  test("the change reaches the feed, so the clients see it", () => {
    const invoices = context.repositories.get("invoice");
    const payments = context.repositories.get("payment");
    const invoiceId = ulid();
    invoices.upsert({ ...invoiceFixture(), id: invoiceId });

    const before = context.sync.currentCursor();
    payments.upsert({ ...paymentFixture(invoiceId, { amount: 150 }), id: ulid() });

    const changes = context.sync.pull(before).changes;
    const invoiceChange = changes.find(
      (change) => change.entityType === "invoice" && change.entityId === invoiceId,
    );
    assert.ok(invoiceChange !== undefined, "the invoice was not changed in the feed");
    assert.equal((invoiceChange?.record as Record<string, unknown> | null)?.["paidAmount"], 150);
  });

  test("the invoice's revision moves on when the total moves", () => {
    const invoices = context.repositories.get("invoice");
    const payments = context.repositories.get("payment");
    const invoiceId = ulid();
    const first = invoices.upsert({ ...invoiceFixture(), id: invoiceId });

    payments.upsert({ ...paymentFixture(invoiceId, { amount: 150 }), id: ulid() });

    assert.equal(invoices.get(invoiceId)?.["revision"], Number(first.record["revision"]) + 1);
  });
});
