import {
  Bell,
  ChartColumn,
  ChevronRight,
  CreditCard,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  Receipt,
  ScrollText,
  Search,
  Settings,
  Sun,
  Tags,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate, useSearchParams } from 'react-router';

import { useAuth } from '@/auth/AuthProvider';
import { UserDrawer } from '@/pages/users/UserDrawer';
import { setApiEnv } from '@/lib/api';
import { cn } from '@/lib/cn';
import { ENVIRONMENTS, envKeys, loadEnv, saveEnv, type EnvKey } from '@/lib/env';
import { relative } from '@/lib/format';
import { queryClient, useActivity } from '@/lib/queries';
import { useTheme } from '@/lib/theme';
import { ThemeToggle } from '@/components/ui/ThemeToggle';

type NavItem = { to: string; label: string; icon: LucideIcon; end?: boolean };

export const NAV: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/users', label: 'Users', icon: Users },
  { to: '/subscriptions', label: 'Subscriptions', icon: CreditCard },
  { to: '/payments', label: 'Payments', icon: Receipt },
  { to: '/pricing', label: 'Paywall & Pricing', icon: Tags },
  { to: '/analytics', label: 'Analytics', icon: ChartColumn },
  { to: '/activity', label: 'Admin Activity', icon: ScrollText },
  { to: '/settings', label: 'Settings', icon: Settings },
];

const BrandMark = () => (
  <div className="flex items-center gap-2.5 px-2">
    <span className="grid size-9 place-items-center rounded-xl bg-gradient-to-br from-gold-200 to-gold-400 font-display text-xl font-bold text-navy-950 shadow-[0_0_24px_-4px_rgb(233_199_131/0.5)]">
      A
    </span>
    <div className="leading-tight">
      <p className="font-display text-[22px] font-semibold tracking-wide text-gold-200">Ankveda</p>
      <p className="-mt-0.5 text-[10px] font-semibold tracking-[0.2em] text-slate-400 uppercase">Admin console</p>
    </div>
  </div>
);

