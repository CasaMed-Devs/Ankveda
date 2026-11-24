import { router } from 'expo-router';

import { useAuthStore } from '@/lib/auth-store';
import { API_URL } from '@/lib/config';
import type {
  ChatMessage,
  CheckoutSession,
  Daily,
  HomeSummary,
  Plan,
  Report,
  ReportInput,
  ReportType,
  User,
} from '@/lib/types';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
  }
}

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';

const request = async <T>(method: Method, path: string, body?: unknown): Promise<T> => {
  if (!API_URL) throw new ApiError('Backend URL is not set. Check EXPO_PUBLIC_API_TARGET in app/.env.local.', 0, 'config');

  const token = useAuthStore.getState().token;
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError('We could not reach Ankveda. Check your connection and try again.', 0, 'network');
  }

  const data = (await response.json().catch(() => ({}))) as { error?: string; code?: string };
  if (response.status === 401 && token) {
    await useAuthStore.getState().signOut();
  }
  // Profile missing name / date of birth: collect it before anything else.
  if (data.code === 'profile_incomplete') router.replace('/about-you');
  if (!response.ok) {
    throw new ApiError(data.error ?? 'Something went wrong. Please try again.', response.status, data.code);
  }
  return data as T;
};

export const api = {
  requestOtp: (phone: string) => request<{ sent: boolean; devCode?: string }>('POST', '/auth/otp/request', { phone }),
  verifyOtp: (phone: string, code: string) =>
    request<{ token: string; user: User }>('POST', '/auth/otp/verify', { phone, code }),

  me: () => request<{ user: User }>('GET', '/me'),
  updateMe: (patch: { fullName?: string; dob?: string }) => request<{ user: User }>('PUT', '/me', patch),

  home: () => request<HomeSummary>('GET', '/home'),
  daily: () => request<{ locked: boolean; daily?: Daily }>('GET', '/daily'),

  featuredPlan: () => request<{ plan: Plan | null }>('GET', '/plans/featured'),
  createSubscription: (planId: string) => request<CheckoutSession>('POST', '/subscriptions', { planId }),
  verifySubscription: (payload: { paymentId: string; subscriptionId: string; signature: string }) =>
    request<{ user: User }>('POST', '/subscriptions/verify', payload),
  restorePurchases: () => request<{ user: User; restored: boolean }>('POST', '/subscriptions/restore'),
  cancelSubscription: () => request<{ user: User }>('POST', '/subscriptions/cancel'),

  createReport: (type: ReportType, input: ReportInput) => request<{ report: Report }>('POST', '/reports', { type, input }),
  reports: () => request<{ reports: Report[] }>('GET', '/reports'),
  report: (id: string) => request<{ report: Report }>('GET', `/reports/${id}`),
  generateReport: (id: string) => request<{ report: Report }>('POST', `/reports/${id}/generate`),
  saveReport: (id: string, saved: boolean) => request<{ report: Report }>('POST', `/reports/${id}/save`, { saved }),

  chatHistory: () => request<{ locked: boolean; messages: ChatMessage[] }>('GET', '/chat/history'),
  sendChat: (text: string) => request<{ messages: ChatMessage[] }>('POST', '/chat', { text }),
};
