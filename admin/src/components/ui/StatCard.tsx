import { ArrowDownRight, ArrowUpRight, Minus, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';
import { Card } from './Card';
import { Skeleton } from './Feedback';

/**
 * KPI tile: icon, one headline number, % change vs the previous period (when a base exists),
 * and a short caption. Change direction is shown with an arrow + sign + text, never colour alone.
 */
export const StatCard = ({
  icon: Icon,
  label,
  value,
  change,
  changeLabel,
  caption,
  loading,
  accent = 'navy',
  invert,
}: {
  icon: LucideIcon;
  label: string;
  value: ReactNode;
  /** Percent change; null = no comparable base, undefined = not applicable. */
  change?: number | null;
  changeLabel?: string;
  caption?: ReactNode;
  loading?: boolean;
  accent?: 'navy' | 'gold' | 'blue' | 'green' | 'violet' | 'red' | 'amber';
  /** A rise is bad (e.g. expired subscribers). */
  invert?: boolean;
}) => {
  const up = (change ?? 0) > 0.05;
  const down = (change ?? 0) < -0.05;
  const good = invert ? down : up;
  const bad = invert ? up : down;
  const TrendIcon = up ? ArrowUpRight : down ? ArrowDownRight : Minus;
  return (
    <Card className="flex flex-col gap-3 p-4 transition-shadow hover:shadow-[var(--shadow-pop)]">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[13px] font-medium text-ink-3">{label}</p>
        <span
          className={cn(
            'grid size-8 place-items-center rounded-lg',
            accent === 'navy' && 'bg-navy-900 text-gold-300 dark:bg-gold-300/10',
            accent === 'gold' && 'bg-gold-100 dark:bg-gold-300/10 text-gold-700 dark:text-gold-300',
            accent === 'blue' && 'bg-sky-50 dark:bg-sky-500/10 text-sky-700 dark:text-sky-400',
            accent === 'green' && 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
            accent === 'violet' && 'bg-violet-50 dark:bg-violet-500/10 text-violet-700 dark:text-violet-400',
            accent === 'red' && 'bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400',
            accent === 'amber' && 'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400',
          )}
          aria-hidden
        >
          <Icon className="size-4" />
        </span>
      </div>
      {loading ? (
        <>
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-4 w-32" />
        </>
      ) : (
        <>
          <p className="text-[28px] leading-none font-semibold tracking-tight text-ink tabular">{value}</p>
          <div className="flex min-h-5 flex-wrap items-center gap-x-2 gap-y-1 text-[12px]">
            {change !== undefined && (
              <span
                className={cn(
                  'inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 font-semibold tabular',
                  change === null && 'bg-surface-3 text-ink-3',
                  change !== null && good && 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
                  change !== null && bad && 'bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400',
                  change !== null && !good && !bad && 'bg-surface-3 text-ink-2',
                )}
              >
                {change === null ? (
                  'New'
                ) : (
                  <>
                    <TrendIcon className="size-3.5" aria-hidden />
                    {`${change > 0 ? '+' : ''}${change.toFixed(Math.abs(change) < 10 ? 1 : 0)}%`}
                  </>
                )}
              </span>
            )}
            {changeLabel && <span className="text-ink-3">{changeLabel}</span>}
            {caption && <span className="text-ink-3">{caption}</span>}
          </div>
        </>
      )}
    </Card>
  );
};
