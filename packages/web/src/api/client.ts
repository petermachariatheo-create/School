import type { ProblemDetails } from "@school/shared";
import type { ServerMeta } from "../app/server.ts";

/**
 * HTTP client for the school API.
 *
 * Every failure is surfaced as an `ApiError` carrying RFC 9457 Problem
 * Details, so the interface can show field-level messages without
 * special-casing individual endpoints.
 */

export class ApiError extends Error {
  readonly status: number;
  readonly problem: ProblemDetails;

  constructor(status: number, problem: ProblemDetails) {
    super(problem.detail ?? problem.title);
    this.name = "ApiError";
    this.status = status;
    this.problem = problem;
  }
  /** Field-level messages, when the server reported them. */
  get fieldErrors(): { path: string; message: string }[] {
    return (this.problem.errors ?? []).map((detail) => ({
      path: detail.path,
      message: detail.message,
    }));
  }
}

/** Raised when the server could not be reached at all. */
export class NetworkError extends Error {
  readonly reason: unknown;

  constructor(message: string, reason?: unknown) {
    super(message);
    this.name = "NetworkError";
    this.reason = reason;
  }
}

export interface ApiClientOptions {
  /** Base URL of the API. Empty string means "same origin". */
  readonly baseUrl?: string;
  /** Injection point for tests. */
  readonly fetchImpl?: typeof fetch;
}

export class ApiClient {
  readonly #baseUrl: string;
  readonly #fetch: typeof fetch;

  constructor(options: ApiClientOptions = {}) {
    this.#baseUrl = (options.baseUrl ?? "").replace(/\/$/, "");
    this.#fetch = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  /** Absolute URL for an API path. */
  url(path: string): string {
    return `${this.#baseUrl}${path}`;
  }

  async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await this.#fetch(this.url(path), {
      ...init,
      headers: {
        accept: "application/json",
        ...(init.body === undefined ? {} : { "content-type": "application/json" }),
        ...init.headers,
      },
    });

    if (response.ok) {
      if (response.status === 204) {
        return undefined as T;
      }
      return (await response.json()) as T;
    }

    let problem: ProblemDetails;
    try {
      problem = (await response.json()) as ProblemDetails;
    } catch {
      problem = {
        type: "https://school.local/problems/internal_error",
        title: "Request failed",
        status: response.status,
        detail: `${response.status} ${response.statusText}`,
      };
    }
    throw new ApiError(response.status, problem);
  }

  get<T>(path: string): Promise<T> {
    return this.request<T>(path);
  }

  /** The server's metadata: the entity catalogue and its network addresses. */
  meta(): Promise<ServerMeta> {
    return this.get<ServerMeta>("/api/v1/meta");
  }

  post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>(path, {
      method: "POST",
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  patch<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>(path, { method: "PATCH", body: JSON.stringify(body) });
  }

  delete<T>(path: string): Promise<T> {
    return this.request<T>(path, { method: "DELETE" });
  }

  /** Fetch a text body such as a CSV export. */
  async text(path: string): Promise<string> {
    const response = await this.#fetch(this.url(path), { headers: { accept: "text/csv, */*" } });
    if (!response.ok) {
      throw new NetworkError(`Request to ${path} failed with status ${response.status}`);
    }
    return response.text();
  }

  /** Post a raw body, used for CSV import. */
  async postRaw<T>(path: string, body: string, contentType: string): Promise<T> {
    const response = await this.#fetch(this.url(path), {
      method: "POST",
      headers: { "content-type": contentType, accept: "application/json" },
      body,
    });
    if (!response.ok) {
      let problem: ProblemDetails;
      try {
        problem = (await response.json()) as ProblemDetails;
      } catch {
        problem = {
          type: "https://school.local/problems/internal_error",
          title: "Request failed",
          status: response.status,
        };
      }
      throw new ApiError(response.status, problem);
    }
    return (await response.json()) as T;
  }
}
