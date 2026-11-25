import { focusManager, QueryClient, useInfiniteQuery, useMutation, useQuery, type InfiniteData } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { api } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { msUntilIstMidnight, todayIst } from '@/lib/format';
import type { ChatPage, Report, ReportInput, ReportType, User } from '@/lib/types';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 30_000 },
  },
});

// React Native has no window focus: treat "app came to the foreground" as focus, so stale queries
// (home, daily, …) refetch when the user reopens the app.
focusManager.setEventListener((handleFocus) => {
  const sub = AppState.addEventListener('change', (state) => handleFocus(state === 'active'));
  return () => sub.remove();
});

/** Today's IST date; re-renders at 00:00 IST and whenever the app returns to the foreground. */
export const useIstDate = () => {
  const [date, setDate] = useState(todayIst);
  useEffect(() => {
    const update = () => setDate(todayIst());
    const sub = AppState.addEventListener('change', (state) => state === 'active' && update());
    const timer = setTimeout(update, msUntilIstMidnight() + 1_000);
    return () => {
      sub.remove();
      clearTimeout(timer);
    };
  }, [date]);
  return date;
};

// When the session ends (sign-out, or the server says the account no longer exists), drop every cached
// profile / report / chat / payment so nothing of the old account stays visible — even if the same phone
// signs in again as a new account.
useAuthStore.subscribe((state, prev) => {
  if (prev.token && !state.token) queryClient.clear();
});

export const keys = {
  me: ['me'] as const,
  home: ['home'] as const,
  daily: ['daily'] as const,
  plan: ['plan', 'featured'] as const,
  reports: ['reports'] as const,
  report: (id: string) => ['reports', id] as const,
  astrologers: ['astrologers'] as const,
  chat: ['chat'] as const,
  conversations: ['chat', 'conversations'] as const,
  chatMessages: (astrologerId: string) => ['chat', 'messages', astrologerId] as const,
  invoices: ['invoices'] as const,
};

/** Stores the fresh user and refreshes everything that depends on entitlement. */
export const applyUser = (user: User) => {
  useAuthStore.getState().setUser(user);
  queryClient.setQueryData(keys.me, user);
  void queryClient.invalidateQueries({ queryKey: keys.home });
  void queryClient.invalidateQueries({ queryKey: keys.daily });
  void queryClient.invalidateQueries({ queryKey: keys.chat });
  // A purchase / restore may have produced a new invoice.
  void queryClient.invalidateQueries({ queryKey: keys.invoices });
};

export const useMe = () => {
  const token = useAuthStore((s) => s.token);
  return useQuery({
    queryKey: keys.me,
    enabled: !!token,
    queryFn: async () => {
      const { user } = await api.me();
      useAuthStore.getState().setUser(user);
      return user;
    },
  });
};

export const useEntitlement = () => {
  const { data } = useMe();
  return { isPremium: !!data?.entitlement.active, entitlement: data?.entitlement };
};

export const useHome = () => useQuery({ queryKey: keys.home, queryFn: api.home });

/**
 * Daily guidance for one IST day. The server makes exactly one report per user per day, so within the day
 * the result never goes stale; a new date is a new key → a fresh fetch after 00:00 IST.
 */
export const dailyQuery = (date: string) => ({
  queryKey: [...keys.daily, date] as const,
  queryFn: async () => {
    const result = await api.daily();
    // Home's birth-message card shows today's message once it exists.
    void queryClient.invalidateQueries({ queryKey: keys.home });
    return result;
  },
  staleTime: Infinity,
  retry: 1,
});

export const useDaily = () => useQuery(dailyQuery(useIstDate()));

/** Starts today's guidance as soon as the user is in the app (premium, profile complete). */
export const usePrefetchDaily = (enabled: boolean) => {
  const date = useIstDate();
  useEffect(() => {
    if (enabled) void queryClient.prefetchQuery(dailyQuery(date));
  }, [enabled, date]);
};
/** The paywall plan as offered to this user: without the trial once the account has used it. */
export const useFeaturedPlan = () => {
  const trialEligible = useMe().data?.trialEligible !== false;
  return useQuery({
    queryKey: keys.plan,
    queryFn: async () => (await api.featuredPlan()).plan,
    select: (plan) => (plan && !trialEligible ? { ...plan, trialDays: 0, trialPriceInPaise: 0 } : plan),
  });
};

export const useReports = () =>
  useQuery({ queryKey: keys.reports, queryFn: async () => (await api.reports()).reports });

