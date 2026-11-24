import { Check, CircleExclamationPoint, Copy, Inbox, RefreshCw, type LucideIcon } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { initials } from '@/lib/format';
import { Button } from './Button';

export const Skeleton = ({ className }: { className?: string }) => <div className={cn('animate-pulse rounded-md bg-surface-3', className)} aria-hidden />;

export const EmptyState = ({
  icon: Icon = Inbox,
  title,
  body,
  action,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  body?: ReactNode;
  action?: ReactNode;
  className?: string;
}) => (
  <div className={cn('flex flex-col items-center justify-center px-6 py-12 text-center', className)}>
    <div className="mb-3 grid size-11 place-items-center rounded-full bg-surface-3 text-ink-3">
      <Icon className="size-5" aria-hidden />
    </div>
    <p className="font-semibold text-ink">{title}</p>
    {body && <p className="mt-1 max-w-sm text-[13px] text-ink-3">{body}</p>}
    {action && <div className="mt-4">{action}</div>}
  </div>
);

export const ErrorState = ({ error, onRetry, className }: { error: unknown; onRetry?: () => void; className?: string }) => (
  <div role="alert" className={cn('flex flex-col items-center justify-center px-6 py-10 text-center', className)}>
    <div className="mb-3 grid size-11 place-items-center rounded-full bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400">
      <CircleExclamationPoint className="size-5" aria-hidden />
    </div>
    <p className="font-semibold text-ink">Couldn’t load this</p>
    <p className="mt-1 max-w-md text-[13px] text-ink-3">{errorMessage(error)}</p>
    {onRetry && (
      <Button size="sm" icon={RefreshCw} className="mt-4" onClick={onRetry}>
        Try again
      </Button>
    )}
  </div>
);

export const InlineAlert = ({ tone = 'warning', children, className }: { tone?: 'warning' | 'danger' | 'info'; children: ReactNode; className?: string }) => (
  <div
    role={tone === 'danger' ? 'alert' : 'status'}
    className={cn(
      'flex gap-2.5 rounded-xl border px-3.5 py-3 text-[13px] leading-relaxed',
      tone === 'warning' && 'border-amber-200 dark:border-amber-500/25 bg-amber-50 dark:bg-amber-500/10 text-amber-900 dark:text-amber-300',
      tone === 'danger' && 'border-red-200 dark:border-red-500/25 bg-red-50 dark:bg-red-500/10 text-red-900 dark:text-red-300',
      tone === 'info' && 'border-sky-200 dark:border-sky-500/25 bg-sky-50 dark:bg-sky-500/10 text-sky-900 dark:text-sky-300',
      className,
    )}
  >
    <CircleExclamationPoint className="mt-0.5 size-4 shrink-0" aria-hidden />
    <div className="min-w-0">{children}</div>
  </div>
);

export const Avatar = ({ name, className }: { name: string | null | undefined; className?: string }) => (
  <span
    aria-hidden
    className={cn(
      'grid size-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-gold-200 to-gold-300 text-[12px] font-bold text-navy-900',
      className,
    )}
  >
    {initials(name, '·')}
  </span>
);

/** Monospace id with a copy button (ids get pasted into Razorpay / support tools). */
export const CopyText = ({ value, className, truncate = true }: { value: string | null | undefined; className?: string; truncate?: boolean }) => {
  const [copied, setCopied] = useState(false);
  if (!value) return <span className="text-ink-3">—</span>;
  return (
    <span className={cn('group inline-flex max-w-full items-center gap-1', className)}>
      <code className={cn('font-mono text-[12px] text-ink-2', truncate && 'truncate')} title={value}>
        {value}
      </code>
      <button
        type="button"
        aria-label={`Copy ${value}`}
        onClick={(e) => {
          e.stopPropagation();
          void navigator.clipboard?.writeText(value).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          });
        }}
        className="shrink-0 rounded p-0.5 text-ink-3 opacity-60 transition group-hover:opacity-100 hover:bg-surface-3 hover:text-ink"
      >
        {copied ? <Check className="size-3.5 text-emerald-600 dark:text-emerald-400" /> : <Copy className="size-3.5" />}
      </button>
    </span>
  );
};
