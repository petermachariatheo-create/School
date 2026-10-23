import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { deriveInvoiceStatus, registry, ulid } from "../src/index.ts";

/**
 * The invoice's status.
 *
 * A status is two things at once: a decision somebody made, and a
 * consequence of the money received and the date. These tests are about
 * where the line between the two falls.
 */

function invoice(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: ulid(),
    revision: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    deletedAt: null,
    invoiceNumber: "INV-1",
    studentId: ulid(),
    guardianId: null,
    term: "Term 1",
    issueDate: "2026-01-01",
    dueDate: "2026-03-31",
    currency: "USD",
    status: "issued",
    lineItems: [{ description: "Tuition", quantity: 1, unitAmount: 25_000, accountCode: null }],
    totalAmount: 25_000,
    paidAmount: 0,
    notes: null,
    ...overrides,
  };
}

/** The status the server works out for a record on a given day. */
function statusOf(record: Record<string, unknown>, today: string): unknown {
  const result = registry.validate("invoice", record, { today });
  assert.equal(result.ok, true);
  return result.ok ? result.value["status"] : undefined;
}

describe("a decision the school makes", () => {
  test("a draft stays a draft, whatever the money and the date say", () => {
    assert.equal(
      statusOf(
        invoice({ status: "draft", dueDate: "2026-01-02", paidAmount: 25_000 }),
        "2026-06-01",
      ),
      "draft",
    );
  });

  test("a void invoice stays void, whatever the money and the date say", () => {
    assert.equal(
      statusOf(
        invoice({ status: "void", dueDate: "2026-01-02", paidAmount: 25_000 }),
        "2026-06-01",
      ),
      "void",
    );
  });

  test("the school chooses between a draft, an issued invoice and a void one", () => {
    const refined = registry.refinedFields("invoice");
    assert.equal(refined.length, 1);
    assert.equal(refined[0]?.field, "status");
    assert.deepEqual(refined[0]?.choices, ["draft", "issued", "void"]);
  });

  test("a client may still state the status", () => {
    const shape = Object.keys(registry.createSchema("invoice").shape);
    assert.equal(shape.includes("status"), true);
  });
});

describe("a consequence of the money and the date", () => {
  test("an invoice that is not yet due is issued", () => {
    assert.equal(statusOf(invoice({ dueDate: "2026-03-31" }), "2026-03-15"), "issued");
  });

  test("an invoice past its due date is overdue", () => {
    assert.equal(statusOf(invoice({ dueDate: "2026-03-31" }), "2026-04-01"), "overdue");
  });

  test("an invoice falls due on the day it is overdue, not the day before", () => {
    assert.equal(statusOf(invoice({ dueDate: "2026-03-31" }), "2026-03-31"), "issued");
  });

  test("an invoice with some of the money is partially paid", () => {
    assert.equal(
      statusOf(invoice({ paidAmount: 10_000, dueDate: "2026-01-02" }), "2026-06-01"),
      "partially_paid",
    );
  });

  test("an invoice with all of the money is paid", () => {
    assert.equal(
      statusOf(invoice({ paidAmount: 25_000, dueDate: "2026-01-02" }), "2026-06-01"),
      "paid",
    );
  });

  test("money received is worth more than the date", () => {
    assert.equal(
      statusOf(invoice({ paidAmount: 25_000, dueDate: "2026-01-02" }), "2026-06-01"),
      "paid",
    );
  });

  test("the same record is overdue on one day and issued on the next", () => {
    const record = invoice({ dueDate: "2026-03-31" });
    assert.equal(statusOf(record, "2026-03-31"), "issued");
    assert.equal(statusOf(record, "2026-04-01"), "overdue");
  });
});

describe("what a client is allowed to say", () => {
  test("a client cannot state that an invoice has been paid for", () => {
    assert.equal(statusOf(invoice({ status: "paid", paidAmount: 0 }), "2026-03-15"), "issued");
  });

  test("a client cannot state that an invoice is overdue", () => {
    assert.equal(statusOf(invoice({ status: "overdue", paidAmount: 0 }), "2026-03-15"), "issued");
  });

  test("a client cannot state that an invoice has been paid for in part", () => {
    assert.equal(
      statusOf(invoice({ status: "partially_paid", paidAmount: 0 }), "2026-03-15"),
      "issued",
    );
  });

  test("a client may state that an invoice is a draft", () => {
    assert.equal(statusOf(invoice({ status: "draft" }), "2026-03-15"), "draft");
  });
});

describe("a status the server has already worked out", () => {
  test("is worked out again, so that the money arriving is noticed", () => {
    assert.equal(
      statusOf(invoice({ status: "partially_paid", paidAmount: 25_000 }), "2026-03-15"),
      "paid",
    );
  });

  test("is worked out again, so that a refund is noticed", () => {
    assert.equal(
      statusOf(invoice({ status: "paid", paidAmount: 0, dueDate: "2026-01-02" }), "2026-06-01"),
      "overdue",
    );
  });
});

describe("the rule the registry and the domain share", () => {
  test("the rule is the same one the domain publishes", () => {
    assert.equal(
      deriveInvoiceStatus(
        { status: "issued", totalAmount: 25_000, paidAmount: 0, dueDate: "2026-03-31" },
        "2026-04-01",
      ),
      "overdue",
    );
  });
});
