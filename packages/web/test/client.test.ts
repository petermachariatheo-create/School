import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { registry } from "@school/shared";
import { describeEntity, listEntities, recordLabel, selectOptions } from "../src/app/fields.ts";
import {
  cardSpecFor,
  descriptionFor,
  headingFor,
  relatedTypesFor,
  PROFILE_TYPES,
} from "../src/app/catalog.ts";
import { cell, exportCsv } from "../src/app/export.ts";
import { formatCalendarDate, formatValue, normalizeDateTime } from "../src/app/values.ts";
import { connectUrls } from "./../src/app/server.ts";
import { registerGuard, pendingQuestion } from "../src/app/guards.ts";
import { readPlace } from "../src/app/place.ts";
import { isRelationField } from "../src/app/fields.ts";
import type { ReplicaRecord } from "../src/data/db.ts";

/**
 * The client's pure logic.
 *
 * The client has no browser test runner, so everything that can be tested
 * without a DOM is kept in plain functions and tested here.
 */

describe("entity descriptions", () => {
  test("describes every registered entity type", () => {
    const entities = listEntities();
    assert.equal(entities.length, registry.all().length);
    for (const entity of entities) {
      assert.ok(entity.editable.length > 0, `${entity.type} has no editable fields`);
    }
  });

  test("marks the server-managed fields as read-only", () => {
    const student = describeEntity("student");
    const readOnly = student.fields.filter((field) => field.readOnly).map((field) => field.name);
    assert.deepEqual(
      readOnly.sort(),
      ["createdAt", "deletedAt", "id", "revision", "updatedAt"].sort(),
    );
  });

  test("derives a text field for a string", () => {
    const student = describeEntity("student");
    const admission = student.fields.find((field) => field.name === "admissionNumber");
    assert.equal(admission?.kind, "text");
    assert.equal(admission?.required, true);
  });

  test("derives a select for an enum", () => {
    const student = describeEntity("student");
    const gender = student.fields.find((field) => field.name === "gender");
    assert.equal(gender?.kind, "select");
    assert.deepEqual(gender?.options, ["male", "female", "other", "undisclosed"]);
  });

  test("a field the server decides offers only the values a person may choose", () => {
    const invoice = describeEntity("invoice");
    const status = invoice.fields.find((field) => field.name === "status");
    assert.ok(status !== undefined);
    assert.deepEqual(selectOptions(status, "issued"), ["draft", "issued", "void"]);
  });

  test("a value the server worked out is still shown", () => {
    const invoice = describeEntity("invoice");
    const status = invoice.fields.find((field) => field.name === "status");
    assert.ok(status !== undefined);
    assert.deepEqual(selectOptions(status, "overdue"), ["draft", "issued", "overdue", "void"]);
  });

  test("a field the server does not decide offers every value", () => {
    const student = describeEntity("student");
    const gender = student.fields.find((field) => field.name === "gender");
    assert.ok(gender !== undefined);
    assert.deepEqual(selectOptions(gender, "other"), ["male", "female", "other", "undisclosed"]);
  });

  test("derives a checkbox for a boolean", () => {
    const link = describeEntity("student_guardian");
    const primary = link.fields.find((field) => field.name === "isPrimary");
    assert.equal(primary?.kind, "checkbox");
  });

  test("derives a number field for an integer", () => {
    const classDescription = describeEntity("class");
    const capacity = classDescription.fields.find((field) => field.name === "capacity");
    assert.equal(capacity?.kind, "number");
  });

  test("derives a date field for a calendar date and a datetime for an instant", () => {
    const student = describeEntity("student");
    assert.equal(student.fields.find((field) => field.name === "dateOfBirth")?.kind, "date");
    assert.equal(student.fields.find((field) => field.name === "createdAt")?.kind, "datetime");
  });

  test("derives a JSON field for an array", () => {
    const invoice = describeEntity("invoice");
    assert.equal(invoice.fields.find((field) => field.name === "lineItems")?.kind, "json");
  });

  test("marks a nullable field as nullable", () => {
    const student = describeEntity("student");
    assert.equal(student.fields.find((field) => field.name === "email")?.nullable, true);
    assert.equal(student.fields.find((field) => field.name === "firstName")?.nullable, false);
  });

  test("derives a label a person can read", () => {
    const student = describeEntity("student");
    assert.equal(
      student.fields.find((field) => field.name === "dateOfBirth")?.label,
      "Date of Birth",
    );
    assert.equal(
      student.fields.find((field) => field.name === "admissionNumber")?.label,
      "Admission Number",
    );
  });

  test("writes an identifier in capitals", () => {
    const link = describeEntity("student_guardian");
    assert.equal(link.fields.find((field) => field.name === "studentId")?.label, "Student ID");
  });

  test("overrides a label the field name cannot explain", () => {
    const link = describeEntity("student_guardian");
    assert.equal(link.fields.find((field) => field.name === "isPrimary")?.label, "Primary contact");
  });

  test("carries the default the domain gives a field", () => {
    const student = describeEntity("student");
    assert.equal(
      student.fields.find((field) => field.name === "gender")?.defaultValue,
      "undisclosed",
    );
    assert.equal(student.fields.find((field) => field.name === "status")?.defaultValue, "active");
    assert.equal(student.fields.find((field) => field.name === "email")?.defaultValue, null);
  });

  test("carries the limits the schema puts on a field", () => {
    const classDescription = describeEntity("class");
    const capacity = classDescription.fields.find((field) => field.name === "capacity");
    assert.equal(capacity?.minimum, 1);
    assert.equal(capacity?.nullable, true);

    const student = describeEntity("student");
    assert.equal(student.fields.find((field) => field.name === "firstName")?.maxLength, 120);
    assert.equal(student.fields.find((field) => field.name === "email")?.format, "email");
  });
});