/** Polls every 3s while the report is being generated. */
export const useReport = (id: string) =>
  useQuery({
    queryKey: keys.report(id),
    queryFn: async () => (await api.report(id)).report,
    refetchInterval: (query) => (query.state.data?.status === 'processing' ? 3000 : false),
  });

const cacheReport = (report: Report) => {
  queryClient.setQueryData(keys.report(report.id), report);
  void queryClient.invalidateQueries({ queryKey: keys.reports, exact: true });
};

export const useCreateReport = () =>
  useMutation({
    mutationFn: ({ type, input }: { type: ReportType; input: ReportInput }) => api.createReport(type, input),
    onSuccess: ({ report }) => cacheReport(report),
  });

export const useGenerateReport = () =>
  useMutation({
    mutationFn: (id: string) => api.generateReport(id),
    onSuccess: ({ report }) => cacheReport(report),
  });

export const useSaveReport = () =>
  useMutation({
    mutationFn: ({ id, saved }: { id: string; saved: boolean }) => api.saveReport(id, saved),
    onSuccess: ({ report }) => cacheReport(report),
  });

export const useUpdateMe = () =>
  useMutation({
    mutationFn: api.updateMe,
    onSuccess: ({ user }) => applyUser(user),
  });

// ── Chat with astrologers (Persona API via the backend; history is stored there) ──

/** All astrologers. The list rarely changes, so it is kept for 10 minutes. */
export const useAstrologers = () =>
  useQuery({
    queryKey: keys.astrologers,
    queryFn: async () => (await api.astrologers()).astrologers,
    staleTime: 10 * 60_000,
  });

export const useAstrologer = (id: string) => {
  const list = useAstrologers();
  return { ...list, data: list.data?.find((a) => a.id === id) };
};

/** The user's chats, most recent first (Premium only). */
export const useConversations = (enabled: boolean) =>
  useQuery({ queryKey: keys.conversations, enabled, queryFn: async () => (await api.conversations()).conversations });

/** History with one astrologer. pages[0] is the newest page; older pages are appended as the user scrolls up. */
export const useChatMessages = (astrologerId: string, enabled: boolean) =>
  useInfiniteQuery({
    queryKey: keys.chatMessages(astrologerId),
    enabled,
    // Always load the newest history when a chat opens (never trust a cached page).
    staleTime: 0,
    refetchOnMount: 'always',
    gcTime: 5 * 60_000,
    initialPageParam: undefined as number | undefined,
    queryFn: ({ pageParam }) => api.chatMessages(astrologerId, pageParam),
    getNextPageParam: (last) => (last.hasMore && last.nextCursor !== null ? last.nextCursor : undefined),
  });

type ChatData = InfiniteData<ChatPage, number | undefined>;

const updateNewestPage = (astrologerId: string, update: (page: ChatPage) => ChatPage) =>
  queryClient.setQueryData<ChatData>(keys.chatMessages(astrologerId), (old) =>
    old ? { ...old, pages: [update(old.pages[0]), ...old.pages.slice(1)] } : old,
  );

export const useSendChat = (astrologerId: string) =>
  useMutation({
    mutationFn: (text: string) => api.sendChat(astrologerId, text),
    onSuccess: ({ messages }) => {
      updateNewestPage(astrologerId, (page) => ({ ...page, messages: [...page.messages, ...messages] }));
      void queryClient.invalidateQueries({ queryKey: keys.conversations });
    },
    onError: (error) => {
      // Birth details went missing (e.g. the astrologer now needs more): reload to show the form.
      if ((error as { code?: string }).code === 'missing_context') {
        void queryClient.invalidateQueries({ queryKey: keys.chatMessages(astrologerId) });
      }
    },
  });

/** Saves birth details an astrologer asked for; birth time / place also land on the profile. */
export const useSaveChatContext = (astrologerId: string) =>
  useMutation({
    mutationFn: (values: Record<string, string>) => api.saveChatContext(astrologerId, values),
    onSuccess: ({ missing }) => {
      updateNewestPage(astrologerId, (page) => ({ ...page, missing }));
      void queryClient.invalidateQueries({ queryKey: keys.me });
    },
  });

/** The user's tax invoices (trial + subscription payments), newest first. */
export const useInvoices = () => {
  const token = useAuthStore((s) => s.token);
  return useQuery({ queryKey: keys.invoices, enabled: !!token, queryFn: async () => (await api.invoices()).invoices });
};
