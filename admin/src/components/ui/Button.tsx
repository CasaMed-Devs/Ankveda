import { LoaderCircle, type LucideIcon } from 'lucide-react';
import type { ButtonHTMLAttributes } from 'react';

import { cn } from '@/lib/cn';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'gold' | 'dangerGhost';
type Size = 'sm' | 'md';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-primary text-on-primary hover:bg-primary-hover shadow-sm',
  secondary: 'bg-surface text-ink border border-line-strong hover:bg-surface-2 hover:border-line-strong shadow-xs',
  ghost: 'text-ink-2 hover:bg-surface-3 hover:text-ink',
  danger: 'bg-red-600 text-white hover:bg-red-700 shadow-sm disabled:bg-red-600/60',
  dangerGhost: 'text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10',
  gold: 'bg-gold-300 text-navy-950 hover:bg-gold-400 shadow-sm',
};

const SIZES: Record<Size, string> = {
  sm: 'h-8 px-3 text-[13px] gap-1.5 rounded-lg',
  md: 'h-10 px-4 text-sm gap-2 rounded-[10px]',
};

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  icon?: LucideIcon;
  loading?: boolean;
};

export const Button = ({ variant = 'secondary', size = 'md', icon: Icon, loading, disabled, className, children, ...rest }: ButtonProps) => (
  <button
    type="button"
    {...rest}
    disabled={disabled || loading}
    aria-busy={loading || undefined}
    className={cn(
      'inline-flex shrink-0 items-center justify-center font-semibold whitespace-nowrap transition-colors duration-150 select-none disabled:cursor-not-allowed disabled:opacity-60',
      VARIANTS[variant],
      SIZES[size],
      className,
    )}
  >
    {loading ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : Icon ? <Icon className="size-4" aria-hidden /> : null}
    {children}
  </button>
);

export const IconButton = ({ icon: Icon, label, className, ...rest }: Omit<ButtonProps, 'children'> & { icon: LucideIcon; label: string }) => (
  <button
    type="button"
    aria-label={label}
    title={label}
    {...rest}
    className={cn(
      'inline-flex size-9 items-center justify-center rounded-lg text-ink-2 transition-colors hover:bg-surface-3 hover:text-ink disabled:opacity-50',
      className,
    )}
  >
    <Icon className="size-[18px]" aria-hidden />
  </button>
);
