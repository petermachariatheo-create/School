import * as z from "zod";

/**
 * Public API contract metadata.
 *
 * The contract version is independent of the URL path version: the URL
 * version changes only on a breaking change, while the contract version
 * describes the payload shape so that an external consumer can detect an
 * incompatible payload without guessing.
 */

export const API_VERSION = "v1";

/** Semantic version of the payload contract. */
export const CONTRACT_VERSION = "1.0.0";

/** Contract versions this build can produce and consume. */
export const SUPPORTED_CONTRACT_VERSIONS = ["1.0.0"] as const;

/** Keyset pagination parameters shared by all collection endpoints. */
export const PageQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  /** Opaque keyset cursor from a previous page's `nextCursor`. */
  cursor: z.string().max(512).optional(),
});
export type PageQuery = z.infer<typeof PageQuery>;

/** A page of results with a keyset cursor. */
export function pageSchema<T extends z.ZodType>(item: T) {
  return z.object({
    items: z.array(item),
    /** Cursor for the next page; null when the collection is exhausted. */
    nextCursor: z.string().nullable(),
    /** Total number of records matching the filter, when inexpensive. */
    total: z.number().int().min(0).optional(),
  });
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
  total?: number;
}
