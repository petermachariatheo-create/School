/**
 * `@school/shared` — the canonical domain model and wire contracts.
 *
 * Both the server and the browser client import this package, so a change
 * to a schema is immediately visible on both sides of the network. The
 * package deliberately has no I/O: it is pure domain logic that can be
 * imported by a script, a test, a browser bundle or the server alike.
 */

export * from "./ids/ulid.ts";
export * from "./time.ts";
export * from "./domain/common.ts";
export * from "./domain/people.ts";
export * from "./domain/academic.ts";
export * from "./domain/finance.ts";
export * from "./contracts/errors.ts";
export * from "./contracts/api.ts";
export * from "./contracts/sync.ts";
export * from "./interop/csv.ts";
export * from "./interop/json.ts";
export * from "./registry.ts";
