import { pageNumbers } from "../app/pagination.ts";
import { Button } from "./Button.tsx";

/**
 * The pages of a list.
 *
 * One pager for every list, so that the way of moving through a thousand
 * students is the same as the way of moving through twenty invoices.
 */

export interface PagerProps {
  /** The page on show, counting from one. */
  readonly page: number;
  /** How many pages there are. */
  readonly pages: number;
  /** Called with the page to show. */
  readonly onPageChange: (page: number) => void;
  /** What the pages are of, for a screen reader. */
  readonly label?: string;
}

export function Pager({ page, pages, onPageChange, label }: PagerProps): React.ReactNode {
  if (pages <= 1) {
    return null;
  }

  return (
    <nav className="pager" aria-label={label ?? "Pages of records"}>
      <Button
        size="sm"
        variant="quiet"
        icon="chevron-left"
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
      >
        Previous
      </Button>

      <span className="pager__pages">
        {pageNumbers(page, pages).map((number) => (
          <Button
            key={number}
            size="sm"
            variant={number === page ? "primary" : "quiet"}
            onClick={() => onPageChange(number)}
            aria-current={number === page ? "page" : undefined}
          >
            {number}
          </Button>
        ))}
      </span>

      <Button
        size="sm"
        variant="quiet"
        icon="chevron-right"
        iconPosition="end"
        disabled={page >= pages}
        onClick={() => onPageChange(page + 1)}
      >
        Next
      </Button>
    </nav>
  );
}