describe("value formatting", () => {
  test("renders a missing value as a dash", () => {
    assert.equal(formatValue(null), "—");
    assert.equal(formatValue(undefined), "—");
  });

  test("renders a boolean as yes or no", () => {
    assert.equal(formatValue(true), "yes");
    assert.equal(formatValue(false), "no");
  });

  test("renders a structured value as JSON", () => {
    assert.equal(formatValue({ a: 1 }), '{"a":1}');
  });

  test("renders a value from a list of choices as words", () => {
    assert.equal(formatValue("partially_paid", ["partially_paid", "paid"]), "Partially Paid");
  });

  test("renders a calendar date the way the cards do", () => {
    assert.equal(formatValue("2024-08-10"), "10 Aug 2024");
  });

  test("leaves a date-time alone", () => {
    assert.equal(formatValue("2024-08-10T08:30:00.000Z"), "2024-08-10T08:30:00.000Z");
  });

  test("expands a date-time to the wire format", () => {
    assert.equal(normalizeDateTime("2026-10-20"), "2026-10-20");
    assert.equal(normalizeDateTime("2026-10-20T08:30"), "2026-10-20T08:30:00.000Z");
    assert.equal(normalizeDateTime("2026-10-20T08:30:45"), "2026-10-20T08:30:45.000Z");
    assert.equal(normalizeDateTime("2026-10-20T08:30:45.123Z"), "2026-10-20T08:30:45.123Z");
  });
});

function record(data: Record<string, unknown>): ReplicaRecord {
  return {
    entityType: "student",
    id: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
    revision: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    deletedAt: null,
    data,
    pending: false,
  };
}

