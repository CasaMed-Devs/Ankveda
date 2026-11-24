import { QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import type { Report, ReportInput, ReportType, User } from '@/lib/types';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 30_000 },
  },
});

export const keys = {
  me: ['me'] as const,
  home: ['home'] as const,
  daily: ['daily'] as const,
  plan: ['plan', 'featured'] as const,
  reports: ['reports'] as const,
  report: (id: string) => ['reports', id] as const,
  chat: ['chat'] as const,
};

/** Stores the fresh user and refreshes everything that depends on entitlement. */
export const applyUser = (user: User) => {
  useAuthStore.getState().setUser(user);
  queryClient.setQueryData(keys.me, user);
  void queryClient.invalidateQueries({ queryKey: keys.home });
  void queryClient.invalidateQueries({ queryKey: keys.daily });
  void queryClient.invalidateQueries({ queryKey: keys.chat });
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
export const useDaily = () => useQuery({ queryKey: keys.daily, queryFn: api.daily });
export const useFeaturedPlan = () =>
  useQuery({ queryKey: keys.plan, queryFn: async () => (await api.featuredPlan()).plan });

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

export const useChatHistory = () => useQuery({ queryKey: keys.chat, queryFn: api.chatHistory });

export const useSendChat = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: api.sendChat,
    onSuccess: ({ messages }) => {
      client.setQueryData(keys.chat, (old: Awaited<ReturnType<typeof api.chatHistory>> | undefined) => ({
        locked: false,
        messages: [...(old?.messages ?? []), ...messages],
      }));
    },
  });
};
