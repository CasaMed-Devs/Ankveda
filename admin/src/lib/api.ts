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

export const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : typeof error === 'string' ? error : 'Something went wrong.';