describe("offline CSV export", () => {
  test("writes the header from the registry", () => {
    const csv = exportCsv("student", []);
    const header = csv.split("\r\n")[0] ?? "";
    assert.equal(header, registry.csvColumns("student").join(","));
    assert.equal(header.includes("revision"), false);
    assert.equal(header.includes("deletedAt"), false);
  });

  test("writes a record as a row", () => {
    const csv = exportCsv("student", [
      record({ admissionNumber: "ADM-1", firstName: "Ada", lastName: "Lovelace" }),
    ]);
    const lines = csv.trim().split("\r\n");
    assert.equal(lines.length, 2);
    assert.match(lines[1] ?? "", /ADM-1,Ada,Lovelace/);
  });

  test("escapes a value that contains a comma", () => {
    const csv = exportCsv("student", [
      record({ admissionNumber: "ADM-1", firstName: "Ada, Countess", lastName: "Lovelace" }),
    ]);
    assert.match(csv, /"Ada, Countess"/);
  });

  test("writes a nested value as JSON so nothing is lost", () => {
    const csv = exportCsv("invoice", [
      {
        ...record({ invoiceNumber: "INV-1" }),
        entityType: "invoice",
        data: {
          invoiceNumber: "INV-1",
          lineItems: [{ description: "Tuition", quantity: 1, unitAmount: 1000 }],
        },
      },
    ]);
    assert.match(csv, /"\[.*Tuition.*\]"/);
  });

  test("renders a missing value as an empty cell", () => {
    assert.equal(cell(null), "");
    assert.equal(cell(undefined), "");
  });
});

describe("record labels", () => {
  test("prefers a person's name", () => {
    assert.equal(
      recordLabel("student", { firstName: "Ada", middleName: "Byron", lastName: "Lovelace" }),
      "Ada Byron Lovelace",
    );
  });

  test("falls back to a business key", () => {
    assert.equal(recordLabel("invoice", { invoiceNumber: "INV-1" }), "INV-1");
  });

  test("falls back to the entity type", () => {
    assert.equal(recordLabel("payment", {}), "payment");
  });
});

describe("connecting another device", () => {
  test("uses the first address and keeps the rest as alternatives", () => {
    const urls = connectUrls({
      port: 8080,
      securePort: null,
      addresses: [
        { address: "192.168.1.20", interface: "Wi-Fi", private: true },
        { address: "10.0.0.5", interface: "Ethernet", private: true },
      ],
    });
    assert.equal(urls.primary, "http://192.168.1.20:8080");
    assert.deepEqual(urls.all, ["http://192.168.1.20:8080", "http://10.0.0.5:8080"]);
  });

  test("falls back to this computer when the server reports no address", () => {
    const urls = connectUrls({ port: 8080, securePort: null, addresses: [] });
    assert.equal(urls.primary, "http://localhost:8080");
    assert.deepEqual(urls.all, []);
    assert.equal(urls.securePrimary, null);
  });

  test("offers the secure address when the server has a certificate", () => {
    const urls = connectUrls({
      port: 8080,
      securePort: 8443,
      addresses: [{ address: "192.168.1.20", interface: "Wi-Fi", private: true }],
    });
    assert.equal(urls.securePrimary, "https://192.168.1.20:8443");
    assert.deepEqual(urls.secureAll, ["https://192.168.1.20:8443"]);
  });

  test("ignores an address that is not an IP address", () => {
    const urls = connectUrls({
      port: 8080,
      securePort: null,
      addresses: [
        { address: "<script>alert(1)</script>", interface: "evil", private: false },
        { address: "192.168.1.20", interface: "Wi-Fi", private: true },
      ],
    });
    assert.equal(urls.primary, "http://192.168.1.20:8080");
    assert.equal(urls.all.length, 1);
  });
});

describe("the heading of a page", () => {
  test("is the plural of the record type", () => {
    assert.equal(headingFor("Student"), "Students");
    assert.equal(headingFor("Invoice"), "Invoices");
    assert.equal(headingFor("Assessment Result"), "Assessment Results");
  });

  test("takes the usual plural endings into account", () => {
    assert.equal(headingFor("Class"), "Classes");
    assert.equal(headingFor("Attendance"), "Attendances");
  });
});

describe("the description of a page", () => {
  test("says what the page is for", () => {
    assert.notEqual(descriptionFor("student"), "");
  });

  test("says nothing for a type it does not know", () => {
    assert.equal(descriptionFor("unicorn"), "");
  });
});

