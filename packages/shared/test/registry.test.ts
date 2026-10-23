import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { registry, ulid } from "../src/index.ts";

const invoice = {
  id: ulid(),
  revision: 1,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  deletedAt: null,
  invoiceNumber: "INV-9",
  studentId: ulid(),
  guardianId: null,
  term: "Term 1",
  issueDate: "2026-01-01",
  dueDate: "2026-03-31",
  currency: "USD",
  status: "draft",
  lineItems: [{ description: "Tuition", quantity: 2, unitAmount: 100, accountCode: null }],
  totalAmount: 999,
  paidAmount: 0,
  notes: null,
};

describe("entity registry", () => {
  test("exposes every registered entity type", () => {
    const types = registry.types();
    assert.ok(types.includes("student"));
    assert.ok(types.includes("invoice"));
    assert.ok(types.includes("payment"));
  });

  test("generates a JSON Schema with the expected shape", () => {
    const schema = registry.jsonSchema("student") as {
      type?: string;
      properties?: Record<string, unknown>;
      required?: string[];
    };
    assert.equal(schema.type, "object");
    assert.ok(schema.properties !== undefined);
    assert.ok("admissionNumber" in schema.properties);
    assert.ok(schema.required?.includes("admissionNumber"));
  });

  test("derives CSV columns from the schema and omits internal fields", () => {
    const columns = registry.csvColumns("student");
    assert.ok(columns.includes("admissionNumber"));
    assert.ok(columns.includes("firstName"));
    assert.ok(!columns.includes("revision"), "revision is internal bookkeeping");
    assert.ok(!columns.includes("deletedAt"), "deletedAt is internal bookkeeping");
  });

  test("rejects an invalid record with a readable problem list", () => {
    const result = registry.validate("student", { admissionNumber: "" }, { today: "2026-03-15" });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(result.problems.length > 0);
      assert.ok(result.problems.some((problem) => problem.includes("admissionNumber")));
    }
  });

  test("works out the invoice total from its line items", () => {
    const result = registry.validate("invoice", invoice, { today: "2026-03-15" });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.value["totalAmount"], 200);
    }
  });

  test("works out the total even when the client states a different one", () => {
    const result = registry.validate(
      "invoice",
      { ...invoice, totalAmount: 999 },
      { today: "2026-03-15" },
    );
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.value["totalAmount"], 200);
    }
  });

  test("reports a file whose total disagrees with its line items", () => {
    const problems = registry.checkInvariants("invoice", invoice);
    assert.equal(problems.length, 1);
    assert.ok(problems[0]?.includes("totalAmount"));
  });

  test("accepts an invoice whose total agrees with its line items", () => {
    const problems = registry.checkInvariants("invoice", { ...invoice, totalAmount: 200 });
    assert.deepEqual(problems, []);
  });

  test("does not ask a client to state a field the server works out", () => {
    const shape = Object.keys(registry.createSchema("invoice").shape);
    assert.equal(shape.includes("totalAmount"), false);
    assert.equal(shape.includes("lineItems"), true);
  });

  test("accepts a consistent invoice", () => {
    const result = registry.validate(
      "invoice",
      {
        id: ulid(),
        revision: 1,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        deletedAt: null,
        invoiceNumber: "INV-10",
        studentId: ulid(),
        guardianId: null,
        term: "Term 1",
        issueDate: "2026-01-01",
        dueDate: "2026-03-31",
        currency: "USD",
        status: "draft",
        lineItems: [{ description: "Tuition", quantity: 2, unitAmount: 100, accountCode: null }],
        totalAmount: 200,
        paidAmount: 0,
        notes: null,
      },
      { today: "2026-03-15" },
    );
    assert.equal(result.ok, true);
  });

  test("builds a create schema that leaves the identifier optional", () => {
    const schema = registry.createSchema("student");
    const result = schema.safeParse({
      admissionNumber: "ADM-3",
      firstName: "Grace",
      lastName: "Hopper",
    });
    assert.equal(result.success, true);
  });

  test("builds a patch schema in which every field is optional", () => {
    const schema = registry.patchSchema("student");
    const result = schema.safeParse({ firstName: "Grace" });
    assert.equal(result.success, true);
  });

  test("ignores server-owned fields in a patch rather than rejecting them", () => {
    const schema = registry.patchSchema("student");
    const result = schema.safeParse({
      firstName: "Grace",
      revision: 99,
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    assert.equal(result.success, true);
    assert.equal(result.success && result.data["revision"], undefined);
    assert.equal(result.success && result.data["createdAt"], undefined);
  });
});

describe("the totals the server keeps", () => {
  test("an invoice's amount paid is a total of its payments", () => {
    const aggregates = registry.aggregateFields("invoice");
    assert.equal(aggregates.length, 1);
    const aggregate = aggregates[0];
    assert.equal(aggregate?.field, "paidAmount");
    assert.equal(aggregate?.source, "payment");
    assert.equal(aggregate?.via, "invoiceId");
    assert.equal(aggregate?.sumOf, "amount");
  });

  test("a total is not a field a client may state", () => {
    const owned = registry.serverOwnedFields("invoice");
    assert.ok(owned.includes("paidAmount"));
    assert.ok(owned.includes("totalAmount"));
  });

  test("a client is not asked for a total", () => {
    const create = Object.keys(registry.createSchema("invoice").shape);
    const patch = Object.keys(registry.patchSchema("invoice").shape);
    assert.equal(create.includes("paidAmount"), false);
    assert.equal(patch.includes("paidAmount"), false);
    assert.equal(create.includes("totalAmount"), false);
  });

  test("a client that states a total anyway has it dropped", () => {
    const result = registry.createSchema("invoice").safeParse({
      invoiceNumber: "INV-4",
      studentId: ulid(),
      term: "Term 1",
      issueDate: "2026-01-05",
      dueDate: "2026-03-31",
      lineItems: [{ description: "Tuition", quantity: 1, unitAmount: 100 }],
      paidAmount: 999,
    });
    assert.equal(result.success, true);
    assert.equal(result.success && result.data["paidAmount"], undefined);
  });

  test("a record with no totals has none", () => {
    assert.deepEqual(registry.aggregateFields("student"), []);
  });
});

describe("the values the server decides", () => {
  test("an invoice's status is one of them", () => {
    const refined = registry.refinedFields("invoice");
    assert.equal(refined.length, 1);
    assert.equal(refined[0]?.field, "status");
  });

  test("a record with no decided values has none", () => {
    assert.deepEqual(registry.refinedFields("student"), []);
  });

  test("a client may state a value the server decides, and the server overrules it", () => {
    const result = registry.validate(
      "invoice",
      { ...invoice, status: "paid" },
      { today: "2026-03-15" },
    );
    assert.equal(result.ok, true);
    if (result.ok) {
      // The invoice has not been paid for, so it is not paid.
      assert.equal(result.value["status"], "issued");
    }
  });
});
