import * as z from "zod";
import {
  CurrencyCode,
  EntityId,
  EntityMeta,
  InvoiceStatus,
  IsoDate,
  IsoDateTime,
  MoneyAmount,
  PaymentMethod,
} from "./common.ts";

/**
 * Finance: invoices and payments.
 *
 * All amounts are integers in the currency's minor units. Quantities are
 * integers too, so `quantity * unitAmount` is always an exact amount and
 * the invoice total is never subject to floating-point drift.
 */

export const InvoiceLine = z.object({
  description: z.string().min(1).max(300),
  quantity: z.int().min(1).default(1),
  unitAmount: MoneyAmount,
  /** Chart-of-accounts code, used by accounting integrations. */
  accountCode: z.string().max(64).nullable().default(null),
});
export type InvoiceLine = z.infer<typeof InvoiceLine>;

export const Invoice = EntityMeta.extend({
  /** Human-facing invoice number, unique within the school. */
  invoiceNumber: z.string().min(1).max(64),
  studentId: EntityId,
  /** Guardian responsible for payment; may differ from the primary guardian. */
  guardianId: EntityId.nullable().default(null),
  /** Billing period label, e.g. "Term 1 2026" or "2026-03". */
  term: z.string().min(1).max(64),
  issueDate: IsoDate,
  dueDate: IsoDate,
  currency: CurrencyCode.default("USD"),
  status: InvoiceStatus.default("draft"),
  lineItems: z.array(InvoiceLine).min(1),
  /**
   * Denormalised sum of the line items, maintained by the server so that
   * reporting queries never have to aggregate.
   *
   * A client does not state it: the server works it out from the line
   * items, and a value a client sends is discarded.
   */
  totalAmount: MoneyAmount,
  /**
   * Denormalised sum of the payments received against this invoice.
   *
   * The server keeps it up to date from the payments, so a client does not
   * state it and a value a client sends is discarded.
   */
  paidAmount: MoneyAmount.default(0),
  notes: z.string().max(2000).nullable().default(null),
});
export type Invoice = z.infer<typeof Invoice>;

export const Payment = EntityMeta.extend({
  /** Human-facing payment reference, unique within the school. */
  paymentNumber: z.string().min(1).max(64),
  invoiceId: EntityId,
  studentId: EntityId,
  amount: z.int().min(1),
  currency: CurrencyCode.default("USD"),
  method: PaymentMethod.default("cash"),
  receivedAt: IsoDateTime,
  recordedBy: z.string().max(120).nullable().default(null),
  /** Identifier of the payment in an external gateway, e.g. a mobile-money transaction. */
  externalReference: z.string().max(200).nullable().default(null),
  notes: z.string().max(2000).nullable().default(null),
});
export type Payment = z.infer<typeof Payment>;

/** Exact total of an invoice's line items. */
export function computeInvoiceTotal(lineItems: readonly InvoiceLine[]): MoneyAmount {
  return lineItems.reduce((sum, line) => sum + line.quantity * line.unitAmount, 0);
}

/** Amount still outstanding on an invoice. */
export function invoiceBalance(invoice: Pick<Invoice, "totalAmount" | "paidAmount">): MoneyAmount {
  return Math.max(0, invoice.totalAmount - invoice.paidAmount);
}

/**
 * What the rule needs to know about an invoice.
 *
 * The status is a plain string rather than the schema's type because the
 * rule also runs against records that have not been validated yet, and
 * because a record read back from the database carries a string.
 */
export interface InvoiceStatusFacts {
  /** The status the record currently holds. */
  readonly status: string;
  /** The sum of the line items. */
  readonly totalAmount: number;
  /** The sum of the payments received against the invoice. */
  readonly paidAmount: number;
  /** The day the invoice falls due, as YYYY-MM-DD. */
  readonly dueDate: string;
}

/**
 * The status an invoice should hold, given what has been paid and the date.
 *
 * An invoice's status is two things at once. A `draft` and a `void` invoice
 * are a decision somebody made, and the decision stands: the school has
 * decided not to chase the money, or has decided that the invoice was
 * wrong. The other statuses are a consequence — of the money received and
 * of the date — and the server works them out rather than believing that
 * anybody said so.
 *
 * `today` is the day the rule is applied for. The shared package never
 * reads a clock, so that the same rule can be applied for any date, which
 * is what makes it testable.
 */
export function deriveInvoiceStatus(invoice: InvoiceStatusFacts, today: string): InvoiceStatus {
  if (invoice.status === "void" || invoice.status === "draft") {
    return invoice.status;
  }
  if (invoice.paidAmount >= invoice.totalAmount && invoice.totalAmount > 0) {
    return "paid";
  }
  if (invoice.paidAmount > 0) {
    return "partially_paid";
  }
  return invoice.dueDate < today ? "overdue" : "issued";
}
