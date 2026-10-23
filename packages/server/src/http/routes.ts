import { z } from "zod";
import type { DatabaseSync } from "node:sqlite";
import {
  API_VERSION,
  CONTRACT_VERSION,
  PageQuery,
  SyncPullQuery,
  SyncPushRequest,
  problem,
  registry,
  ulid,
} from "@school/shared";
import type { RepositorySet } from "../db/repository.ts";
import type { SyncEngine } from "../sync/engine.ts";
import { networkAddresses } from "../net/addresses.ts";
import { exportCsv, exportJson, exportNdjson } from "../interop/exporters.ts";
import { applyImport, previewImport } from "../interop/importers.ts";
import { HttpError, sendText } from "./respond.ts";
import { Router, type RequestContext } from "./router.ts";
import { buildOpenApi, schemaName } from "./openapi.ts";
import { parseOrThrow } from "./validate.ts";

/**
 * Route registration.
 *
 * The entity endpoints are generated from the registry, so every entity
 * type gets a consistent, fully documented CRUD surface without any
 * hand-written per-entity code.
 */

export interface RouteDependencies {
  readonly db: DatabaseSync;
  readonly repositories: RepositorySet;
  readonly sync: SyncEngine;
  readonly serverUrl: string;
  readonly sqliteVersion: string;
  readonly nodeVersion: string;
  /**
   * The ports the server is listening on.
   *
   * These are read at request time, not at construction time: the server
   * moves to the next port when the one it was given is already taken, and
   * a client asking where to connect must be told where it ended up.
   */
  readonly network: { port: number; securePort: number | null };
}
/** Query parameters handled by the generic list endpoint rather than filters. */
const RESERVED_QUERY_PARAMETERS = new Set(["limit", "cursor", "includeDeleted"]);

function notFound(entityType: string, id: string): HttpError {
  return new HttpError(problem("not_found", { detail: `No ${entityType} with id "${id}"` }));
}

