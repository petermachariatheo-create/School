import type { z } from "zod";
import { problem, zodIssuesToDetails, type ProblemDetails } from "@school/shared";
import { HttpError } from "./respond.ts";

/**
 * Parse an untrusted value against a schema, converting failures into
 * RFC 9457 Problem Details.
 */
export function parseOrThrow<T>(schema: z.ZodType<T>, data: unknown, instance?: string): T {
  const result = schema.safeParse(data);
  if (result.success) {
    return result.data;
  }
  const details: ProblemDetails = problem("validation_failed", {
    errors: zodIssuesToDetails(result.error),
    ...(instance === undefined ? {} : { instance }),
  });
  throw new HttpError(details);
}
