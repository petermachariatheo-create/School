import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { ulid } from "@school/shared";
import { createTestContext, studentFixture, type TestContext } from "./helpers.ts";
import { exportCsv, exportJson, exportNdjson } from "../src/interop/exporters.ts";
import { applyImport, previewImport } from "../src/interop/importers.ts";

describe("CSV export", () => {
  let context: TestContext;

  beforeEach(() => {
    context = createTestContext();
  });

  afterEach(() => {
    context.cleanup();
  });

  test("writes a header row derived from the entity schema", () => {
    const repository = context.repositories.get("student");
    repository.upsert({ ...studentFixture(), id: ulid() });

    const csv = exportCsv(repository);
    const [header] = csv.split("\r\n");
    assert.ok(header?.includes("admissionNumber"));
    assert.ok(header?.includes("firstName"));
    assert.ok(!header?.includes("revision"));
  });

  test("round-trips records through export and import", () => {
    const repository = context.repositories.get("student");
    repository.upsert({ ...studentFixture({ admissionNumber: "ADM-100" }), id: ulid() });

    const csv = exportCsv(repository);
    const target = context.repositories.get("class");
    void target;

    // Import into a clean database so the rows are new rather than
    // duplicates of the ones that were exported.
    const fresh = createTestContext();
    try {
      const preview = previewImport(fresh.repositories.get("student"), csv);
      assert.equal(preview.invalidRows, 0);
      assert.equal(preview.validRows, 1);

      const outcome = applyImport(fresh.repositories.get("student"), preview);
      assert.equal(outcome.applied, 1);

      const stored = fresh.repositories.get("student").list().items[0];
      assert.equal(stored?.["admissionNumber"], "ADM-100");
      assert.equal(stored?.["firstName"], "Ada");
    } finally {
      fresh.cleanup();
    }
  });

  test("exports JSON with a self-describing envelope", () => {
    const repository = context.repositories.get("student");
    repository.upsert({ ...studentFixture(), id: ulid() });

    const envelope = exportJson(repository);
    assert.equal(envelope.entityType, "student");
    assert.equal(envelope.items.length, 1);
    assert.ok(envelope.exportedAt);
  });

  test("exports NDJSON with one record per line", () => {
    const repository = context.repositories.get("student");
    repository.upsert({ ...studentFixture(), id: ulid() });
    repository.upsert({ ...studentFixture({ admissionNumber: "ADM-002" }), id: ulid() });

    const ndjson = exportNdjson(repository);
    const lines = ndjson.trim().split("\n");
    assert.equal(lines.length, 2);
    for (const line of lines) {
      assert.doesNotThrow(() => JSON.parse(line));
    }
  });
});

