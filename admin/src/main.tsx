import './index.css';

import { QueryClientProvider } from '@tanstack/react-query';
import { LoaderCircle } from 'lucide-react';
import { lazy, StrictMode, Suspense, type ComponentType, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, Navigate, RouterProvider, useLocation } from 'react-router';

import { AuthProvider, useAuth } from '@/auth/AuthProvider';
import { ToastProvider } from '@/components/ui/Overlay';
import { queryClient } from '@/lib/queries';
import { ThemeProvider } from '@/lib/theme';
import { LoginPage } from '@/pages/Login';

// Pages are code-split: the login screen never downloads charts or tables.
const page = <K extends string>(load: () => Promise<Record<K, ComponentType>>, name: K) =>
  lazy(async () => ({ default: (await load())[name] }));
const AppShell = page(() => import('@/components/layout/AppShell'), 'AppShell');
const DashboardPage = page(() => import('@/pages/Dashboard'), 'DashboardPage');
const UsersPage = page(() => import('@/pages/users/UsersPage'), 'UsersPage');
const SubscriptionsPage = page(() => import('@/pages/SubscriptionsPage'), 'SubscriptionsPage');
const PaymentsPage = page(() => import('@/pages/PaymentsPage'), 'PaymentsPage');
const PricingPage = page(() => import('@/pages/PricingPage'), 'PricingPage');
const AnalyticsPage = page(() => import('@/pages/AnalyticsPage'), 'AnalyticsPage');
const ActivityPage = page(() => import('@/pages/ActivityPage'), 'ActivityPage');
const MetaEventsPage = page(() => import('@/pages/MetaEventsPage'), 'MetaEventsPage');
const SettingsPage = page(() => import('@/pages/SettingsPage'), 'SettingsPage');

const PageLoading = () => (
  <div className="grid gap-4" aria-busy="true" aria-label="Loading page">
    <div className="h-8 w-1/3 animate-pulse rounded-lg bg-surface-3" />
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {Array.from({ length: 4 }, (_, i) => (
        <div key={i} className="h-28 animate-pulse rounded-[14px] bg-surface-3" />
      ))}
    </div>
    <div className="h-80 animate-pulse rounded-[14px] bg-surface-3" />
  </div>
);
const lazyEl = (Component: ComponentType) => (
  <Suspense fallback={<PageLoading />}>
    <Component />
  </Suspense>
);

const Splash = () => (
  <div className="grid min-h-dvh place-items-center bg-sidebar">
    <div className="flex flex-col items-center gap-4">
      <span className="font-display text-3xl font-semibold tracking-wide text-gold-200">Ankveda</span>
      <LoaderCircle className="size-5 animate-spin text-gold-300" aria-label="Loading" />
    </div>
  </div>
);

/** Unauthenticated or non-admin → login (with the page to return to). The server enforces the same rule. */
const RequireAdmin = ({ children }: { children: ReactNode }) => {
  const auth = useAuth();
  const location = useLocation();
  if (auth.status === 'loading') return <Splash />;
  if (auth.status !== 'admin') return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  return <>{children}</>;
};

const LoginRoute = () => {
  const auth = useAuth();
  const location = useLocation();
  if (auth.status === 'loading') return <Splash />;
  if (auth.status === 'admin') {
    const from = (location.state as { from?: string } | null)?.from;
    return <Navigate to={from && from !== '/login' ? from : '/'} replace />;
  }
  return <LoginPage />;
};

const router = createBrowserRouter([
  { path: '/login', element: <LoginRoute /> },
  {
    path: '/',
    element: (
      <RequireAdmin>
        <Suspense fallback={<Splash />}>
          <AppShell />
        </Suspense>
      </RequireAdmin>
    ),
    children: [
      { index: true, element: lazyEl(DashboardPage) },
      { path: 'users', element: lazyEl(UsersPage) },
      { path: 'subscriptions', element: lazyEl(SubscriptionsPage) },
      { path: 'payments', element: lazyEl(PaymentsPage) },
      { path: 'pricing', element: lazyEl(PricingPage) },
      { path: 'analytics', element: lazyEl(AnalyticsPage) },
      { path: 'activity', element: lazyEl(ActivityPage) },
      { path: 'meta-events', element: lazyEl(MetaEventsPage) },
      { path: 'settings', element: lazyEl(SettingsPage) },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <AuthProvider>
          <RouterProvider router={router} />
        </AuthProvider>
      </ToastProvider>
    </QueryClientProvider>
    </ThemeProvider>
  </StrictMode>,
);
