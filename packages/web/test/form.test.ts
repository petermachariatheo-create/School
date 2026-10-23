import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { describeEntity } from "../src/app/fields.ts";
import {
  collect,
  computedValues,
  fieldHint,
  initialFormState,
  isDirty,
  setJson,
  setValue,
} from "../src/app/form.ts";

/**
 * The form logic.
 *
 * The form is the part of the interface a user is most likely to be
 * annoyed by, so its rules are tested here rather than in a browser.
 */

const student = describeEntity("student");
const invoice = describeEntity("invoice");
const schoolClass = describeEntity("class");

function field(entity: ReturnType<typeof describeEntity>, name: string) {
  const found = entity.editable.find((candidate) => candidate.name === name);
  assert.ok(found !== undefined, `${name} is not an editable field of ${entity.type}`);
  return found;
}

describe("starting a form", () => {
  test("a new record starts from the schema's defaults", () => {
    const state = initialFormState(student, null);
    assert.equal(state.values["gender"], "undisclosed");
    assert.equal(state.values["status"], "active");
    assert.equal(state.values["firstName"], "");
  });

  test("a new record is not a change until it is touched", () => {
    const state = initialFormState(student, null);
    assert.equal(isDirty(student, state, null), false);
  });

  test("an existing record starts from what it holds", () => {
    const state = initialFormState(student, {
      firstName: "Ada",
      lastName: "Lovelace",
      gender: "female",
    });
    assert.equal(state.values["firstName"], "Ada");
    assert.equal(state.values["gender"], "female");
  });

  test("a record that matches the form is not a change", () => {
    const data = { firstName: "Ada", lastName: "Lovelace", gender: "female" };
    const state = initialFormState(student, data);
    assert.equal(isDirty(student, state, data), false);
  });

  test("typing something makes the form a change", () => {
    const state = setValue(initialFormState(student, null), field(student, "firstName"), "Ada");
    assert.equal(isDirty(student, state, null), true);
  });
});

describe("reading a form", () => {
  test("collects what the user typed", () => {
    let state = initialFormState(student, null);
    state = setValue(state, field(student, "admissionNumber"), "ADM-1");
    state = setValue(state, field(student, "firstName"), "Ada");
    state = setValue(state, field(student, "lastName"), "Lovelace");

    const result = collect(student, state);
    assert.equal(result.ok, true);
    assert.equal(result.patch["admissionNumber"], "ADM-1");
    assert.equal(result.patch["firstName"], "Ada");
  });

  test("a field the user never touched keeps the value the form shows", () => {
    const state = initialFormState(student, null);
    const result = collect(student, state);
    assert.equal(result.patch["gender"], "undisclosed");
  });

  test("reports a missing required field", () => {
    const result = collect(student, initialFormState(student, null));
    assert.equal(result.ok, false);
    assert.ok(result.problems.some((problem) => problem.field === "firstName"));
  });

  test("reports the problem against the field it belongs to", () => {
    const result = collect(student, initialFormState(student, null));
    const first = result.problems.find((problem) => problem.field === "admissionNumber");
    assert.equal(first?.message, "Admission Number is required");
  });

  test("reports an email address that is not one", () => {
    let state = setValue(initialFormState(student, null), field(student, "email"), "not-an-email");
    state = setValue(state, field(student, "firstName"), "Ada");
    const result = collect(student, state);
    const email = result.problems.find((problem) => problem.field === "email");
    assert.equal(email?.message, "Email must be an email address");
  });

  test("reports a number below the smallest the schema allows", () => {
    let state = setValue(initialFormState(schoolClass, null), field(schoolClass, "capacity"), "0");
    const result = collect(schoolClass, state);
    const capacity = result.problems.find((problem) => problem.field === "capacity");
    assert.equal(capacity?.message, "Capacity must be at least 1");
  });

  test("reports a number that is not a number", () => {
    let state = setValue(
      initialFormState(schoolClass, null),
      field(schoolClass, "capacity"),
      "many",
    );
    const result = collect(schoolClass, state);
    const capacity = result.problems.find((problem) => problem.field === "capacity");
    assert.equal(capacity?.message, "Capacity must be a number");
  });

  test("reports a date that is not a date", () => {
    let state = setValue(
      initialFormState(student, null),
      field(student, "dateOfBirth"),
      "2026-13-40",
    );
    const result = collect(student, state);
    const birth = result.problems.find((problem) => problem.field === "dateOfBirth");
    assert.equal(birth?.message, "Date of Birth must be a date as YYYY-MM-DD");
  });

  test("expands a date and time into the wire format", () => {
    const state = setValue(
      initialFormState(student, null),
      field(student, "dateOfBirth"),
      "2026-10-20",
    );
    const result = collect(student, state);
    assert.equal(result.patch["dateOfBirth"], "2026-10-20");
  });

  test("reports JSON that does not parse", () => {
    let state = setJson(initialFormState(invoice, null), field(invoice, "lineItems"), "{not json");
    const result = collect(invoice, state);
    const items = result.problems.find((problem) => problem.field === "lineItems");
    assert.equal(items?.message, "Line Items is not valid JSON");
  });

  test("reads JSON that does parse", () => {
    const state = setJson(
      initialFormState(invoice, null),
      field(invoice, "lineItems"),
      '[{"description":"Tuition","quantity":1,"unitAmount":1000}]',
    );
    const result = collect(invoice, state);
    assert.equal(
      result.problems.some((problem) => problem.field === "lineItems"),
      false,
    );
    assert.deepEqual(result.patch["lineItems"], [
      { description: "Tuition", quantity: 1, unitAmount: 1000 },
    ]);
  });

  test("emptying a field that holds a value sends null", () => {
    const data = { firstName: "Ada", lastName: "Lovelace", email: "ada@school.org" };
    const state = setValue(initialFormState(student, data), field(student, "email"), "");
    const result = collect(student, state, data);
    assert.equal(result.patch["email"], null);
  });

  test("a value that was never there is not sent as null", () => {
    const result = collect(student, initialFormState(student, null));
    assert.equal("email" in result.patch, false);
  });

  test("a checkbox is read as a yes or a no", () => {
    const link = describeEntity("student_guardian");
    const state = setValue(initialFormState(link, null), field(link, "isPrimary"), true);
    const result = collect(link, state);
    assert.equal(result.patch["isPrimary"], true);
  });
});

