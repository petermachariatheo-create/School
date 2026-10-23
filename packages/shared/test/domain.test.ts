import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  computeInvoiceTotal,
  deriveInvoiceStatus,
  formatMoney,
  invoiceBalance,
  studentDisplayName,
  Student,
  TimetableEntry,
  ulid,
} from "../src/index.ts";
import type { Invoice } from "../src/index.ts";

const ID = ulid();

function invoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: ID,
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
    lineItems: [{ description: "Tuition", quantity: 2, unitAmount: 12_500, accountCode: null }],
    totalAmount: 25_000,
    paidAmount: 0,
    notes: null,
    ...overrides,
  };
}

describe("invoice totals", () => {
  test("sums quantity times unit amount exactly", () => {
    const total = computeInvoiceTotal([
      { description: "Tuition", quantity: 2, unitAmount: 12_500, accountCode: null },
      { description: "Books", quantity: 3, unitAmount: 1_050, accountCode: null },
    ]);
    assert.equal(total, 28_150);
  });

  test("does not accumulate floating point error", () => {
    const total = computeInvoiceTotal(
      Array.from({ length: 3 }, () => ({
        description: "Fee",
        quantity: 1,
        unitAmount: 10,
        accountCode: null,
      })),
    );
    assert.equal(total, 30);
  });

  test("computes the outstanding balance", () => {
    assert.equal(invoiceBalance(invoice({ totalAmount: 25_000, paidAmount: 10_000 })), 15_000);
    assert.equal(invoiceBalance(invoice({ totalAmount: 25_000, paidAmount: 30_000 })), 0);
  });
});

describe("invoice status derivation", () => {
  test("keeps a void invoice void", () => {
    assert.equal(
      deriveInvoiceStatus(
        invoice({ status: "void", paidAmount: 0, totalAmount: 25_000 }),
        "2026-02-01",
      ),
      "void",
    );
  });

  test("keeps a draft invoice a draft", () => {
    assert.equal(
      deriveInvoiceStatus(
        invoice({ status: "draft", paidAmount: 0, totalAmount: 25_000 }),
        "2026-06-01",
      ),
      "draft",
    );
  });

  test("is paid when the full amount has been received", () => {
    assert.equal(
      deriveInvoiceStatus(invoice({ paidAmount: 25_000, totalAmount: 25_000 }), "2026-02-01"),
      "paid",
    );
  });

  test("is partially paid when some but not all has been received", () => {
    assert.equal(
      deriveInvoiceStatus(invoice({ paidAmount: 1_000, totalAmount: 25_000 }), "2026-02-01"),
      "partially_paid",
    );
  });

  test("becomes overdue after the due date", () => {
    assert.equal(
      deriveInvoiceStatus(invoice({ paidAmount: 0, totalAmount: 25_000 }), "2026-04-01"),
      "overdue",
    );
  });

  test("is issued before the due date", () => {
    assert.equal(
      deriveInvoiceStatus(invoice({ paidAmount: 0, totalAmount: 25_000 }), "2026-02-01"),
      "issued",
    );
  });
});

describe("money formatting", () => {
  test("renders minor units as a decimal amount", () => {
    assert.equal(formatMoney(123_456), "USD 1234.56");
    assert.equal(formatMoney(5), "USD 0.05");
    assert.equal(formatMoney(0), "USD 0.00");
  });
});

describe("student parsing", () => {
  test("applies defaults for omitted optional fields", () => {
    const parsed = Student.parse({
      id: ulid(),
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      admissionNumber: "ADM-1",
      firstName: "Ada",
      lastName: "Lovelace",
    });
    assert.equal(parsed.gender, "undisclosed");
    assert.equal(parsed.status, "active");
    assert.equal(parsed.revision, 1);
    assert.equal(parsed.deletedAt, null);
  });

  test("rejects a record missing a required field", () => {
    const result = Student.safeParse({ id: ulid() });
    assert.equal(result.success, false);
  });

  test("builds a display name from the name parts", () => {
    const student = Student.parse({
      id: ulid(),
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      admissionNumber: "ADM-2",
      firstName: "Ada",
      middleName: "Byron",
      lastName: "Lovelace",
    });
    assert.equal(studentDisplayName(student), "Ada Byron Lovelace");
  });
});

describe("timetable parsing", () => {
  const lesson = {
    id: ulid(),
    revision: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    deletedAt: null,
    classId: ulid(),
    subject: "Mathematics",
    teacherName: "Ms Okonkwo",
    day: "monday",
    startTime: "09:00",
    endTime: "10:00",
    room: "Room 3",
  };

  test("keeps a lesson as it is written", () => {
    const parsed = TimetableEntry.parse(lesson);
    assert.equal(parsed.subject, "Mathematics");
    assert.equal(parsed.day, "monday");
    assert.equal(parsed.startTime, "09:00");
  });

  test("refuses a day that is not a school day", () => {
    assert.equal(TimetableEntry.safeParse({ ...lesson, day: "saturday" }).success, false);
  });

  test("refuses a time that is not a time of day", () => {
    assert.equal(TimetableEntry.safeParse({ ...lesson, startTime: "9am" }).success, false);
    assert.equal(TimetableEntry.safeParse({ ...lesson, endTime: "25:00" }).success, false);
  });

  test("refuses a lesson with no subject", () => {
    assert.equal(TimetableEntry.safeParse({ ...lesson, subject: "" }).success, false);
  });

  test("does not need a teacher or a room", () => {
    const parsed = TimetableEntry.parse({ ...lesson, teacherName: null, room: null });
    assert.equal(parsed.teacherName, null);
    assert.equal(parsed.room, null);
  });
});
