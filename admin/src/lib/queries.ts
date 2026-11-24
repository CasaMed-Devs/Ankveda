import { keepPreviousData, QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { api, ApiError, apiEnv } from './api';
import type {
  Activity,
  AuditRow,
  DayStat,
  Overview,
  Paged,
  PlanOption,
  Pricing,
  SubscriptionEvent,
  SubscriptionRow,
  SystemInfo,
  TransactionRow,
  UserDetail,
  UserRow,
} from './types';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Admin data changes slowly; never refetch just because the window regained focus.
      staleTime: 60_000,
      gcTime: 10 * 60_000,
      refetchOnWindowFocus: false,
      retry: (count, error) => !(error instanceof ApiError && error.status >= 400 && error.status < 500) && count < 1,
    },
  },
});

/** Every key is scoped to the selected environment, so switching backends never mixes data. */
const k = (...parts: unknown[]) => [apiEnv(), ...parts];

// ── Paged lists (cursor stack) ───────────────────────────────────────────────

export const PAGE_SIZES = [20, 50, 100] as const;

/**
 * Cursor pagination: the server returns `nextCursor`; we keep the stack of cursors we came through so
 * "Previous" is instant (served from the query cache — no Firestore reads). Changing filters or the
 * page size resets to page 1. Pages already seen stay cached for 10 minutes.
 */
export const usePagedList = <T, F extends Record<string, unknown>>(
  name: string,
  filters: F,
  fetcher: (args: F & { pageSize: number; cursor: string | null }) => Promise<Paged<T>>,
  opts: { enabled?: boolean } = {},
) => {
  const [pageSize, setPageSize] = useState<number>(20);
  const resetKey = `${JSON.stringify(filters)}|${pageSize}`;
  const [nav, setNav] = useState<{ key: string; stack: (string | null)[] }>({ key: resetKey, stack: [null] });
  const stack = nav.key === resetKey ? nav.stack : [null];
  const cursor = stack[stack.length - 1] ?? null;
  const [totals, setTotals] = useState<Record<string, number | null>>({});

  const query = useQuery({
    queryKey: k(name, filters, pageSize, cursor),
    queryFn: async () => {
      const page = await fetcher({ ...filters, pageSize, cursor });
      if (cursor === null && page.total !== undefined) setTotals((t) => ({ ...t, [resetKey]: page.total ?? null }));
      return page;
    },
    placeholderData: keepPreviousData,
    enabled: opts.enabled ?? true,
  });

  return {
    ...query,
    items: query.data?.items ?? [],
    page: stack.length,
    pageSize,
    total: totals[resetKey] ?? null,
    setPageSize,
    hasNext: !!query.data?.nextCursor && !query.isPlaceholderData,
    hasPrev: stack.length > 1,
    next: () => query.data?.nextCursor && setNav({ key: resetKey, stack: [...stack, query.data.nextCursor] }),
    prev: () => stack.length > 1 && setNav({ key: resetKey, stack: stack.slice(0, -1) }),
    first: () => setNav({ key: resetKey, stack: [null] }),
  };
};

export type UserFilters = { q?: string; status?: string; planId?: string; from?: string; to?: string };
export const fetchUsers = (args: UserFilters & { pageSize: number; cursor: string | null }) =>
  api<Paged<UserRow>>('GET', '/admin/users', { query: args });

export type SubscriptionFilters = { filter?: string; userId?: string };
export const fetchSubscriptions = (args: SubscriptionFilters & { pageSize: number; cursor: string | null }) =>
  api<Paged<SubscriptionRow>>('GET', '/admin/subscriptions', { query: args });

export type TransactionFilters = { filter?: string; from?: string; to?: string; userId?: string };
export const fetchTransactions = (args: TransactionFilters & { pageSize: number; cursor: string | null }) =>
  api<Paged<TransactionRow>>('GET', '/admin/transactions', { query: args });

export type AuditFilters = { action?: string; targetUserId?: string };
export const fetchAudit = (args: AuditFilters & { pageSize: number; cursor: string | null }) =>
  api<Paged<AuditRow>>('GET', '/admin/audit', { query: args });

// ── Single resources ─────────────────────────────────────────────────────────

export const useOverview = () => useQuery({ queryKey: k('overview'), queryFn: () => api<Overview>('GET', '/admin/stats/overview') });

export const useRefreshOverview = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<Overview>('GET', '/admin/stats/overview', { query: { refresh: 1 } }),
    onSuccess: (data) => {
      qc.setQueryData(k('overview'), data);
      void qc.invalidateQueries({ queryKey: k('series') });
      void qc.invalidateQueries({ queryKey: k('activity') });
    },
  });
};

export const useSeries = (from: string, to: string) =>
  useQuery({
    queryKey: k('series', from, to),
    queryFn: async () => (await api<{ days: DayStat[] }>('GET', '/admin/stats/series', { query: { from, to } })).days,
    placeholderData: keepPreviousData,
    staleTime: 5 * 60_000,
  });

