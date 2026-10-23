import type { IncomingMessage, ServerResponse } from "node:http";
import type { z } from "zod";
import { HttpError, readJsonBody, readTextBody, sendProblem } from "./respond.ts";
import { problem } from "@school/shared";
import { logError } from "./../log.ts";

/**
 * A small routing layer.
 *
 * The server needs path routing, body parsing and error mapping — not a
 * framework. Implementing them directly keeps the server dependency-free
 * and makes the request path completely explicit, which matters when
 * diagnosing behaviour on a school LAN with intermittent connectivity.
 */

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface RequestContext {
  readonly req: IncomingMessage;
  readonly res: ServerResponse;
  readonly url: URL;
  readonly method: HttpMethod;
  /** Path parameters captured from the route pattern. */
  readonly params: Readonly<Record<string, string>>;
  readonly query: URLSearchParams;
  /** Parsed JSON body; `undefined` when the request had no body. */
  readonly body: unknown;
  /** Request path, used for the `instance` field of problem details. */
  readonly path: string;
}

export type Handler = (context: RequestContext) => Promise<unknown> | unknown;

/** OpenAPI metadata attached to a route so the document is generated, not hand-written. */
export interface RouteDocumentation {
  readonly summary: string;
  readonly description?: string;
  readonly tags?: readonly string[];
  /** Schema of the request body. */
  readonly requestSchema?: z.ZodType;
  /** Schema of a successful response body. */
  readonly responseSchema?: z.ZodType;
  /** Named schema references used in the generated document. */
  readonly requestSchemaName?: string;
  readonly responseSchemaName?: string;
  readonly querySchema?: z.ZodType;
  /** HTTP status for a successful response. Defaults to 200. */
  readonly successStatus?: number;
}

interface CompiledRoute {
  readonly method: HttpMethod;
  readonly pattern: RegExp;
  readonly parameterNames: readonly string[];
  readonly handler: Handler;
  readonly documentation: RouteDocumentation | undefined;
  readonly pathTemplate: string;
}

export class Router {
  readonly #routes: CompiledRoute[] = [];

  add(
    method: HttpMethod,
    pathTemplate: string,
    handler: Handler,
    documentation?: RouteDocumentation,
  ): this {
    const parameterNames: string[] = [];
    const patternSource = pathTemplate
      .split("/")
      .map((segment) => {
        if (segment.startsWith(":")) {
          parameterNames.push(segment.slice(1));
          return "([^/]+)";
        }
        return segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      })
      .join("/");
    this.#routes.push({
      method,
      pattern: new RegExp(`^${patternSource}/?$`),
      parameterNames,
      handler,
      documentation,
      pathTemplate,
    });
    return this;
  }

  get(path: string, handler: Handler, documentation?: RouteDocumentation): this {
    return this.add("GET", path, handler, documentation);
  }

  post(path: string, handler: Handler, documentation?: RouteDocumentation): this {
    return this.add("POST", path, handler, documentation);
  }

  patch(path: string, handler: Handler, documentation?: RouteDocumentation): this {
    return this.add("PATCH", path, handler, documentation);
  }

  delete(path: string, handler: Handler, documentation?: RouteDocumentation): this {
    return this.add("DELETE", path, handler, documentation);
  }

  /** Route templates in registration order, used to generate the OpenAPI document. */
  templates(): {
    method: HttpMethod;
    path: string;
    documentation: RouteDocumentation | undefined;
  }[] {
    return this.#routes.map((route) => ({
      method: route.method,
      path: route.pathTemplate,
      documentation: route.documentation,
    }));
  }

  /**
   * Resolve a request to a handler.
   *
   * Returns `undefined` when no path matches. A path that matches but a
   * method that does not is reported as 405 rather than 404, so that a
   * client using the wrong verb can tell the difference.
   */
  match(
    method: HttpMethod,
    pathname: string,
  ):
    | {
        handler: Handler;
        params: Record<string, string>;
        documentation: RouteDocumentation | undefined;
      }
    | undefined {
    const pathMatches: CompiledRoute[] = [];
    for (const route of this.#routes) {
      const match = route.pattern.exec(pathname);
      if (match === null) {
        continue;
      }
      pathMatches.push(route);
      if (route.method !== method) {
        continue;
      }
      const params: Record<string, string> = {};
      route.parameterNames.forEach((name, index) => {
        params[name] = decodeURIComponent(match[index + 1] ?? "");
      });
      return { handler: route.handler, params, documentation: route.documentation };
    }
    if (pathMatches.length > 0) {
      throw new HttpError(
        problem("malformed_request", {
          detail: `Method ${method} is not allowed for ${pathname}`,
        }),
      );
    }
    return undefined;
  }
}

/**
 * Dispatch a request through the router, mapping thrown errors to
 * Problem Details responses.
 */
export async function dispatch(
  router: Router,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const method = (req.method ?? "GET").toUpperCase() as HttpMethod;

  try {
    const matched = router.match(method, url.pathname);
    if (matched === undefined) {
      sendProblem(
        res,
        problem("not_found", { detail: `No route for ${url.pathname}`, instance: url.pathname }),
      );
      return;
    }

    const contentType = req.headers["content-type"] ?? "";
    const body =
      method === "GET" || method === "DELETE"
        ? undefined
        : contentType.includes("text/csv")
          ? await readTextBody(req)
          : await readJsonBody(req);

    const context: RequestContext = {
      req,
      res,
      url,
      method,
      params: matched.params,
      query: url.searchParams,
      body,
      path: url.pathname,
    };

    const result = await matched.handler(context);
    if (res.writableEnded) {
      return;
    }
    if (result === undefined) {
      res.writeHead(204).end();
      return;
    }
    const payload = JSON.stringify(result);
    res.writeHead(matched.documentation?.successStatus ?? 200, {
      "content-type": "application/json; charset=utf-8",
      "content-length": Buffer.byteLength(payload),
      "cache-control": "no-store",
    });
    res.end(payload);
  } catch (error) {
    if (res.writableEnded) {
      return;
    }
    if (error instanceof HttpError) {
      sendProblem(res, error.details);
      return;
    }
    const detail = error instanceof Error ? error.message : "Unexpected error";
    logError(`[error] ${method} ${url.pathname}: ${detail}\n`);
    sendProblem(
      res,
      problem("internal_error", {
        detail: "The request could not be completed.",
        instance: url.pathname,
      }),
    );
  }
}
