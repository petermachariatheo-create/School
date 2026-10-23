import { DatabaseSync } from "node:sqlite";
import {
  API_VERSION,
  CONTRACT_VERSION,
  registry,
  SUPPORTED_CONTRACT_VERSIONS,
} from "@school/shared";
import { migrate } from "../packages/server/src/db/migrate.ts";
import { RepositorySet } from "../packages/server/src/db/repository.ts";
import { createRouter } from "../packages/server/src/http/routes.ts";
import { buildOpenApi, schemaName } from "../packages/server/src/http/openapi.ts";
import { SyncEngine } from "../packages/server/src/sync/engine.ts";

/**
 * Contract check.
 *
 * The shared package is the single source of truth for the wire format.
 * This script proves that the contract the server publishes is the contract
 * the shared package defines, so a schema change cannot reach the clients
 * without the published document changing with it.
 *
 * It is deliberately a script rather than a test: it is the gate that runs
 * in `npm run verify` before the build, and it reports every problem it
 * finds rather than stopping at the first one.
 */

interface Failure {
  readonly where: string;
  readonly message: string;
}

const failures: Failure[] = [];
const checks = { passed: 0 };

function check(where: string, condition: boolean, message: string): void {
  if (condition) {
    checks.passed += 1;
    return;
  }
  failures.push({ where, message });
}

