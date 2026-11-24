import type { HTMLAttributes, ReactNode } from 'react';

import { cn } from '@/lib/cn';

export const Card = ({ className, ...rest }: HTMLAttributes<HTMLDivElement>) => (
  <div {...rest} className={cn('rounded-[var(--radius-card)] border border-line bg-surface shadow-[var(--shadow-card)]', className)} />
);

export const CardHeader = ({
  title,
  description,
  actions,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) => (
  <div className={cn('flex flex-wrap items-start justify-between gap-3 px-5 pt-4 pb-3', className)}>
    <div className="min-w-0">
      <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
      {description && <p className="mt-0.5 text-[13px] text-ink-3">{description}</p>}
    </div>
    {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
  </div>
);