/** Small, bounded lists — refreshed every 2 minutes for the notification bell (no realtime listeners). */
export const useActivity = () =>
  useQuery({ queryKey: k('activity'), queryFn: () => api<Activity>('GET', '/admin/activity'), refetchInterval: 2 * 60_000 });

export const useUserDetail = (id: string | null) =>
  useQuery({ queryKey: k('user', id), queryFn: () => api<UserDetail>('GET', `/admin/users/${id}`), enabled: !!id });

export const useSubscriptionDetail = (id: string | null) =>
  useQuery({
    queryKey: k('subscription', id),
    queryFn: () => api<{ subscription: SubscriptionRow; events: SubscriptionEvent[]; transactions: TransactionRow[] }>('GET', `/admin/subscriptions/${id}`),
    enabled: !!id,
  });

export const usePlans = () =>
  useQuery({ queryKey: k('plans'), queryFn: async () => (await api<{ plans: PlanOption[] }>('GET', '/admin/plans')).plans, staleTime: 5 * 60_000 });

export const usePricing = () => useQuery({ queryKey: k('pricing'), queryFn: () => api<Pricing>('GET', '/admin/pricing') });

export const useSystem = () => useQuery({ queryKey: k('system'), queryFn: () => api<SystemInfo>('GET', '/admin/system'), staleTime: 10 * 60_000 });

// ── Mutations ────────────────────────────────────────────────────────────────

/** After any change to a user or billing record, drop cached lists, the user and dashboard figures. */
const invalidateBilling = (qc: QueryClient, userId?: string) => {
  for (const name of ['users', 'subscriptions', 'transactions', 'audit', 'activity', 'subscription']) {
    void qc.invalidateQueries({ queryKey: k(name) });
  }
  if (userId) void qc.invalidateQueries({ queryKey: k('user', userId) });
  // Headline figures are cached server-side for 5 minutes; force a recompute on next view.
  qc.removeQueries({ queryKey: k('overview') });
};

export type GrantBody = { planId: string; startDate?: string; durationDays?: number; expiryDate?: string; notes?: string };

export const useGrant = (userId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: GrantBody) => api<{ subscription: SubscriptionRow }>('POST', `/admin/users/${userId}/grant`, { body }),
    onSuccess: () => invalidateBilling(qc, userId),
  });
};

export const useExpire = (userId?: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { subscriptionId: string; mode: 'cancel_renewal' | 'expire_now'; notes?: string }) =>
      api<{ subscription: SubscriptionRow }>('POST', `/admin/subscriptions/${args.subscriptionId}/expire`, { body: { mode: args.mode, notes: args.notes } }),
    onSuccess: (data) => invalidateBilling(qc, userId ?? data.subscription?.userId),
  });
};

export const useDeleteUser = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) =>
      api<{ deletion: { status: string; deleted: { subscriptions: number; transactions: number; paymentsInPaise: number } } }>('DELETE', `/admin/users/${userId}`, {
        body: { confirm: userId },
      }),
    onSuccess: (_data, userId) => {
      qc.removeQueries({ queryKey: k('user', userId) });
      invalidateBilling(qc);
    },
  });
};

export type PricingBody = {
  expectedUpdatedAt: number | null;
  name: string;
  description: string | null;
  trialEnabled: boolean;
  trialDays: number;
  trialPriceInPaise: number;
  monthlyPlanEnabled: boolean;
  price: { mode: 'unchanged' } | { mode: 'create'; priceInPaise: number } | { mode: 'existing'; priceInPaise: number; razorpayPlanId: string };
};

export const useSavePricing = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: PricingBody) => api<Pricing & { planId: string }>('PUT', '/admin/pricing', { body }),
    onSuccess: (data) => {
      qc.setQueryData(k('pricing'), { plan: data.plan, history: data.history, razorpayConfigured: data.razorpayConfigured });
      void qc.invalidateQueries({ queryKey: k('plans') });
      void qc.invalidateQueries({ queryKey: k('audit') });
      qc.removeQueries({ queryKey: k('overview') });
    },
  });
};

export const useMaintenance = () => {
  const qc = useQueryClient();
  return {
    backfillSearch: useMutation({
      mutationFn: () => api<{ scanned: number; updated: number }>('POST', '/admin/maintenance/backfill-search'),
      onSuccess: () => void qc.invalidateQueries({ queryKey: k('audit') }),
    }),
    rebuildStats: useMutation({
      mutationFn: (range: { from: string; to: string }) => api<{ days: number }>('POST', '/admin/stats/rebuild', { body: range }),
      onSuccess: () => {
        qc.removeQueries({ queryKey: k('series') });
        qc.removeQueries({ queryKey: k('overview') });
        void qc.invalidateQueries({ queryKey: k('audit') });
      },
    }),
  };
};
