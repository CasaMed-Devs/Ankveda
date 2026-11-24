import type { ReactNode } from 'react';
import { useSearchParams } from 'react-router';

import { Avatar } from '@/components/ui/Feedback';
import { cn } from '@/lib/cn';
import { phone } from '@/lib/format';

export const PageIntro = ({ description, actions, className }: { description?: ReactNode; actions?: ReactNode; className?: string }) => (
  <div className={cn('mb-5 flex flex-wrap items-center justify-between gap-3', className)}>
    {description ? <p className="max-w-2xl text-[13px] text-ink-3">{description}</p> : <span />}
    {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
  </div>
);

/** Opens the global user drawer (?user=id) from anywhere. */
export const useOpenUser = () => {
  const [, setParams] = useSearchParams();
  return (userId: string) =>
    setParams((p) => {
      p.set('user', userId);
      return p;
    });
};

export const UserCell = ({ name, phone: p, sub }: { name: string | null; phone: string | null; sub?: ReactNode }) => (
  <div className="flex min-w-0 items-center gap-3">
    <Avatar name={name} className="size-8 text-[11px]" />
    <div className="min-w-0">
      <p className={cn('truncate font-semibold', name ? 'text-ink' : 'text-ink-3 italic')}>{name ?? 'Name not set'}</p>
      <p className="truncate text-[12px] text-ink-3 tabular">{sub ?? phone(p)}</p>
    </div>
  </div>
);

export const DescList = ({ items, className }: { items: { label: string; value: ReactNode }[]; className?: string }) => (
  <dl className={cn('grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2', className)}>
    {items.map((i) => (
      <div key={i.label} className="min-w-0">
        <dt className="text-[11px] font-semibold tracking-wide text-ink-3 uppercase">{i.label}</dt>
        <dd className="mt-0.5 min-w-0 text-[13px] break-words text-ink">{i.value ?? '—'}</dd>
      </div>
    ))}
  </dl>
);
