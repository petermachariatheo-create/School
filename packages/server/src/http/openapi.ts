import { z } from "zod";
import { API_VERSION, CONTRACT_VERSION, registry } from "@school/shared";
import type { HttpMethod, Router } from "./router.ts";

/**
 * OpenAPI document generation.
 *
 * The document is derived from the route table and the entity registry
 * rather than written by hand, so it cannot drift from the implementation.
 * Whenever a schema changes, the published contract changes with it.
 */

export interface OpenApiOptions {
  readonly router: Router;
  readonly serverUrl: string;
  readonly title?: string;
  readonly version?: string;
}

/** Convert an internal type name into a component schema name. */
export function schemaName(entityType: string): string {
  return entityType
    .split(/[_-]/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

function operationId(method: HttpMethod, path: string): string {
  const slug = path
    .replace(/\{([^}]+)\}/g, "By$1")
    .split("/")
    .filter((segment) => segment !== "")
    .map((segment) =>
      segment.replace(/[^A-Za-z0-9]+(.)/g, (_, character: string) => character.toUpperCase()),
    )
    .join("");
  return `${method.toLowerCase()}${slug.charAt(0).toUpperCase()}${slug.slice(1)}`;
}

function schemaRef(name: string): Record<string, string> {
  return { $ref: `#/components/schemas/${name}` };
}

export function buildOpenApi(options: OpenApiOptions): Record<string, unknown> {
  const schemas: Record<string, unknown> = {};
  const paths: Record<string, Record<string, unknown>> = {};

  for (const definition of registry.all()) {
    schemas[schemaName(definition.type)] = registry.jsonSchema(definition.type);
  }

  for (const route of options.router.templates()) {
    const documentation = route.documentation;
    if (documentation === undefined) {
      continue;
    }

    const openApiPath = route.path.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
    const pathItem = paths[openApiPath] ?? {};

    const operation: Record<string, unknown> = {
      operationId: operationId(route.method, route.path),
      summary: documentation.summary,
      tags: documentation.tags ?? ["general"],
      responses: {
        "200": {
          description: "Successful response",
          content: { "application/json": { schema: { type: "object" } } },
        },
        "404": { description: "The requested resource does not exist" },
        "422": { description: "The request failed validation" },
      },
    };
    if (documentation.description !== undefined) {
      operation["description"] = documentation.description;
    }

    const pathParameters = [...route.path.matchAll(/:([A-Za-z0-9_]+)/g)].map((match) => ({
      name: match[1],
      in: "path",
      required: true,
      schema: { type: "string" },
    }));
    if (pathParameters.length > 0) {
      operation["parameters"] = pathParameters;
    }

    if (documentation.querySchema !== undefined) {
      const querySchema = z.toJSONSchema(documentation.querySchema, {
        target: "draft-2020-12",
        io: "input",
      }) as Record<string, unknown>;
      const properties = (querySchema["properties"] ?? {}) as Record<string, unknown>;
      operation["parameters"] = [
        ...(Array.isArray(operation["parameters"]) ? operation["parameters"] : []),
        ...Object.entries(properties).map(([name, schema]) => ({
          name,
          in: "query",
          required: false,
          schema,
        })),
      ];
    }

    if (documentation.requestSchema !== undefined) {
      const requestName = documentation.requestSchemaName ?? "RequestBody";
      schemas[requestName] = z.toJSONSchema(documentation.requestSchema, {
        target: "draft-2020-12",
        io: "input",
      });
      operation["requestBody"] = {
        required: true,
        content: { "application/json": { schema: schemaRef(requestName) } },
      };
    }

    if (documentation.responseSchema !== undefined) {
      const responseName = documentation.responseSchemaName ?? "ResponseBody";
      schemas[responseName] = z.toJSONSchema(documentation.responseSchema, {
        target: "draft-2020-12",
        io: "output",
      });
      const responses = operation["responses"] as Record<string, unknown>;
      responses["200"] = {
        description: "Successful response",
        content: { "application/json": { schema: schemaRef(responseName) } },
      };
    }

    pathItem[route.method.toLowerCase()] = operation;
    paths[openApiPath] = pathItem;
  }

  return {
    openapi: "3.1.0",
    info: {
      title: options.title ?? "School Management API",
      version: options.version ?? CONTRACT_VERSION,
      description:
        "Local-first school management API. The server is authoritative; clients keep a local " +
        "replica and synchronise through the cursor-based change feed.",
    },
    servers: [{ url: options.serverUrl, description: "School server" }],
    tags: [
      { name: "general", description: "Service metadata and health" },
      { name: "sync", description: "Cursor-based synchronisation" },
      { name: "interop", description: "Import, export and backup" },
    ],
    paths,
    components: { schemas },
    "x-contract-version": CONTRACT_VERSION,
    "x-api-version": API_VERSION,
  };
}