describe("the values the server works out", () => {
  test("an invoice total is worked out from the line items", () => {
    const state = setJson(
      initialFormState(invoice, null),
      field(invoice, "lineItems"),
      '[{"description":"Tuition","quantity":2,"unitAmount":100}]',
    );
    const result = collect(invoice, state);
    const computed = computedValues(invoice, result.patch);
    assert.equal(computed["totalAmount"], 200);
  });

  test("the total is not part of what the form sends", () => {
    const state = setJson(
      initialFormState(invoice, null),
      field(invoice, "lineItems"),
      '[{"description":"Tuition","quantity":2,"unitAmount":100}]',
    );
    const result = collect(invoice, state);
    assert.equal("totalAmount" in result.patch, false);
  });

  test("the total follows the line items as they are typed", () => {
    const state = setJson(
      initialFormState(invoice, null),
      field(invoice, "lineItems"),
      '[{"description":"Tuition","quantity":3,"unitAmount":100}]',
    );
    const result = collect(invoice, state);
    const computed = computedValues(invoice, result.patch);
    assert.equal(computed["totalAmount"], 300);
  });

  test("an invoice with no line items has no total to show", () => {
    const result = collect(invoice, initialFormState(invoice, null));
    const computed = computedValues(invoice, result.patch);
    assert.equal(computed["totalAmount"], null);
  });

  test("a record with nothing to work out has no computed values", () => {
    const result = collect(student, initialFormState(student, null));
    assert.deepEqual(computedValues(student, result.patch), {});
  });
});

describe("explaining a field", () => {
  test("says what a field accepts", () => {
    const hint = fieldHint(field(student, "firstName"));
    assert.ok(hint !== null && hint.includes("120 characters"));
  });

  test("says that a field may be left empty", () => {
    const hint = fieldHint(field(student, "email"));
    assert.ok(hint !== null && hint.includes("Optional"));
  });

  test("says nothing about a field with no rules", () => {
    const plain = {
      ...field(student, "firstName"),
      maxLength: null,
      nullable: false,
      format: null,
    };
    assert.equal(fieldHint(plain), null);
  });
});
