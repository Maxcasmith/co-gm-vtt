import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Button } from './components/Button/Button.tsx';

export interface PageResult<T> {
  items: T[];
  total: number;
}

interface PaginatedProps<T> {
  fetchPage: (page: number, pageSize: number) => Promise<PageResult<T>>;
  pageSize: number;
  // Bump to force a refetch of the current page (e.g. after a delete/edit) without resetting to
  // page 1 — pass a new `key` on this component instead when you want a full reset (e.g. a create).
  reloadKey?: unknown;
  // Renders the current page's items — this component only owns paging mechanics, never layout.
  children: (items: T[]) => ReactNode;
}

export default function Paginated<T>({ fetchPage, pageSize, reloadKey, children }: PaginatedProps<T>) {
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<T[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  // A pageSize change (e.g. from PageSizeSelect below) makes the current page number meaningless
  // against the new page boundaries — jump back to page 1 rather than let the fetch below land on
  // whatever this page number now happens to mean.
  useEffect(() => { setPage(1); }, [pageSize]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchPage(page, pageSize)
      .then(result => {
        if (cancelled) return;
        setItems(result.items);
        setTotal(result.total);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [page, pageSize, reloadKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  // A delete (or the reloadKey bump after one) can leave the current page past the new last page —
  // step back rather than show an empty page with Prev/Next controls that look broken.
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  return (
    <>
      {children(items)}
      {totalPages > 1 && (
        <div className="pager">
          <Button variant="outline" color="secondary" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1 || loading}>← Prev</Button>
          <span className="pager-info">Page {page} of {totalPages}</span>
          <Button variant="outline" color="secondary" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages || loading}>Next →</Button>
        </div>
      )}
    </>
  );
}

interface PageSizeSelectProps {
  value: number;
  onChange: (size: number) => void;
  options?: number[];
}

// Sits in whichever header the caller's tab already renders — Paginated itself never dictates
// where this goes, same "child owns layout" rule as the item list itself.
export function PageSizeSelect({ value, onChange, options = [10, 25, 50, 100] }: PageSizeSelectProps) {
  return (
    <select
      className="modal-select pager-size-select"
      value={value}
      onChange={e => onChange(Number(e.target.value))}
      aria-label="Items per page"
    >
      {options.map(n => <option key={n} value={n}>{n} per page</option>)}
    </select>
  );
}
