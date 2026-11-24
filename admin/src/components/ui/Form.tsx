import { ChevronDown, Search, X } from 'lucide-react';
import { forwardRef, useEffect, useId, useState, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';

import { cn } from '@/lib/cn';
import { addDays, istKey } from '@/lib/format';

const control =
  'w-full rounded-[10px] border border-line-strong bg-surface px-3 text-sm text-ink shadow-xs transition-colors placeholder:text-placeholder hover:border-line-strong focus:border-series-1 focus:ring-3 focus:ring-series-1/15 focus:outline-none disabled:bg-surface-2 disabled:text-ink-3 aria-invalid:border-red-400 aria-invalid:ring-red-500/15';

export const Field = ({
  label,
  hint,
  error,
  children,
  htmlFor,
  className,
  optional,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  children: ReactNode;
  htmlFor?: string;
  className?: string;
  optional?: boolean;
}) => (
  <div className={cn('flex flex-col gap-1.5', className)}>
    <label htmlFor={htmlFor} className="text-[13px] font-semibold text-ink">
      {label}
      {optional && <span className="ml-1 font-normal text-ink-3">(optional)</span>}
    </label>
    {children}
    {error ? (
      <p className="text-[12px] font-medium text-red-700 dark:text-red-400" role="alert">
        {error}
      </p>
    ) : hint ? (
      <p className="text-[12px] text-ink-3">{hint}</p>
    ) : null}
  </div>
);

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { leading?: ReactNode; trailing?: ReactNode }>(
  ({ className, leading, trailing, ...rest }, ref) =>
    leading || trailing ? (
      <div className="relative">
        {leading && <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-ink-3">{leading}</span>}
        <input ref={ref} {...rest} className={cn(control, 'h-10', leading && 'pl-8', trailing && 'pr-10', className)} />
        {trailing && <span className="absolute inset-y-0 right-1.5 flex items-center">{trailing}</span>}
      </div>
    ) : (
      <input ref={ref} {...rest} className={cn(control, 'h-10', className)} />
    ),
);
Input.displayName = 'Input';

export const Textarea = (props: TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...props} className={cn(control, 'min-h-20 py-2', props.className)} />;

export const Select = ({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) => (
  <div className={cn('relative', className)}>
    <select {...rest} className={cn(control, 'h-10 cursor-pointer appearance-none pr-9')}>
      {children}
    </select>
    <ChevronDown className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
  </div>
);

export const Switch = ({ checked, onChange, label, description, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; description?: ReactNode; disabled?: boolean }) => {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <label htmlFor={id} className="text-[13px] font-semibold text-ink">
          {label}
        </label>
        {description && <p className="mt-0.5 text-[12px] text-ink-3">{description}</p>}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative h-6 w-11 shrink-0 rounded-full transition-colors duration-200 disabled:opacity-50',
          checked ? 'bg-primary' : 'bg-line-strong',
        )}
      >
        <span className={cn('absolute top-0.5 left-0.5 size-5 rounded-full bg-surface shadow transition-transform duration-200', checked && 'translate-x-5')} />
      </button>
    </div>
  );
};

export const Segmented = <T extends string>({
  value,
  onChange,
  options,
  size = 'md',
  label,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode }[];
  size?: 'sm' | 'md';
  label: string;
}) => (
  <div role="radiogroup" aria-label={label} className="inline-flex max-w-full overflow-x-auto rounded-[10px] border border-line bg-surface-3 p-0.5 scrollbar-thin">
    {options.map((o) => (
      <button
        key={o.value}
        type="button"
        role="radio"
        aria-checked={value === o.value}
        onClick={() => onChange(o.value)}
        className={cn(
          'shrink-0 rounded-lg font-semibold whitespace-nowrap transition-all duration-150',
          size === 'sm' ? 'h-7 px-2.5 text-[12px]' : 'h-8 px-3 text-[13px]',
          value === o.value ? 'bg-surface text-ink shadow-sm ring-1 ring-line' : 'text-ink-3 hover:text-ink',
        )}
      >
        {o.label}
      </button>
    ))}
  </div>
);

/** Debounced search box (300 ms) — avoids a backend query per keystroke. */
export const SearchInput = ({ value, onChange, placeholder, className, autoFocus }: { value: string; onChange: (v: string) => void; placeholder: string; className?: string; autoFocus?: boolean }) => {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  useEffect(() => {
    if (text === value) return;
    const t = setTimeout(() => onChange(text.trim()), 300);
    return () => clearTimeout(t);
  }, [text, value, onChange]);
  return (
    <Input
      type="search"
      value={text}
      autoFocus={autoFocus}
      onChange={(e) => setText(e.target.value)}
      placeholder={placeholder}
      aria-label={placeholder}
      className={className}
      leading={<Search className="size-4" />}
      trailing={
        text ? (
          <button type="button" aria-label="Clear search" onClick={() => setText('')} className="rounded-md p-1.5 text-ink-3 hover:bg-surface-3 hover:text-ink">
            <X className="size-3.5" />
          </button>
        ) : undefined
      }
    />
  );
};

// ── Date range ───────────────────────────────────────────────────────────────

export type RangePreset = 'today' | '7d' | '30d' | '90d' | 'custom';
export type DateRange = { preset: RangePreset; from: string; to: string };

export const rangeFor = (preset: Exclude<RangePreset, 'custom'>): DateRange => {
  const to = istKey();
  const days = { today: 1, '7d': 7, '30d': 30, '90d': 90 }[preset];
  return { preset, from: addDays(to, -(days - 1)), to };
};

/** Today / 7 / 30 / 90 days / custom (IST calendar days, inclusive). */
export const DateRangeFilter = ({ value, onChange, maxDays = 366 }: { value: DateRange; onChange: (r: DateRange) => void; maxDays?: number }) => {
  const [draft, setDraft] = useState({ from: value.from, to: value.to });
  useEffect(() => setDraft({ from: value.from, to: value.to }), [value.from, value.to]);
  const today = istKey();
  const invalid = draft.from > draft.to ? 'Start must be before end' : (Date.parse(draft.to) - Date.parse(draft.from)) / 86_400_000 >= maxDays ? `Max ${maxDays} days` : null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Segmented
        label="Date range"
        value={value.preset}
        onChange={(p) => (p === 'custom' ? onChange({ ...value, preset: 'custom' }) : onChange(rangeFor(p)))}
        options={[
          { value: 'today', label: 'Today' },
          { value: '7d', label: '7 days' },
          { value: '30d', label: '30 days' },
          { value: '90d', label: '90 days' },
          { value: 'custom', label: 'Custom' },
        ]}
      />
      {value.preset === 'custom' && (
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="date"
            aria-label="From date"
            max={today}
            value={draft.from}
            onChange={(e) => setDraft((d) => ({ ...d, from: e.target.value }))}
            className={cn(control, 'h-9 w-[150px]')}
          />
          <span className="text-ink-3">–</span>
          <input
            type="date"
            aria-label="To date"
            max={today}
            value={draft.to}
            onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value }))}
            className={cn(control, 'h-9 w-[150px]')}
          />
          <button
            type="button"
            disabled={!!invalid || !draft.from || !draft.to}
            onClick={() => onChange({ preset: 'custom', ...draft })}
            className="h-9 rounded-[10px] bg-primary px-3 text-[13px] font-semibold text-on-primary hover:bg-primary-hover disabled:opacity-50"
          >
            Apply
          </button>
          {invalid && <span className="text-[12px] font-medium text-red-700 dark:text-red-400">{invalid}</span>}
        </div>
      )}
    </div>
  );
};
