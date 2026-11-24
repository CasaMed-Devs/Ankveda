// Public links shown in the app. Replace with your real pages before launch.
export const LEGAL_URLS = {
  terms: process.env.EXPO_PUBLIC_TERMS_URL ?? 'https://ankveda.app/terms',
  privacy: process.env.EXPO_PUBLIC_PRIVACY_URL ?? 'https://ankveda.app/privacy',
};

export const RESEND_SECONDS = 30;

// Backend selection. Set EXPO_PUBLIC_API_TARGET to vercel | firebase | local.
// Each target's URL can be overridden with its own EXPO_PUBLIC_API_URL_* variable,
// and EXPO_PUBLIC_API_URL (if set) wins over everything.
// Expo only inlines EXPO_PUBLIC_* vars when read as literal `process.env.X`, so keep these static.
export type ApiTarget = 'vercel' | 'firebase' | 'local';

const API_URLS: Record<ApiTarget, string> = {
  vercel: process.env.EXPO_PUBLIC_API_URL_VERCEL || 'https://ankveda-backend.vercel.app/api',
  firebase: process.env.EXPO_PUBLIC_API_URL_FIREBASE || 'https://ankveda-e6471.web.app/api',
  local: process.env.EXPO_PUBLIC_API_URL_LOCAL || 'http://127.0.0.1:5001/demo-ankveda/asia-south2/api',
};

const rawTarget = (process.env.EXPO_PUBLIC_API_TARGET || 'vercel').trim().toLowerCase();

export const API_TARGET: ApiTarget = rawTarget in API_URLS ? (rawTarget as ApiTarget) : 'vercel';

if (rawTarget !== API_TARGET) {
  console.warn(`Unknown EXPO_PUBLIC_API_TARGET "${rawTarget}", falling back to "vercel".`);
}

export const API_URL = (process.env.EXPO_PUBLIC_API_URL || API_URLS[API_TARGET]).replace(/\/$/, '');
