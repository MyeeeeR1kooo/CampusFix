export interface PaginationProps {
  nextCursor: string | null;
  hasPrevious: boolean;
  onNext: (cursor: string) => void;
  onPrevious: () => void;
  busy?: boolean;
}

/** The page owns cursor history. The API never supplies totals or numbered pages. */
export function Pagination({ nextCursor, hasPrevious, onNext, onPrevious, busy = false }: PaginationProps) {
  return <nav className="pagination" aria-label="Pagination" aria-busy={busy}>
    <span className="pagination-summary">{busy ? "Loading…" : nextCursor ? "More records available" : "End of results"}</span>
    <div className="pagination-controls">
      <button type="button" disabled={busy || !hasPrevious} onClick={onPrevious}>Previous</button>
      <button type="button" disabled={busy || nextCursor === null} onClick={() => { if (nextCursor !== null) onNext(nextCursor); }}>Next</button>
    </div>
  </nav>;
}
