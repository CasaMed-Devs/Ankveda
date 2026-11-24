import { signOut } from 'firebase/auth';

import { ENVIRONMENTS, loadEnv, type EnvKey } from './env';
import { auth } from './firebase';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}

let currentEnv: EnvKey = loadEnv();
export const setApiEnv = (key: EnvKey) => {
  currentEnv = key;
};
export const apiEnv = () => currentEnv;

type Query = Record<string, string | number | boolean | null | undefined>;

const toQuery = (query?: Query) => {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== '') params.set(k, String(v));
  const s = params.toString();
  return s ? `?${s}` : '';
};

/** Calls the admin API with a fresh Firebase ID token (refreshed automatically by the SDK). */
export const api = async <T>(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, opts: { query?: Query; body?: unknown } = {}): Promise<T> => {
  const user = auth.currentUser;
  if (!user) throw new ApiError(401, 'Please sign in.', 'unauthorized');
  const token = await user.getIdToken();
  let res: Response;
  try {
    res = await fetch(`${ENVIRONMENTS[currentEnv].api}${path}${toQuery(opts.query)}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch {
    throw new ApiError(0, `Cannot reach the ${ENVIRONMENTS[currentEnv].label} API. Check your connection.`, 'network');
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
  if (res.status === 401) {
    await signOut(auth);
    throw new ApiError(401, data.error ?? 'Your session expired. Please sign in again.', 'unauthorized');
  }
  if (!res.ok) throw new ApiError(res.status, data.error ?? `Request failed (${res.status}).`, data.code);
  return data as T;
};

/**
 * Opens a payment's tax invoice — the identical document the app renders to PDF — in a new tab.
 * The tab is opened synchronously (inside the click) so pop-up blockers allow it, then filled once the
 * authenticated request returns. `print` opens the browser's print dialog for "Save as PDF".
 */
export const openInvoice = async (paymentId: string, opts: { print?: boolean } = {}) => {
  const tab = window.open('', '_blank');
  if (tab) tab.document.title = 'Loading invoice…';
  try {
    const user = auth.currentUser;
    if (!user) throw new ApiError(401, 'Please sign in.', 'unauthorized');
    const res = await fetch(`${ENVIRONMENTS[currentEnv].api}/admin/invoices/${encodeURIComponent(paymentId)}`, {
      headers: { Authorization: `Bearer ${await user.getIdToken()}` },
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      throw new ApiError(res.status, data.error ?? `Could not load the invoice (${res.status}).`);
    }
    const url = URL.createObjectURL(new Blob([await res.text()], { type: 'text/html' }));
    if (!tab) {
      window.location.assign(url); // pop-ups blocked: fall back to this tab
      return;
    }
    tab.location.href = url;
    if (opts.print) tab.addEventListener('load', () => tab.print(), { once: true });
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (error) {
    tab?.close();
    throw error;
  }
};

export const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : typeof error === 'string' ? error : 'Something went wrong.';
