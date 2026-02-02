interface PaginationProps {
  currentPage: number;
  totalPages: number;
  totalItems: number;
  onPageChange: (page: number) => void;
}

/**
 * Page navigation controls with ellipsis for large page counts.
 */
export function Pagination({
  currentPage,
  totalPages,
  totalItems,
  onPageChange,
}: PaginationProps) {
  if (totalPages <= 1) {
    return null;
  }

  const pages = getPageNumbers(currentPage, totalPages);

  return (
    <div className="marketplace-pagination">
      <button
        className="marketplace-filters__tab"
        disabled={currentPage <= 1}
        onClick={() => onPageChange(currentPage - 1)}
      >
        Previous
      </button>

      {pages.map((page, i) =>
        page === -1 ? (
          <span key={`ellipsis-${i}`} className="marketplace-pagination__info">
            ...
          </span>
        ) : (
          <button
            key={page}
            className={`marketplace-filters__tab${
              page === currentPage ? ' marketplace-filters__tab--active' : ''
            }`}
            onClick={() => onPageChange(page)}
          >
            {page}
          </button>
        ),
      )}

      <button
        className="marketplace-filters__tab"
        disabled={currentPage >= totalPages}
        onClick={() => onPageChange(currentPage + 1)}
      >
        Next
      </button>

      <span className="marketplace-pagination__info">
        {totalItems} tools
      </span>
    </div>
  );
}

/**
 * Generate page numbers with ellipsis (-1) for compact display.
 *
 * Shows: first, last, current, and 1 page on each side of current.
 * Example for page 5 of 10: [1, -1, 4, 5, 6, -1, 10]
 */
function getPageNumbers(current: number, total: number): number[] {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }

  const pages = new Set<number>();
  pages.add(1);
  pages.add(total);
  pages.add(current);
  if (current > 1) pages.add(current - 1);
  if (current < total) pages.add(current + 1);

  const sorted = [...pages].sort((a, b) => a - b);
  const result: number[] = [];

  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i] - sorted[i - 1] > 1) {
      result.push(-1); // ellipsis
    }
    result.push(sorted[i]);
  }

  return result;
}
