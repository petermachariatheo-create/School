/**
 * Paging over a list held in the browser.
 *
 * The replica holds the whole school in the device, so a table of ten
 * thousand students has to be shown in pages. The arithmetic lives here
 * so that it can be tested without a browser.
 */

export interface Page<T> {
  /** The records on this page. */
  readonly items: readonly T[];
  /** The page shown, counting from one. */
  readonly page: number;
  /** How many pages there are; at least one, even for an empty list. */
  readonly pages: number;
  /** How many records there are altogether. */
  readonly total: number;
}

/** How many records a page holds unless told otherwise. */
export const DEFAULT_PAGE_SIZE = 25;

/**
 * The page of a list.
 *
 * A page outside the list is clamped to the nearest one that exists, so
 * a page left over from a longer list never shows an empty table.
 */
export function paginate<T>(
  items: readonly T[],
  page: number,
  pageSize: number = DEFAULT_PAGE_SIZE,
): Page<T> {
  const size = Math.max(1, Math.trunc(pageSize));
  const total = items.length;
  const pages = Math.max(1, Math.ceil(total / size));
  const current = Math.min(Math.max(1, Math.trunc(page)), pages);
  const start = (current - 1) * size;

  return { items: items.slice(start, start + size), page: current, pages, total };
}

/**
 * The page numbers to show in a pager.
 *
 * The first and the last page are always offered, together with the
 * pages either side of the one being shown.
 */
export function pageNumbers(page: number, pages: number): number[] {
  const wanted = new Set<number>([1, pages]);
  for (let offset = -1; offset <= 1; offset++) {
    const candidate = page + offset;
    if (candidate >= 1 && candidate <= pages) {
      wanted.add(candidate);
    }
  }
  return [...wanted].sort((left, right) => left - right);
}
