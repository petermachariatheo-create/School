import * as z from "zod";

/**
 * Error semantics.
 *
 * Error bodies use RFC 9457 Problem Details rather than an ad-hoc shape,
 * so that generic HTTP tooling can understand them without knowing anything
 * about this API.
 */

export const ERROR_CODES = [
  "validation_failed",
  "malformed_request",
  "not_found",
  "conflict",
  "unauthorized",
  "forbidden",
  "unsupported_media_type",
  "unprocessable_entity",
  "rate_limited",
  "internal_error",
] as const;

export const ErrorCode = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof ErrorCode>;

/** Field-level detail attached to a validation failure. */
export const ErrorDetail = z.object({
  /** Dotted path to the offending field, e.g. `lineItems.0.unitAmount`. */
  path: z.string(),
  message: z.string(),
  code: z.string(),
});
export type ErrorDetail = z.infer<typeof ErrorDetail>;

const PROBLEM_BASE = "https://school.local/problems";

const TITLES: Record<ErrorCode, string> = {
  validation_failed: "Validation failed",
  malformed_request: "Malformed request",
  not_found: "Resource not found",
  conflict: "Conflict",
  unauthorized: "Unauthorized",
  forbidden: "Forbidden",
  unsupported_media_type: "Unsupported media type",
  unprocessable_entity: "Unprocessable entity",
  rate_limited: "Too many requests",
  internal_error: "Internal server error",
};

const STATUSES: Record<ErrorCode, number> = {
  validation_failed: 422,
  malformed_request: 400,
  not_found: 404,
  conflict: 409,
  unauthorized: 401,
  forbidden: 403,
  unsupported_media_type: 415,
  unprocessable_entity: 422,
  rate_limited: 429,
  internal_error: 500,
};

export const ProblemDetails = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  detail: z.string().optional(),
  /** Request path the problem relates to. */
  instance: z.string().optional(),
  /** Field-level errors, present for `validation_failed`. */
  errors: z.array(ErrorDetail).optional(),
});
export type ProblemDetails = z.infer<typeof ProblemDetails>;

/** Build a Problem Details body for a given error code. */
export function problem(
  code: ErrorCode,
  options: { detail?: string; instance?: string; errors?: ErrorDetail[] } = {},
): ProblemDetails {
  return {
    type: `${PROBLEM_BASE}/${code}`,
    title: TITLES[code],
    status: STATUSES[code],
    ...(options.detail === undefined ? {} : { detail: options.detail }),
    ...(options.instance === undefined ? {} : { instance: options.instance }),
    ...(options.errors === undefined ? {} : { errors: options.errors }),
  };
}

/** Translate a Zod error into Problem Details field-level errors. */
export function zodIssuesToDetails(error: z.ZodError): ErrorDetail[] {
  return error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
    code: issue.code,
  }));
}
