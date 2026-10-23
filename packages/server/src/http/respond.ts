import type { IncomingMessage, ServerResponse } from "node:http";
import { problem, type ProblemDetails } from "@school/shared";

/**
 * HTTP response helpers.
 *
 * Errors are emitted as RFC 9457 Problem Details so that generic clients
 * and tooling can interpret them without knowing this API's shape.
 */

/** Maximum accepted request body size, in bytes. */
export const MAX_BODY_BYTES = 8 * 1024 * 1024;

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "cache-control": "no-store",
  });
  res.end(payload);
}

export function sendProblem(res: ServerResponse, details: ProblemDetails): void {
  const payload = JSON.stringify(details);
  res.writeHead(details.status, {
    "content-type": "application/problem+json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "cache-control": "no-store",
  });
  res.end(payload);
}

export function sendText(
  res: ServerResponse,
  status: number,
  body: string,
  contentType = "text/plain; charset=utf-8",
): void {
  res.writeHead(status, {
    "content-type": contentType,
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
}

export class HttpError extends Error {
  readonly details: ProblemDetails;
  constructor(details: ProblemDetails) {
    super(details.title);
    this.name = "HttpError";
    this.details = details;
  }
}

/**
 * Read and parse a JSON request body.
 *
 * The size is bounded before parsing so that a hostile or accidental
 * oversized upload cannot exhaust memory.
 */
export async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const contentType = req.headers["content-type"];
  if (contentType !== undefined && !contentType.includes("application/json")) {
    throw new HttpError(
      problem("unsupported_media_type", {
        detail: "Expected a request body with content-type application/json",
      }),
    );
  }

  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > MAX_BODY_BYTES) {
      throw new HttpError(
        problem("malformed_request", { detail: `Request body exceeds ${MAX_BODY_BYTES} bytes` }),
      );
    }
    chunks.push(buffer);
  }

  if (size === 0) {
    return undefined;
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new HttpError(problem("malformed_request", { detail: "Request body is not valid JSON" }));
  }
}

/** Read a request body as UTF-8 text, for CSV uploads. */
export async function readTextBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > MAX_BODY_BYTES) {
      throw new HttpError(
        problem("malformed_request", { detail: `Request body exceeds ${MAX_BODY_BYTES} bytes` }),
      );
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}
