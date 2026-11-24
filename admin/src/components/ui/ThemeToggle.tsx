import { Moon, Sun } from 'lucide-react';

import { cn } from '@/lib/cn';
import { useTheme } from '@/lib/theme';

/** Sun / moon button. Announces the theme it switches TO. */
export const ThemeToggle = ({ className }: { className?: string }) => {
  const { theme, toggle } = useTheme();
  const next = theme === 'dark' ? 'light' : 'dark';
  const Icon = theme === 'dark' ? Sun : Moon;
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={`Switch to ${next} mode`}
      title={`Switch to ${next} mode`}
      className={cn('grid size-9 place-items-center rounded-lg text-ink-2 transition-colors hover:bg-surface-3 hover:text-ink', className)}
    >
      <Icon className="size-[18px]" aria-hidden />
    </button>
  );
};
