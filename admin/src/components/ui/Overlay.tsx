import { CircleCheck, CircleExclamationPoint, Info, X } from 'lucide-react';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import { cn } from '@/lib/cn';
import { IconButton } from './Button';

/** Escape to close, focus moved into the panel and restored afterwards, body scroll locked. */
const useDialog = (open: boolean, onClose: () => void) => {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    requestAnimationFrame(() => {
      const target = panel.current?.querySelector<HTMLElement>('[data-autofocus], input, select, textarea, button:not([data-close])');
      (target ?? panel.current)?.focus();
    });
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      previous?.focus?.();
    };
  }, [open, onClose]);
  return panel;
};

export const Modal = ({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
  tone = 'default',
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  tone?: 'default' | 'danger';
}) => {
  const panel = useDialog(open, onClose);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4">
      <div className="absolute inset-0 animate-fade-in bg-navy-950/45 backdrop-blur-[2px]" onClick={onClose} aria-hidden />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : undefined}
        tabIndex={-1}
        className={cn(
          'relative flex max-h-[92vh] w-full animate-pop-in flex-col overflow-hidden rounded-t-2xl bg-surface shadow-[var(--shadow-pop)] outline-none sm:rounded-2xl',
          size === 'sm' && 'sm:max-w-md',
          size === 'md' && 'sm:max-w-lg',
          size === 'lg' && 'sm:max-w-2xl',
        )}
      >
        <div className={cn('flex items-start gap-3 border-b px-5 pt-5 pb-4', tone === 'danger' ? 'border-red-100 dark:border-red-500/25' : 'border-line')}>
          <div className="min-w-0 flex-1">
            <h2 className={cn('text-base font-semibold', tone === 'danger' ? 'text-red-800 dark:text-red-300' : 'text-ink')}>{title}</h2>
            {description && <p className="mt-1 text-[13px] text-ink-3">{description}</p>}
          </div>
          <IconButton icon={X} label="Close" onClick={onClose} data-close className="-mt-1 -mr-2" />
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4 scrollbar-thin">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line bg-surface-2 px-5 py-3">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
};

export const Drawer = ({ open, onClose, title, children, header, width = 'max-w-2xl' }: { open: boolean; onClose: () => void; title: string; children: ReactNode; header?: ReactNode; width?: string }) => {
  const panel = useDialog(open, onClose);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-40">
      <div className="absolute inset-0 animate-fade-in bg-navy-950/35" onClick={onClose} aria-hidden />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={cn('absolute inset-y-0 right-0 flex w-full animate-slide-in flex-col bg-canvas shadow-[var(--shadow-pop)] outline-none', width)}
      >
        <div className="flex items-start gap-3 border-b border-line bg-surface px-5 py-4">
          <div className="min-w-0 flex-1">{header ?? <h2 className="text-base font-semibold">{title}</h2>}</div>
          <IconButton icon={X} label="Close" onClick={onClose} data-close className="-mr-2" />
        </div>
        <div className="flex-1 overflow-y-auto scrollbar-thin">{children}</div>
      </div>
    </div>,
    document.body,
  );
};

// ── Toasts ───────────────────────────────────────────────────────────────────

type Toast = { id: number; tone: 'success' | 'error' | 'info'; title: string; body?: string };
type ToastApi = { success: (title: string, body?: string) => void; error: (title: string, body?: string) => void; info: (title: string, body?: string) => void };

const ToastContext = createContext<ToastApi | null>(null);

export const ToastProvider = ({ children }: { children: ReactNode }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((tone: Toast['tone'], title: string, body?: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-3), { id, tone, title, body }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === 'error' ? 8000 : 4500);
  }, []);
  const [api] = useState<ToastApi>(() => ({
    success: (t, b) => push('success', t, b),
    error: (t, b) => push('error', t, b),
    info: (t, b) => push('info', t, b),
  }));
  return (
    <ToastContext.Provider value={api}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed right-4 bottom-4 left-4 z-[60] flex flex-col items-end gap-2 sm:left-auto">
        {toasts.map((t) => {
          const Icon = t.tone === 'success' ? CircleCheck : t.tone === 'error' ? CircleExclamationPoint : Info;
          return (
            <div
              key={t.id}
              role={t.tone === 'error' ? 'alert' : 'status'}
              className="pointer-events-auto flex w-full max-w-sm animate-pop-in gap-3 rounded-xl border border-line bg-surface p-3.5 shadow-[var(--shadow-pop)]"
            >
              <Icon className={cn('mt-0.5 size-5 shrink-0', t.tone === 'success' ? 'text-emerald-600 dark:text-emerald-400' : t.tone === 'error' ? 'text-red-600 dark:text-red-400' : 'text-sky-600 dark:text-sky-400')} aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-semibold text-ink">{t.title}</p>
                {t.body && <p className="mt-0.5 text-[12px] break-words text-ink-3">{t.body}</p>}
              </div>
              <button type="button" aria-label="Dismiss" onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))} className="self-start rounded p-0.5 text-ink-3 hover:text-ink">
                <X className="size-4" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
};

export const useToast = () => {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast outside ToastProvider');
  return ctx;
};
