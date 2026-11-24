import { ChevronLeft, ChevronRight, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';
import { number } from '@/lib/format';
import { PAGE_SIZES } from '@/lib/queries';
import { EmptyState, ErrorState, Skeleton } from './Feedback';

export type Column<T> = {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  className?: string;
  /** Hide on narrow screens (the row click / drawer still shows everything). */
  hideBelow?: 'sm' | 'md' | 'lg' | 'xl' | '2xl';
  align?: 'left' | 'right';
};

const HIDE = { sm: 'hidden sm:table-cell', md: 'hidden md:table-cell', lg: 'hidden lg:table-cell', xl: 'hidden xl:table-cell', '2xl': 'hidden 2xl:table-cell' };

export const DataTable = <T,>({
  columns,
  rows,
  rowKey,
  loading,
  error,
  onRetry,
  onRowClick,
  empty,
  fetching,
  skeletonRows = 8,
  rowLabel,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  onRowClick?: (row: T) => void;
  empty?: { icon?: LucideIcon; title: string; body?: ReactNode; action?: ReactNode };
  fetching?: boolean;
  skeletonRows?: number;
  rowLabel?: (row: T) => string;
}) => {
  if (error && !rows.length) return <ErrorState error={error} onRetry={onRetry} />;
  return (
    <div className={cn('relative overflow-x-auto scrollbar-thin', fetching && !loading && 'opacity-70 transition-opacity')}>
      <table className="w-full border-separate sm:min-w-[640px] border-spacing-0 text-left text-[13px]">
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                scope="col"
                className={cn(
                  'sticky top-0 z-[1] border-y border-line bg-surface-2/95 px-4 py-2.5 text-[11px] font-semibold tracking-wide text-ink-3 uppercase backdrop-blur',
                  c.align === 'right' && 'text-right',
                  c.hideBelow && HIDE[c.hideBelow],
                  c.className,
                )}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading
            ? Array.from({ length: skeletonRows }, (_, i) => (
                <tr key={i}>
                  {columns.map((c) => (
                    <td key={c.key} className={cn('border-b border-line px-4 py-3.5', c.hideBelow && HIDE[c.hideBelow])}>
                      <Skeleton className="h-4 w-[70%]" />
                    </td>
                  ))}
                </tr>
              ))
            : rows.map((row) => (
                <tr
                  key={rowKey(row)}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  onKeyDown={onRowClick ? (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onRowClick(row)) : undefined}
                  tabIndex={onRowClick ? 0 : undefined}
                  aria-label={onRowClick && rowLabel ? rowLabel(row) : undefined}
                  className={cn('group transition-colors', onRowClick && 'cursor-pointer hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none')}
                >
                  {columns.map((c) => (
                    <td
                      key={c.key}
                      className={cn(
                        'border-b border-line px-4 py-3 align-middle text-ink-2',
                        c.align === 'right' && 'text-right tabular',
                        c.hideBelow && HIDE[c.hideBelow],
                        c.className,
                      )}
                    >
                      {c.cell(row)}
                    </td>
                  ))}
                </tr>
              ))}
        </tbody>
      </table>
      {!loading && rows.length === 0 && <EmptyState {...(empty ?? { title: 'Nothing here yet' })} />}
    </div>
  );
};

export const Pagination = ({
  page,
  pageSize,
  total,
  count,
  hasNext,
  hasPrev,
  onNext,
  onPrev,
  onPageSize,
  busy,
}: {
  page: number;
  pageSize: number;
  total: number | null;
  count: number;
  hasNext: boolean;
  hasPrev: boolean;
  onNext: () => void;
  onPrev: () => void;
  onPageSize: (n: number) => void;
  busy?: boolean;
}) => {
  const start = count ? (page - 1) * pageSize + 1 : 0;
  const end = (page - 1) * pageSize + count;
  const pages = total !== null ? Math.max(1, Math.ceil(total / pageSize)) : null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-[13px] text-ink-3">
      <div className="flex items-center gap-2">
        <label htmlFor="page-size">Rows</label>
        <select
          id="page-size"
          value={pageSize}
          onChange={(e) => onPageSize(Number(e.target.value))}
          className="h-8 rounded-lg border border-line-strong bg-surface px-2 text-[13px] text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-series-1/30"
        >
          {PAGE_SIZES.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-center gap-3">
        <span className="tabular" aria-live="polite">
          {count ? `${number(start)}–${number(end)}` : '0'}
          {total !== null && ` of ${number(total)}`}
          {pages !== null && <span className="hidden sm:inline"> · page {page} of {number(pages)}</span>}
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onPrev}
            disabled={!hasPrev || busy}
            aria-label="Previous page"
            className="grid size-8 place-items-center rounded-lg border border-line-strong bg-surface text-ink transition hover:bg-surface-2 disabled:opacity-40"
          >
            <ChevronLeft className="size-4" />
          </button>
          <button
            type="button"
            onClick={onNext}
            disabled={!hasNext || busy}
            aria-label="Next page"
            className="grid size-8 place-items-center rounded-lg border border-line-strong bg-surface text-ink transition hover:bg-surface-2 disabled:opacity-40"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>
      </div>
    </div>
  );
};