function sameShape(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

// ---- build a router so the published document can be inspected ---------------

const db = new DatabaseSync(":memory:");
migrate(db);
const repositories = new RepositorySet(db);
const sync = new SyncEngine({ db, repositories, batchSize: 500, clientRetentionDays: 30 });
const router = createRouter({
  db,
  repositories,
  sync,
  serverUrl: "http://localhost:8080",
  sqliteVersion: "check",
  nodeVersion: "check",
});

const document = buildOpenApi({ router, serverUrl: "http://localhost:8080" }) as {
  info: { version: string };
  paths: Record<string, Record<string, unknown>>;
  components: { schemas: Record<string, unknown> };
  "x-contract-version"?: string;
  "x-api-version"?: string;
};

// ---- version alignment --------------------------------------------------------

check(
  "document",
  document.info.version === CONTRACT_VERSION,
  `info.version is "${document.info.version}", expected "${CONTRACT_VERSION}"`,
);
check(
  "document",
  document["x-contract-version"] === CONTRACT_VERSION,
  `x-contract-version is "${String(document["x-contract-version"])}", expected "${CONTRACT_VERSION}"`,
);
check(
  "document",
  document["x-api-version"] === API_VERSION,
  `x-api-version is "${String(document["x-api-version"])}", expected "${API_VERSION}"`,
);
check(
  "shared",
  SUPPORTED_CONTRACT_VERSIONS.includes(
    CONTRACT_VERSION as (typeof SUPPORTED_CONTRACT_VERSIONS)[number],
  ),
  `CONTRACT_VERSION "${CONTRACT_VERSION}" is not listed in SUPPORTED_CONTRACT_VERSIONS`,
);

// ---- per-entity alignment -----------------------------------------------------

for (const definition of registry.all()) {
  const base = `/api/v1/${definition.restPath}`;
  const item = `${base}/{id}`;
  const paths = document.paths;

  check(definition.type, paths[base] !== undefined, `no path for ${base}`);
  check(definition.type, paths[item] !== undefined, `no path for ${item}`);

  const baseOperations = paths[base] ?? {};
  const itemOperations = paths[item] ?? {};
  check(definition.type, baseOperations["get"] !== undefined, `${base} has no GET operation`);
  check(definition.type, baseOperations["post"] !== undefined, `${base} has no POST operation`);
  check(definition.type, itemOperations["get"] !== undefined, `${item} has no GET operation`);
  check(definition.type, itemOperations["patch"] !== undefined, `${item} has no PATCH operation`);
  check(definition.type, itemOperations["delete"] !== undefined, `${item} has no DELETE operation`);

  // The published component must be the registry's schema, byte for byte.
  const published = document.components.schemas[schemaName(definition.type)];
  check(
    definition.type,
    published !== undefined,
    `no component schema for ${schemaName(definition.type)}`,
  );
  if (published !== undefined) {
    check(
      definition.type,
      sameShape(published, registry.jsonSchema(definition.type)),
      `the published schema for ${definition.type} differs from the registry schema`,
    );
  }

  // The JSON Schema and the Zod schema must describe the same fields.
  const jsonSchema = registry.jsonSchema(definition.type) as {
    properties?: Record<string, unknown>;
    required?: string[];
  };
  const jsonProperties = Object.keys(jsonSchema.properties ?? {}).sort();
  const zodProperties = Object.keys(definition.schema.shape).sort();
  check(
    definition.type,
    sameShape(jsonProperties, zodProperties),
    `JSON Schema fields ${jsonProperties.join(", ")} differ from the Zod fields ${zodProperties.join(", ")}`,
  );

  // A client-supplied record must not be able to set the server's fields,
  // nor the fields the server works out for itself.
  const createShape = Object.keys(registry.createSchema(definition.type).shape).sort();
  const serverOwned = new Set(registry.serverOwnedFields(definition.type));
  const expectedCreate = zodProperties.filter((field) => !serverOwned.has(field));
  check(
    definition.type,
    sameShape(createShape, [...expectedCreate, "id"].sort()),
    `the create schema exposes ${createShape.join(", ")}, expected ${[...expectedCreate, "id"].sort().join(", ")}`,
  );

  // A derived field must be computable from the field it is derived from.
  for (const derived of registry.derivedFields(definition.type)) {
    check(
      definition.type,
      zodProperties.includes(derived.field) && zodProperties.includes(derived.from),
      `the derived field "${derived.field}" does not match a field of ${definition.type}`,
    );
  }

  // A total must name records that exist and fields that exist on them.
  for (const aggregate of registry.aggregateFields(definition.type)) {
    check(
      definition.type,
      zodProperties.includes(aggregate.field),
      `the total "${aggregate.field}" does not match a field of ${definition.type}`,
    );
    const source = registry.get(aggregate.source);
    const sourceFields = Object.keys(source.schema.shape);
    check(
      definition.type,
      sourceFields.includes(aggregate.via) && sourceFields.includes(aggregate.sumOf),
      `the total "${aggregate.field}" names fields that ${aggregate.source} does not have`,
    );
    for (const [sourceField, targetField] of Object.entries(aggregate.match ?? {})) {
      check(
        definition.type,
        sourceFields.includes(sourceField) && zodProperties.includes(targetField),
        `the total "${aggregate.field}" matches on "${sourceField}" and "${targetField}", which do not both exist`,
      );
    }
  }

  // A value the server decides must be a field of the entity, and the
  // values a person may choose must be values of that field.
  for (const refined of registry.refinedFields(definition.type)) {
    check(
      definition.type,
      zodProperties.includes(refined.field),
      `the decided field "${refined.field}" does not match a field of ${definition.type}`,
    );
    const property = (jsonSchema.properties ?? {})[refined.field] as
      | { enum?: unknown[] }
      | undefined;
    const values = Array.isArray(property?.enum) ? property.enum.map((value) => String(value)) : [];
    for (const choice of refined.choices) {
      check(
        definition.type,
        values.includes(choice),
        `the choice "${choice}" is not a value of "${refined.field}"`,
      );
    }
  }

  // A patch must make every field optional.
  const patchShape = registry.patchSchema(definition.type).shape;
  const requiredPatch = Object.entries(patchShape)
    .filter(([, schema]) => !schema.safeParse(undefined).success)
    .map(([name]) => name);
  check(
    definition.type,
    requiredPatch.length === 0,
    `the patch schema still requires ${requiredPatch.join(", ")}`,
  );

  // A total that is a total of a total that is a total of the first one
  // cannot be settled: each write changes the other, and the server would
  // work the figures out for ever.
  for (const aggregate of registry.aggregateFields(definition.type)) {
    check(
      definition.type,
      aggregate.source !== definition.type,
      `the total "${aggregate.field}" is a total of its own entity type`,
    );
    const back = registry
      .aggregateFields(aggregate.source)
      .some((other) => other.source === definition.type);
    check(
      definition.type,
      !back,
      `the total "${aggregate.field}" is a total of ${aggregate.source}, which holds a total of ${definition.type}`,
    );
  }
}

// ---- the client contract the sync engine relies on ----------------------------

const pullShape = new Set(Object.keys((await import("@school/shared")).SyncPullResponse.shape));
for (const field of [
  "changes",
  "cursor",
  "hasMore",
  "logFloor",
  "requiresSnapshot",
  "serverTime",
]) {
  check("sync", pullShape.has(field), `the pull response is missing "${field}"`);
}

db.close();

// ---- report --------------------------------------------------------------------

if (failures.length > 0) {
  process.stderr.write(`\nContract check failed with ${failures.length} problem(s):\n`);
  for (const failure of failures) {
    process.stderr.write(`  • [${failure.where}] ${failure.message}\n`);
  }
  process.exit(1);
}

process.stdout.write(
  `Contract check passed: ${checks.passed} assertions across ${registry.all().length} entity types.\n`,
);