describe("a card", () => {
  test("is offered for the people and the classes, and not for the rest", () => {
    assert.notEqual(cardSpecFor("student"), null);
    assert.notEqual(cardSpecFor("guardian"), null);
    assert.notEqual(cardSpecFor("class"), null);
    assert.equal(cardSpecFor("invoice"), null);
  });

  test("shows the context a person would use", () => {
    assert.deepEqual(cardSpecFor("student")?.context, ["admissionNumber"]);
    assert.deepEqual(cardSpecFor("class")?.context, ["gradeLevel", "academicYear"]);
    assert.equal(cardSpecFor("guardian")?.context, undefined);
  });

  test("shows the facts that are worth seeing", () => {
    assert.deepEqual(cardSpecFor("student")?.facts, [
      { field: "admissionDate" },
      { field: "gender", badge: true },
    ]);
    assert.deepEqual(cardSpecFor("guardian")?.facts, [{ field: "phone" }, { field: "email" }]);
    assert.deepEqual(cardSpecFor("class")?.facts, [{ field: "teacherName" }, { field: "room" }]);
  });
});

describe("a record that opens as a profile", () => {
  test("is the student, the guardian and the class", () => {
    assert.deepEqual([...PROFILE_TYPES].sort(), ["class", "guardian", "student"]);
  });
});

describe("the records that are about a record", () => {
  test("are named for the record they are about", () => {
    assert.deepEqual(relatedTypesFor("student"), ["student_guardian", "enrollment", "invoice"]);
    assert.deepEqual(relatedTypesFor("invoice"), ["payment"]);
  });

  test("are none for a type that has none", () => {
    assert.deepEqual(relatedTypesFor("payment"), []);
  });
});

describe("a field that points at another record", () => {
  test("is recognised by its name", () => {
    assert.equal(isRelationField("studentId", ["student", "class"]), true);
    assert.equal(isRelationField("classId", ["student", "class"]), true);
  });

  test("is not a relation when the type is not one of them", () => {
    assert.equal(isRelationField("externalId", ["student", "class"]), false);
    assert.equal(isRelationField("firstName", ["student", "class"]), false);
  });
});

describe("the place the user is in", () => {
  test("is read back out of a history entry", () => {
    const place = readPlace({
      entityType: "student",
      recordId: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
      creating: false,
      editing: true,
      overlay: null,
    });
    assert.equal(place?.entityType, "student");
    assert.equal(place?.editing, true);
  });

  test("is not read out of something that is not a place", () => {
    assert.equal(readPlace(null), null);
    assert.equal(readPlace({}), null);
    assert.equal(readPlace("nonsense"), null);
  });

  test("treats a new record as being edited", () => {
    assert.equal(readPlace({ entityType: "student", creating: true })?.editing, true);
  });
});

describe("guards on leaving", () => {
  test("ask the question of the form that holds unsaved work", () => {
    const release = registerGuard(() => "Discard the changes that have not been saved?");
    assert.equal(pendingQuestion(), "Discard the changes that have not been saved?");
    release();
    assert.equal(pendingQuestion(), null);
  });

  test("are silent when there is nothing to ask about", () => {
    assert.equal(pendingQuestion(), null);
  });
});

describe("a calendar date for people to read", () => {
  test("is written as the day, the month and the year", () => {
    assert.equal(formatCalendarDate("2024-01-15"), "15 Jan 2024");
    assert.equal(formatCalendarDate("2024-12-01"), "1 Dec 2024");
  });

  test("does not move a day because of the timezone", () => {
    // The text is read rather than a Date, so the day is the day.
    assert.equal(formatCalendarDate("2024-01-01"), "1 Jan 2024");
  });

  test("says so when there is no date", () => {
    assert.equal(formatCalendarDate(null), "—");
    assert.equal(formatCalendarDate(""), "—");
  });

  test("leaves anything else alone", () => {
    assert.equal(formatCalendarDate("Term 1"), "Term 1");
  });
});