describe("CSV import", () => {
  let context: TestContext;

  beforeEach(() => {
    context = createTestContext();
  });

  afterEach(() => {
    context.cleanup();
  });

  test("reports row-level problems without aborting the file", () => {
    const csv = [
      "admissionNumber,firstName,lastName",
      "ADM-1,Ada,Lovelace",
      ",Missing,Admission",
      "ADM-3,Grace,Hopper",
    ].join("\n");

    const preview = previewImport(context.repositories.get("student"), csv);
    assert.equal(preview.totalRows, 3);
    assert.equal(preview.validRows, 2);
    assert.equal(preview.invalidRows, 1);
    assert.equal(preview.rows[1]?.status, "invalid");
    assert.ok((preview.rows[1]?.problems.length ?? 0) > 0);
  });

  test("detects rows that duplicate an existing record", () => {
    const repository = context.repositories.get("student");
    repository.upsert({ ...studentFixture({ admissionNumber: "ADM-1" }), id: ulid() });

    const csv = "admissionNumber,firstName,lastName\nADM-1,Ada,Lovelace\n";
    const preview = previewImport(repository, csv);

    assert.equal(preview.duplicateRows, 1);
    assert.equal(preview.rows[0]?.status, "duplicate");
    assert.notEqual(preview.rows[0]?.duplicateOf, null);
  });

  test("skips duplicates unless updating is requested", () => {
    const repository = context.repositories.get("student");
    const id = ulid();
    repository.upsert({ ...studentFixture({ admissionNumber: "ADM-1" }), id });

    const csv = "admissionNumber,firstName,lastName\nADM-1,Augusta,Lovelace\n";
    const preview = previewImport(repository, csv);

    const skipped = applyImport(repository, preview);
    assert.equal(skipped.applied, 0);
    assert.equal(skipped.skipped, 1);
    assert.equal(repository.get(id)?.["firstName"], "Ada");

    const updated = applyImport(repository, preview, { updateExisting: true });
    assert.equal(updated.updated, 1);
    assert.equal(repository.get(id)?.["firstName"], "Augusta");
  });

  test("ignores unknown columns rather than failing", () => {
    const csv = "admissionNumber,firstName,lastName,unknownColumn\nADM-1,Ada,Lovelace,x\n";
    const preview = previewImport(context.repositories.get("student"), csv);

    assert.equal(preview.invalidRows, 0);
    assert.equal(preview.validRows, 1);
    assert.ok(preview.problems.some((problem) => problem.message.includes("unknown")));
  });

  test("coerces numbers and booleans from their text form", () => {
    const csv = [
      "studentId,classId,date,status,note",
      `${ulid()},${ulid()},2026-10-20,present,ok`,
    ].join("\n");

    const preview = previewImport(context.repositories.get("attendance"), csv);
    assert.equal(preview.invalidRows, 0);
    assert.equal(preview.validRows, 1);
  });

  test("rejects a value of the wrong type", () => {
    const csv = ["studentId,classId,date,status", `${ulid()},${ulid()},not-a-date,present`].join(
      "\n",
    );
    const preview = previewImport(context.repositories.get("attendance"), csv);
    assert.equal(preview.invalidRows, 1);
    assert.ok((preview.rows[0]?.problems.join(" ") ?? "").includes("date"));
  });

  test("coerces a nullable number to a number, not to a string", () => {
    // A nullable field is published as `anyOf: [{ type: "number" }, { type:
    // "null" }]`. The coercion has to look inside that branch, or the score
    // would arrive as the text "85" and fail validation.
    const assessmentId = ulid();
    const csv = ["assessmentId,studentId,score,grade", `${assessmentId},${ulid()},85,A1`].join(
      "\n",
    );

    const preview = previewImport(context.repositories.get("assessment_result"), csv);
    assert.equal(preview.invalidRows, 0, preview.rows[0]?.problems.join("; "));
    assert.equal(preview.validRows, 1);
    assert.equal(preview.rows[0]?.record?.["score"], 85);
  });

  test("treats an empty cell in a nullable field as null", () => {
    const csv = ["assessmentId,studentId,score,grade", `${ulid()},${ulid()},,A1`].join("\n");

    const preview = previewImport(context.repositories.get("assessment_result"), csv);
    assert.equal(preview.invalidRows, 0, preview.rows[0]?.problems.join("; "));
    assert.equal(preview.validRows, 1);
    assert.equal(preview.rows[0]?.record?.["score"], null);
  });

  test("treats an empty cell in a field with a default as absent", () => {
    const csv = ["admissionNumber,firstName,lastName,gender", "ADM-X,Ada,Lovelace,"].join("\n");

    const preview = previewImport(context.repositories.get("student"), csv);
    assert.equal(preview.invalidRows, 0, preview.rows[0]?.problems.join("; "));
    assert.equal(preview.validRows, 1);
    assert.equal(preview.rows[0]?.record?.["gender"], "undisclosed");
  });

  test("reports a file whose total disagrees with its line items", () => {
    // The server works the total out for itself, so a file that states a
    // different one holds a mistake: the person who made it is told rather
    // than having it quietly corrected.
    const csv = [
      "invoiceNumber,studentId,term,issueDate,dueDate,lineItems,totalAmount",
      `INV-1,${ulid()},Term 1,2026-01-05,2026-03-31,"[{""description"":""Tuition"",""quantity"":2,""unitAmount"":100}]",999`,
    ].join("\n");

    const preview = previewImport(context.repositories.get("invoice"), csv);
    assert.equal(preview.invalidRows, 1);
    assert.ok((preview.rows[0]?.problems.join(" ") ?? "").includes("totalAmount"));
  });

  test("accepts a file whose total agrees with its line items", () => {
    const csv = [
      "invoiceNumber,studentId,term,issueDate,dueDate,lineItems,totalAmount",
      `INV-2,${ulid()},Term 1,2026-01-05,2026-03-31,"[{""description"":""Tuition"",""quantity"":2,""unitAmount"":100}]",200`,
    ].join("\n");

    const preview = previewImport(context.repositories.get("invoice"), csv);
    assert.equal(preview.invalidRows, 0, preview.rows[0]?.problems.join("; "));
    assert.equal(preview.validRows, 1);
  });

  test("works the total out for a file that does not state one", () => {
    const csv = [
      "invoiceNumber,studentId,term,issueDate,dueDate,lineItems",
      `INV-3,${ulid()},Term 1,2026-01-05,2026-03-31,"[{""description"":""Tuition"",""quantity"":2,""unitAmount"":100}]"`,
    ].join("\n");

    const repository = context.repositories.get("invoice");
    const preview = previewImport(repository, csv);
    assert.equal(preview.invalidRows, 0, preview.rows[0]?.problems.join("; "));

    const outcome = applyImport(repository, preview);
    assert.equal(outcome.applied, 1);
    assert.equal(repository.list().items[0]?.["totalAmount"], 200);
  });

  test("does not take the amount paid from a file", () => {
    // The amount paid is the sum of the payments, and the server keeps it
    // up to date, so a file cannot state it.
    const csv = [
      "invoiceNumber,studentId,term,issueDate,dueDate,lineItems,paidAmount",
      `INV-4,${ulid()},Term 1,2026-01-05,2026-03-31,"[{""description"":""Tuition"",""quantity"":2,""unitAmount"":100}]",999`,
    ].join("\n");

    const repository = context.repositories.get("invoice");
    const preview = previewImport(repository, csv);
    assert.equal(preview.invalidRows, 0, preview.rows[0]?.problems.join("; "));

    const outcome = applyImport(repository, preview);
    assert.equal(outcome.applied, 1);
    assert.equal(repository.list().items[0]?.["paidAmount"], 0);
  });
});
