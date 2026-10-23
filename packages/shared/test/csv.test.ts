import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parseCsv, rowsToRecords, stringifyCsv } from "../src/interop/csv.ts";

describe("CSV codec", () => {
  test("parses a simple table", () => {
    const result = parseCsv("name,age\nAda,36\nGrace,45\n");
    assert.deepEqual(result.header, ["name", "age"]);
    assert.deepEqual(result.rows, [
      ["Ada", "36"],
      ["Grace", "45"],
    ]);
    assert.equal(result.errors.length, 0);
  });

  test("handles quoted fields containing the delimiter", () => {
    const result = parseCsv('name,address\n"Doe, Jane","1 Main St"');
    assert.deepEqual(result.rows, [["Doe, Jane", "1 Main St"]]);
  });

  test("handles escaped quotes", () => {
    const result = parseCsv('quote\n"He said ""hi"""');
    assert.deepEqual(result.rows, [['He said "hi"']]);
  });

  test("handles embedded newlines inside quoted fields", () => {
    const result = parseCsv('note\n"line one\nline two"');
    assert.deepEqual(result.rows, [["line one\nline two"]]);
  });

  test("handles CRLF line endings", () => {
    const result = parseCsv("a,b\r\n1,2\r\n");
    assert.deepEqual(result.rows, [["1", "2"]]);
  });

  test("strips a UTF-8 byte order mark", () => {
    const result = parseCsv("\uFEFFname\nAda");
    assert.deepEqual(result.header, ["name"]);
  });

  test("reports an unterminated quoted field", () => {
    const result = parseCsv('name\n"unterminated');
    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0]?.message ?? "", /Unterminated/);
  });

  test("does not create a phantom trailing row", () => {
    const result = parseCsv("a,b\n1,2\n");
    assert.equal(result.rows.length, 1);
  });

  test("round-trips values that need quoting", () => {
    const rows = [
      ["name", "note"],
      ["Doe, Jane", 'said "hi"'],
      ["multi\nline", "plain"],
    ];
    const csv = stringifyCsv(rows);
    const parsed = parseCsv(csv);
    assert.deepEqual(parsed.rows, [
      ["Doe, Jane", 'said "hi"'],
      ["multi\nline", "plain"],
    ]);
  });

  test("supports an alternative delimiter", () => {
    const result = parseCsv("a;b\n1;2", { delimiter: ";" });
    assert.deepEqual(result.header, ["a", "b"]);
    assert.deepEqual(result.rows, [["1", "2"]]);
  });

  test("maps rows to keyed records", () => {
    const records = rowsToRecords(["id", "name"], [["1", "Ada"]]);
    assert.deepEqual(records, [{ id: "1", name: "Ada" }]);
  });
});