const Sidebar = ({ onNavigate }: { onNavigate?: () => void }) => {
  const auth = useAuth();
  return (
    <nav aria-label="Main" className="flex h-full flex-col border-r border-white/[0.06] bg-sidebar bg-[radial-gradient(120%_60%_at_0%_0%,rgb(233_199_131/0.08),transparent_60%)] px-3 py-5 text-slate-300">
      <BrandMark />
      <ul className="mt-8 flex flex-1 flex-col gap-0.5">
        {NAV.map((item) => (
          <li key={item.to}>
            <NavLink
              to={item.to}
              end={item.end}
              onClick={onNavigate}
              className={({ isActive }) =>
                cn(
                  'group relative flex h-10 items-center gap-3 rounded-lg px-3 text-[13.5px] font-medium transition-colors duration-150',
                  isActive ? 'bg-white/[0.07] text-white' : 'text-slate-400 hover:bg-white/[0.04] hover:text-slate-100',
                )
              }
            >
              {({ isActive }) => (
                <>
                  <span className={cn('absolute top-2 bottom-2 left-0 w-[3px] rounded-r-full bg-gold-300 transition-opacity', isActive ? 'opacity-100' : 'opacity-0')} aria-hidden />
                  <item.icon className={cn('size-[18px]', isActive ? 'text-gold-300' : 'text-slate-500 group-hover:text-slate-300')} aria-hidden />
                  {item.label}
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={() => void auth.signOut()}
        className="flex h-10 items-center gap-3 rounded-lg px-3 text-[13.5px] font-medium text-slate-400 transition-colors hover:bg-white/[0.04] hover:text-slate-100"
      >
        <LogOut className="size-[18px] text-slate-500" aria-hidden />
        Logout
      </button>
    </nav>
  );
};

const Notifications = () => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const activity = useActivity();
  const items = activity.data?.notifications ?? [];
  const [, setParams] = useSearchParams();
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        aria-label={`Notifications${items.length ? ` (${items.length})` : ''}`}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="relative grid size-9 place-items-center rounded-lg text-ink-2 transition-colors hover:bg-surface-3 hover:text-ink"
      >
        <Bell className="size-[18px]" />
        {items.length > 0 && (
          <span className="absolute top-1 right-1 grid min-w-4 place-items-center rounded-full bg-red-600 px-1 text-[10px] leading-4 font-bold text-white">
            {items.length > 9 ? '9+' : items.length}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-2 w-[min(92vw,360px)] animate-pop-in overflow-hidden rounded-xl border border-line bg-surface shadow-[var(--shadow-pop)]">
          <div className="border-b border-line px-4 py-3">
            <p className="text-[13px] font-semibold">Needs attention</p>
            <p className="text-[12px] text-ink-3">Failed payments (7 days), payment retries and stopped deletions</p>
          </div>
          <ul className="max-h-96 overflow-y-auto scrollbar-thin">
            {items.length === 0 ? (
              <li className="px-4 py-8 text-center text-[13px] text-ink-3">All clear — nothing needs attention.</li>
            ) : (
              items.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      if (n.kind !== 'deletion_failed') setParams((p) => (p.set('user', n.userId), p));
                    }}
                    className="flex w-full gap-3 border-b border-line px-4 py-3 text-left last:border-0 hover:bg-surface-2"
                  >
                    <span className={cn('mt-1.5 size-2 shrink-0 rounded-full', n.kind === 'subscription_at_risk' ? 'bg-amber-500' : 'bg-red-500')} aria-hidden />
                    <span className="min-w-0">
                      <span className="block text-[13px] font-semibold text-ink">{n.title}</span>
                      <span className="block truncate text-[12px] text-ink-3">{n.body}</span>
                      <span className="block text-[11px] text-ink-3">{relative(n.at)}</span>
                    </span>
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  );
};

const AdminMenu = ({ env, onEnv }: { env: EnvKey; onEnv: (e: EnvKey) => void }) => {
  const auth = useAuth();
  const { theme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const email = auth.status === 'admin' ? (auth.user.email ?? 'Admin') : '';
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  return (
    <div className="relative" ref={ref}>
      <button type="button" aria-expanded={open} aria-label="Admin menu" onClick={() => setOpen((o) => !o)} className="flex items-center gap-2 rounded-lg p-1 pr-2 transition-colors hover:bg-surface-3">
        <span className="grid size-8 place-items-center rounded-full bg-navy-900 text-[12px] font-bold text-gold-300 dark:bg-gold-300/15">{email.slice(0, 1).toUpperCase()}</span>
        <span className="hidden max-w-40 truncate text-[13px] font-medium text-ink lg:block">{email}</span>
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-2 w-64 animate-pop-in overflow-hidden rounded-xl border border-line bg-surface py-1 shadow-[var(--shadow-pop)]">
          <div className="border-b border-line px-4 py-3">
            <p className="text-[11px] font-semibold tracking-wide text-ink-3 uppercase">Signed in as</p>
            <p className="truncate text-[13px] font-semibold">{email}</p>
          </div>
          {envKeys().length > 1 && (
            <div className="border-b border-line px-4 py-3">
              <label htmlFor="env" className="text-[11px] font-semibold tracking-wide text-ink-3 uppercase">
                Backend
              </label>
              <select id="env" value={env} onChange={(e) => onEnv(e.target.value as EnvKey)} className="mt-1 h-8 w-full rounded-lg border border-line-strong bg-surface px-2 text-[13px]">
                {envKeys().map((k) => (
                  <option key={k} value={k}>
                    {ENVIRONMENTS[k].label}
                  </option>
                ))}
              </select>
            </div>
          )}
          <button
            type="button"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            className="flex w-full items-center gap-2 px-4 py-2 text-left text-[13px] hover:bg-surface-2"
          >
            {theme === 'dark' ? <Sun className="size-4 text-ink-3" /> : <Moon className="size-4 text-ink-3" />}
            {theme === 'dark' ? 'Light mode' : 'Dark mode'}
          </button>
          <Link to="/settings" onClick={() => setOpen(false)} className="flex items-center gap-2 px-4 py-2 text-[13px] hover:bg-surface-2">
            <Settings className="size-4 text-ink-3" /> Settings
          </Link>
          <button type="button" onClick={() => void auth.signOut()} className="flex w-full items-center gap-2 px-4 py-2 text-left text-[13px] text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10">
            <LogOut className="size-4" /> Sign out
          </button>
        </div>
      )}
    </div>
  );
};

const GlobalSearch = () => {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!q.trim()) return;
    navigate(`/users?q=${encodeURIComponent(q.trim())}`);
    setQ('');
  };
  return (
    <form onSubmit={submit} role="search" className="relative hidden w-full max-w-xs md:block">
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search users by name, phone or ID…"
        aria-label="Search users"
        className="h-9 w-full rounded-[10px] border border-line bg-surface-2 pr-3 pl-9 text-[13px] transition-colors placeholder:text-placeholder focus:border-series-1 focus:bg-surface focus:outline-none"
      />
    </form>
  );
};

export const AppShell = () => {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [env, setEnv] = useState<EnvKey>(loadEnv);
  const location = useLocation();
  const current = NAV.find((n) => (n.end ? location.pathname === n.to : location.pathname.startsWith(n.to))) ?? NAV[0]!;
  const [params, setParams] = useSearchParams();
  const userId = params.get('user');

  const changeEnv = (key: EnvKey) => {
    saveEnv(key);
    setApiEnv(key);
    queryClient.clear();
    setEnv(key);
  };

  useEffect(() => setMobileOpen(false), [location.pathname]);
  useEffect(() => {
    document.title = `${current.label} · Ankveda Admin`;
  }, [current.label]);

  return (
    <div className="min-h-dvh lg:pl-64">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 lg:block">
        <Sidebar />
      </aside>
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 animate-fade-in bg-navy-950/50" onClick={() => setMobileOpen(false)} aria-hidden />
          <div className="absolute inset-y-0 left-0 w-72 max-w-[85vw] animate-slide-in">
            <Sidebar onNavigate={() => setMobileOpen(false)} />
            <button type="button" aria-label="Close menu" onClick={() => setMobileOpen(false)} className="absolute top-5 right-3 rounded-lg p-1.5 text-slate-400 hover:bg-white/10 hover:text-white">
              <X className="size-5" />
            </button>
          </div>
        </div>
      )}

      <header className="sticky top-0 z-20 border-b border-line bg-surface/85 backdrop-blur-md">
        <div className="flex h-16 items-center gap-3 px-4 sm:px-6">
          <button type="button" aria-label="Open menu" onClick={() => setMobileOpen(true)} className="-ml-1 rounded-lg p-2 text-ink-2 hover:bg-surface-3 lg:hidden">
            <Menu className="size-5" />
          </button>
          <div className="min-w-0 flex-1">
            <nav aria-label="Breadcrumb" className="hidden items-center gap-1 text-[12px] text-ink-3 sm:flex">
              <Link to="/" className="hover:text-ink">
                Admin
              </Link>
              <ChevronRight className="size-3" aria-hidden />
              <span aria-current="page">{current.label}</span>
            </nav>
            <h1 className="truncate text-[17px] leading-tight font-semibold text-ink">{current.label}</h1>
          </div>
          <GlobalSearch />
          <span
            className={cn(
              'hidden rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 sm:inline-flex',
              ENVIRONMENTS[env].tone === 'live' ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-800 dark:text-emerald-300 ring-emerald-200 dark:ring-emerald-500/25' : 'bg-amber-50 dark:bg-amber-500/10 text-amber-800 dark:text-amber-300 ring-amber-200 dark:ring-amber-500/25',
            )}
          >
            {ENVIRONMENTS[env].label}
          </span>
          <ThemeToggle />
          <Notifications key={`n-${env}`} />
          <AdminMenu env={env} onEnv={changeEnv} />
        </div>
      </header>

      <main key={env} className="mx-auto w-full max-w-[1440px] px-4 py-6 sm:px-6 lg:py-8">
        <Outlet />
      </main>

      <UserDrawer
        userId={userId}
        onClose={() =>
          setParams((p) => {
            p.delete('user');
            return p;
          })
        }
      />
    </div>
  );
};