export function createRouter(dependencies: RouteDependencies): Router {
  const router = new Router();
  const { repositories, sync } = dependencies;

  // ---------------------------------------------------------------- service

  router.get(
    "/api/v1/health",
    () => ({
      status: "ok",
      // A marker so that a launcher can tell this server from another
      // program that happens to be on the same port.
      product: "school-manager",
      contractVersion: CONTRACT_VERSION,
      apiVersion: API_VERSION,
      node: dependencies.nodeVersion,
      sqlite: dependencies.sqliteVersion,
      cursor: sync.currentCursor(),
      serverTime: new Date().toISOString(),
    }),
    { summary: "Service health and build information", tags: ["general"] },
  );

  router.get(
    "/api/v1/meta",
    () => ({
      contractVersion: CONTRACT_VERSION,
      apiVersion: API_VERSION,
      entityTypes: registry.all().map((definition) => ({
        type: definition.type,
        path: definition.restPath,
        label: definition.label,
        naturalKey: definition.naturalKey,
      })),
      network: {
        port: dependencies.network.port,
        securePort: dependencies.network.securePort,
        addresses: networkAddresses().map((entry) => ({
          address: entry.address,
          interface: entry.interface,
          private: entry.private,
        })),
      },
    }),
    { summary: "Entity catalogue and contract version", tags: ["general"] },
  );

  router.get(
    "/api/v1/openapi.json",
    () => buildOpenApi({ router, serverUrl: dependencies.serverUrl }),
    { summary: "OpenAPI description of this API", tags: ["general"] },
  );

  // ------------------------------------------------------------------ sync

  router.get(
    "/api/v1/sync/changes",
    (context) => {
      const query = parseOrThrow(SyncPullQuery, {
        since: context.query.get("since") ?? 0,
        limit: context.query.get("limit") ?? undefined,
      });
      return sync.pull(query.since, query.limit);
    },
    {
      summary: "Changes after a cursor",
      description:
        "Returns every change whose sequence number is greater than the supplied cursor. " +
        "A client applies the changes and stores the returned cursor for its next request.",
      tags: ["sync"],
      querySchema: SyncPullQuery,
    },
  );

  router.post(
    "/api/v1/sync/push",
    (context) => {
      const request = parseOrThrow(SyncPushRequest, context.body, context.path);
      return sync.push(request);
    },
    {
      summary: "Apply client operations",
      description:
        "Applies a batch of offline operations. Each operation carries a client-generated id, " +
        "so a retried push is recognised rather than applied twice.",
      tags: ["sync"],
      requestSchema: SyncPushRequest,
    },
  );

  router.get("/api/v1/sync/snapshot", () => sync.snapshot(), {
    summary: "Full dataset and cursor",
    description: "Used to initialise a new client without replaying the whole change log.",
    tags: ["sync"],
  });

  router.post(
    "/api/v1/sync/clients",
    (context) => {
      const body = context.body as { clientId?: string; cursor?: number } | undefined;
      const clientId = body?.clientId;
      if (typeof clientId !== "string" || clientId.length === 0) {
        throw new HttpError(problem("validation_failed", { detail: "clientId is required" }));
      }
      sync.registerClient(clientId, Number(body?.cursor ?? 0));
      return { ok: true, cursor: sync.currentCursor() };
    },
    {
      summary: "Register a client and its progress",
      description:
        "The server uses the recorded cursors to decide how far the change log may be pruned. " +
        "A client that stops reporting keeps the log intact.",
      tags: ["sync"],
    },
  );

  // --------------------------------------------------------------- entities

  for (const definition of registry.all()) {
    const repository = repositories.get(definition.type);
    const base = `/api/v1/${definition.restPath}`;
    const label = definition.label.toLowerCase();

    const listSchema = z.object({
      items: z.array(definition.schema),
      nextCursor: z.string().nullable(),
      total: z.number().int().min(0).optional(),
    });

    router.get(
      base,
      (context) => {
        const limit = Number(context.query.get("limit") ?? 50);
        const cursor = context.query.get("cursor") ?? undefined;
        const includeDeleted = context.query.get("includeDeleted") === "true";

        const filters: Record<string, unknown> = {};
        for (const [key, value] of context.query.entries()) {
          if (!RESERVED_QUERY_PARAMETERS.has(key)) {
            filters[key] = value;
          }
        }

        return repository.list({
          limit: Number.isFinite(limit) ? limit : 50,
          cursor,
          filters,
          includeDeleted,
        });
      },
      {
        summary: `List ${label} records`,
        tags: [definition.type],
        querySchema: PageQuery,
        responseSchema: listSchema,
      },
    );

    router.get(
      `${base}/export.csv`,
      (context) => {
        const csv = exportCsv(repository, {
          includeDeleted: context.query.get("includeDeleted") === "true",
        });
        sendText(context.res, 200, csv, "text/csv; charset=utf-8");
        return undefined;
      },
      {
        summary: `Export ${label} records as CSV`,
        description: "Column names and value formats are defined by the entity's published schema.",
        tags: ["interop"],
      },
    );

    router.get(`${base}/export.json`, () => exportJson(repository), {
      summary: `Export ${label} records as JSON`,
      tags: ["interop"],
    });

    router.get(
      `${base}/export.ndjson`,
      (context) => {
        const ndjson = exportNdjson(repository);
        sendText(context.res, 200, ndjson, "application/x-ndjson; charset=utf-8");
        return undefined;
      },
      {
        summary: `Export ${label} records as NDJSON`,
        tags: ["interop"],
      },
    );

    router.post(
      `${base}/import`,
      async (context) => {
        // The router already read the body: as text for a text/csv request,
        // or as JSON otherwise.
        const csv =
          typeof context.body === "string"
            ? context.body
            : String((context.body as { csv?: string } | undefined)?.csv ?? "");

        if (csv.trim() === "") {
          throw new HttpError(problem("validation_failed", { detail: "The CSV payload is empty" }));
        }

        const preview = previewImport(repository, csv);

        // `?apply=true` applies the import; without it the endpoint only
        // reports what would happen, which keeps a consequential change
        // behind an explicit confirmation.
        if (context.query.get("apply") !== "true") {
          return { applied: false, preview };
        }

        const outcome = applyImport(repository, preview, {
          updateExisting: context.query.get("updateExisting") === "true",
        });
        return { applied: true, outcome, preview };
      },
      {
        summary: `Preview or apply a ${label} CSV import`,
        description:
          "Without `apply=true` the endpoint validates the file and reports per-row problems, " +
          "duplicates and the resulting counts. With `apply=true` the import is written in a " +
          "single transaction.",
        tags: ["interop"],
      },
    );

    router.get(
      `${base}/:id`,
      (context) => {
        const record = repository.get(context.params["id"] ?? "");
        if (record === null) {
          throw notFound(definition.type, context.params["id"] ?? "");
        }
        return record;
      },
      {
        summary: `Fetch one ${label} record`,
        tags: [definition.type],
        responseSchema: definition.schema,
      },
    );

    router.post(
      base,
      (context) => {
        const input = parseOrThrow(
          registry.createSchema(definition.type),
          context.body,
          context.path,
        );
        const id = input["id"] ?? ulid();
        const { record } = repository.upsert({ ...input, id });
        return record;
      },
      {
        summary: `Create a ${label} record`,
        tags: [definition.type],
        requestSchema: registry.createSchema(definition.type),
        requestSchemaName: `${schemaName(definition.type)}Request`,
        responseSchema: definition.schema,
        responseSchemaName: `${schemaName(definition.type)}Response`,
        successStatus: 201,
      },
    );

    router.patch(
      `${base}/:id`,
      (context) => {
        const id = context.params["id"] ?? "";
        const input = parseOrThrow(
          registry.patchSchema(definition.type),
          context.body,
          context.path,
        );
        if (repository.get(id) === null) {
          throw notFound(definition.type, id);
        }
        const { record } = repository.upsert({ ...input, id });
        return record;
      },
      {
        summary: `Update a ${label} record`,
        tags: [definition.type],
        requestSchema: registry.patchSchema(definition.type),
        requestSchemaName: `${schemaName(definition.type)}Patch`,
        responseSchema: definition.schema,
        responseSchemaName: `${schemaName(definition.type)}Response`,
      },
    );

    router.delete(
      `${base}/:id`,
      (context) => {
        const id = context.params["id"] ?? "";
        const result = repository.softDelete(id);
        if (result === null) {
          throw notFound(definition.type, id);
        }
        return result.record;
      },
      {
        summary: `Delete a ${label} record`,
        description: "The deletion is a soft delete so that it propagates to offline clients.",
        tags: [definition.type],
        responseSchema: definition.schema,
      },
    );
  }

  return router;
}

/** Convenience for tests and the CLI: build a router around a database. */
export function describeRequest(context: RequestContext): string {
  return `${context.method} ${context.path}`;
}
