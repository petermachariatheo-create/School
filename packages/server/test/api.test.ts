import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { createRouter } from "../src/http/routes.ts";
import { dispatch } from "../src/http/router.ts";
import { createTestContext, type TestContext } from "./helpers.ts";

/**
 * End-to-end tests over real HTTP.
 *
 * These exercise the parts a unit test cannot: status codes, content
 * types, header handling, query parsing and the error format that clients
 * depend on.
 */

let context: TestContext;
let server: http.Server;
let baseUrl: string;
let port: number;

before(async () => {
  context = createTestContext();
  const listener = http.createServer();
  listener.listen(0, "127.0.0.1");
  await once(listener, "listening");
  const address = listener.address() as AddressInfo;
  server = listener;
  port = address.port;

  const router = createRouter({
    db: context.db,
    repositories: context.repositories,
    sync: context.sync,
    serverUrl: "http://localhost",
    sqliteVersion: "test",
    nodeVersion: process.version,
    network: { port: address.port, securePort: null },
  });
  server.on("request", (req, res) => {
    void dispatch(router, req, res);
  });
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  server.close();
  await once(server, "close");
  context.cleanup();
});

describe("HTTP API", () => {
  test("reports health", async () => {
    const response = await fetch(`${baseUrl}/api/v1/health`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /application\/json/);

    const body = (await response.json()) as { status: string; contractVersion: string };
    assert.equal(body.status, "ok");
    assert.equal(body.contractVersion, "1.0.0");
  });

  test("lists the entity catalogue", async () => {
    const response = await fetch(`${baseUrl}/api/v1/meta`);
    const body = (await response.json()) as { entityTypes: { type: string }[] };
    assert.ok(body.entityTypes.some((entity) => entity.type === "student"));
  });

  test("reports the addresses another device can use", async () => {
    const response = await fetch(`${baseUrl}/api/v1/meta`);
    const body = (await response.json()) as {
      network: {
        port: number;
        addresses: { address: string; interface: string; private: boolean }[];
      };
    };

    assert.equal(body.network.port, port);
    for (const entry of body.network.addresses) {
      assert.match(entry.address, /^(?:\d{1,3}\.){3}\d{1,3}$/);
      assert.notEqual(entry.address, "127.0.0.1");
    }
  });

  test("publishes an OpenAPI document describing every entity route", async () => {
    const response = await fetch(`${baseUrl}/api/v1/openapi.json`);
    assert.equal(response.status, 200);

    const document = (await response.json()) as {
      openapi: string;
      paths: Record<string, Record<string, unknown>>;
      components: { schemas: Record<string, unknown> };
    };
    assert.equal(document.openapi, "3.1.0");
    assert.ok(document.paths["/api/v1/students"]?.["get"] !== undefined);
    assert.ok(document.paths["/api/v1/students/{id}"]?.["patch"] !== undefined);
    assert.ok(document.components.schemas["Student"] !== undefined);
  });

  test("creates, reads, updates and deletes a student", async () => {
    const create = await fetch(`${baseUrl}/api/v1/students`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ admissionNumber: "ADM-HTTP", firstName: "Ada", lastName: "Lovelace" }),
    });
    assert.equal(create.status, 201);
    const created = (await create.json()) as { id: string; revision: number };
    assert.equal(created.revision, 1);

    const read = await fetch(`${baseUrl}/api/v1/students/${created.id}`);
    assert.equal(read.status, 200);
    const fetched = (await read.json()) as { firstName: string };
    assert.equal(fetched.firstName, "Ada");

    const update = await fetch(`${baseUrl}/api/v1/students/${created.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ firstName: "Augusta" }),
    });
    assert.equal(update.status, 200);
    const updated = (await update.json()) as { firstName: string; revision: number };
    assert.equal(updated.firstName, "Augusta");
    assert.equal(updated.revision, 2);

    const remove = await fetch(`${baseUrl}/api/v1/students/${created.id}`, { method: "DELETE" });
    assert.equal(remove.status, 200);

    const gone = await fetch(`${baseUrl}/api/v1/students/${created.id}`);
    assert.equal(gone.status, 404);
  });

  test("reports a validation failure as problem details", async () => {
    const response = await fetch(`${baseUrl}/api/v1/students`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ admissionNumber: "", firstName: "Ada" }),
    });

    assert.equal(response.status, 422);
    assert.match(response.headers.get("content-type") ?? "", /application\/problem\+json/);

    const problem = (await response.json()) as { type: string; status: number; errors?: unknown[] };
    assert.match(problem.type, /validation_failed$/);
    assert.equal(problem.status, 422);
    assert.ok((problem.errors?.length ?? 0) > 0);
  });

  test("rejects a malformed JSON body", async () => {
    const response = await fetch(`${baseUrl}/api/v1/students`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not json",
    });
    assert.equal(response.status, 400);
  });

  test("works out an invoice total rather than taking the client's word for it", async () => {
    const create = await fetch(`${baseUrl}/api/v1/invoices`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        invoiceNumber: "INV-HTTP",
        studentId: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
        term: "Term 1",
        issueDate: "2026-01-05",
        dueDate: "2026-03-31",
        currency: "USD",
        lineItems: [{ description: "Tuition", quantity: 2, unitAmount: 100 }],
        totalAmount: 999,
      }),
    });

    assert.equal(create.status, 201);
    const invoice = (await create.json()) as { id: string; totalAmount: number };
    assert.equal(invoice.totalAmount, 200);

    const read = await fetch(`${baseUrl}/api/v1/invoices/${invoice.id}`);
    const stored = (await read.json()) as { totalAmount: number };
    assert.equal(stored.totalAmount, 200);
  });

  test("works out the total again when the line items change", async () => {
    const create = await fetch(`${baseUrl}/api/v1/invoices`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        invoiceNumber: "INV-HTTP-2",
        studentId: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
        term: "Term 1",
        issueDate: "2026-01-05",
        dueDate: "2026-03-31",
        lineItems: [{ description: "Tuition", quantity: 1, unitAmount: 100 }],
      }),
    });
    const created = (await create.json()) as { id: string; totalAmount: number };
    assert.equal(created.totalAmount, 100);

    const update = await fetch(`${baseUrl}/api/v1/invoices/${created.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        lineItems: [{ description: "Tuition", quantity: 3, unitAmount: 100 }],
        totalAmount: 1,
      }),
    });
    assert.equal(update.status, 200);
    const updated = (await update.json()) as { totalAmount: number };
    assert.equal(updated.totalAmount, 300);
  });

  test("ignores a total a client states in a sync push", async () => {
    const push = await fetch(`${baseUrl}/api/v1/sync/push`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        operations: [
          {
            opId: "http-op-invoice",
            entityType: "invoice",
            entityId: "01ARZ3NDEKTSV4RRFFQ69G5FBV",
            operation: "upsert",
            patch: {
              invoiceNumber: "INV-SYNC",
              studentId: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
              term: "Term 1",
              issueDate: "2026-01-05",
              dueDate: "2026-03-31",
              lineItems: [{ description: "Tuition", quantity: 2, unitAmount: 250 }],
              totalAmount: 1,
            },
            baseRevision: 0,
            clientTime: "2026-10-20T05:00:00.000Z",
          },
        ],
      }),
    });
    assert.equal(push.status, 200);
    const pushBody = (await push.json()) as { results: { status: string }[] };
    assert.equal(pushBody.results[0]?.status, "applied");

    const read = await fetch(`${baseUrl}/api/v1/invoices/01ARZ3NDEKTSV4RRFFQ69G5FBV`);
    const stored = (await read.json()) as { totalAmount: number };
    assert.equal(stored.totalAmount, 500);
  });

  test("a payment adds to the amount paid on its invoice", async () => {
    const create = await fetch(`${baseUrl}/api/v1/invoices`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        invoiceNumber: "INV-HTTP-3",
        studentId: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
        term: "Term 1",
        issueDate: "2026-01-05",
        dueDate: "2026-03-31",
        currency: "USD",
        lineItems: [{ description: "Tuition", quantity: 2, unitAmount: 100 }],
      }),
    });
    const invoice = (await create.json()) as { id: string; paidAmount: number };
    assert.equal(invoice.paidAmount, 0);

    const payment = await fetch(`${baseUrl}/api/v1/payments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        paymentNumber: "PAY-HTTP-1",
        invoiceId: invoice.id,
        studentId: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
        amount: 150,
        currency: "USD",
        method: "cash",
        receivedAt: "2026-01-10T09:00:00.000Z",
      }),
    });
    assert.equal(payment.status, 201);

    const read = await fetch(`${baseUrl}/api/v1/invoices/${invoice.id}`);
    const stored = (await read.json()) as { paidAmount: number };
    assert.equal(stored.paidAmount, 150);
  });

  test("returns 404 for an unknown route", async () => {
    const response = await fetch(`${baseUrl}/api/v1/nonexistent`);
    assert.equal(response.status, 404);
  });

  test("exports students as CSV", async () => {
    await fetch(`${baseUrl}/api/v1/students`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ admissionNumber: "ADM-CSV", firstName: "Grace", lastName: "Hopper" }),
    });

    const response = await fetch(`${baseUrl}/api/v1/students/export.csv`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /text\/csv/);

    const body = await response.text();
    assert.match(body, /admissionNumber/);
    assert.match(body, /ADM-CSV/);
  });

  test("previews and applies a CSV import", async () => {
    const csv = ["admissionNumber,firstName,lastName", "ADM-IMP,Alan,Turing"].join("\n");

    const preview = await fetch(`${baseUrl}/api/v1/students/import`, {
      method: "POST",
      headers: { "content-type": "text/csv" },
      body: csv,
    });
    assert.equal(preview.status, 200);
    const previewBody = (await preview.json()) as {
      applied: boolean;
      preview: { validRows: number };
    };
    assert.equal(previewBody.applied, false);
    assert.equal(previewBody.preview.validRows, 1);

    const applied = await fetch(`${baseUrl}/api/v1/students/import?apply=true`, {
      method: "POST",
      headers: { "content-type": "text/csv" },
      body: csv,
    });
    const appliedBody = (await applied.json()) as {
      applied: boolean;
      outcome: { applied: number };
    };
    assert.equal(appliedBody.applied, true);
    assert.equal(appliedBody.outcome.applied, 1);
  });

  test("synchronises changes to a client", async () => {
    const pull = await fetch(`${baseUrl}/api/v1/sync/changes?since=0&limit=10`);
    assert.equal(pull.status, 200);
    const pullBody = (await pull.json()) as { changes: unknown[]; cursor: number };
    assert.ok(pullBody.changes.length > 0);

    const push = await fetch(`${baseUrl}/api/v1/sync/push`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        operations: [
          {
            opId: "http-op-1",
            entityType: "student",
            entityId: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
            operation: "upsert",
            patch: { admissionNumber: "ADM-SYNC", firstName: "Sync", lastName: "Student" },
            baseRevision: 0,
            clientTime: "2026-10-20T05:00:00.000Z",
          },
        ],
      }),
    });
    assert.equal(push.status, 200);
    const pushBody = (await push.json()) as { results: { status: string }[] };
    assert.equal(pushBody.results[0]?.status, "applied");
  });

  test("returns a snapshot for a new client", async () => {
    const response = await fetch(`${baseUrl}/api/v1/sync/snapshot`);
    assert.equal(response.status, 200);
    const body = (await response.json()) as { entities: Record<string, unknown[]>; cursor: number };
    assert.ok(Array.isArray(body.entities["student"]));
    assert.ok(body.cursor > 0);
  });
});
