import * as z from "zod";

/**
 * Shared primitives of the canonical domain model.
 *
 * Every externally visible identifier is a ULID so that identifiers are
 * opaque to consumers, sortable by creation time, and safe to mint on a
 * client that may be offline.
 */

/** Opaque entity identifier (ULID). */
export const EntityId = z.ulid();
export type EntityId = z.infer<typeof EntityId>;

/** Full UTC instant, e.g. `2026-10-20T05:41:21.000Z`. */
export const IsoDateTime = z.iso.datetime();
export type IsoDateTime = z.infer<typeof IsoDateTime>;

/** Calendar date without timezone, e.g. `2026-10-20`. */
export const IsoDate = z.iso.date();
export type IsoDate = z.infer<typeof IsoDate>;

/** ISO 4217 alphabetic currency code. */
export const CurrencyCode = z
  .string()
  .regex(/^[A-Z]{3}$/, "Expected a 3-letter ISO 4217 currency code");
export type CurrencyCode = z.infer<typeof CurrencyCode>;

/**
 * Monetary amount expressed in **minor units** (e.g. cents) as an integer.
 *
 * Floating point is never used for money: `0.1 + 0.2 !== 0.3` is not an
 * acceptable property for a school's ledger.
 */
export const MoneyAmount = z.int().min(0);
export type MoneyAmount = z.infer<typeof MoneyAmount>;

export const GENDERS = ["male", "female", "other", "undisclosed"] as const;
export const Gender = z.enum(GENDERS);
export type Gender = z.infer<typeof Gender>;

export const STUDENT_STATUSES = [
  "active",
  "inactive",
  "graduated",
  "withdrawn",
  "transferred",
] as const;
export const StudentStatus = z.enum(STUDENT_STATUSES);
export type StudentStatus = z.infer<typeof StudentStatus>;

export const ENROLLMENT_STATUSES = ["enrolled", "completed", "withdrawn", "transferred"] as const;
export const EnrollmentStatus = z.enum(ENROLLMENT_STATUSES);
export type EnrollmentStatus = z.infer<typeof EnrollmentStatus>;

export const ATTENDANCE_STATUSES = ["present", "absent", "late", "excused"] as const;
export const AttendanceStatus = z.enum(ATTENDANCE_STATUSES);
export type AttendanceStatus = z.infer<typeof AttendanceStatus>;

export const INVOICE_STATUSES = [
  "draft",
  "issued",
  "partially_paid",
  "paid",
  "overdue",
  "void",
] as const;
export const InvoiceStatus = z.enum(INVOICE_STATUSES);
export type InvoiceStatus = z.infer<typeof InvoiceStatus>;

export const PAYMENT_METHODS = [
  "cash",
  "bank_transfer",
  "mobile_money",
  "card",
  "cheque",
  "other",
] as const;
export const PaymentMethod = z.enum(PAYMENT_METHODS);
export type PaymentMethod = z.infer<typeof PaymentMethod>;

/**
 * Fields every synced record carries.
 *
 * `revision` is the optimistic-concurrency token: a client that edits a
 * record states the revision it based its edit on, and the server reports
 * a conflict when that revision is stale.
 *
 * `deletedAt` implements soft deletion so that deletions propagate to
 * offline clients through the same change feed as insertions.
 */
export const EntityMeta = z.object({
  id: EntityId,
  revision: z.int().min(1).default(1),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  deletedAt: IsoDateTime.nullable().default(null),
});
export type EntityMeta = z.infer<typeof EntityMeta>;

/** Link from an internal entity to a record held by an external system. */
export const ExternalReference = z.object({
  /** Identifier of the external system, e.g. `mpesa`, `quickbooks`, `moe`. */
  system: z.string().min(1).max(64),
  /** Identifier of the record within that external system. */
  externalId: z.string().min(1).max(200),
});
export type ExternalReference = z.infer<typeof ExternalReference>;

/** Format minor units as a decimal string, e.g. `123456` -> `1234.56`. */
export function formatMoney(amount: MoneyAmount, currency: string = "USD"): string {
  const sign = amount < 0 ? "-" : "";
  const absolute = Math.abs(amount);
  const major = Math.floor(absolute / 100);
  const minor = String(absolute % 100).padStart(2, "0");
  return `${sign}${currency} ${major}.${minor}`;
}
