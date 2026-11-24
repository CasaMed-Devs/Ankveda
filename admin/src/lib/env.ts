/**
 * Which backend the dashboard talks to. Both share the same Firestore database and Firebase project,
 * so one admin sign-in works for both.
 *  - production: Cloud Functions behind this Firebase Hosting site (same origin, /api rewrite)
 *  - staging:    the Vercel deployment (needs this site in its CORS_ORIGINS)
 *  - dev:        `npm run dev` proxies /api (see vite.config.ts)
 */
export type EnvKey = 'production' | 'staging' | 'dev';

export const ENVIRONMENTS: Record<EnvKey, { label: string; api: string; tone: 'live' | 'test' }> = import.meta.env.DEV
  ? ({ dev: { label: 'Local dev', api: '/api', tone: 'test' } } as Record<EnvKey, { label: string; api: string; tone: 'live' | 'test' }>)
  : ({
      production: { label: 'Production', api: '/api', tone: 'live' },
      staging: { label: 'Staging', api: 'https://ankveda-backend.vercel.app/api', tone: 'test' },
    } as Record<EnvKey, { label: string; api: string; tone: 'live' | 'test' }>);

const STORAGE_KEY = 'ankveda.admin.env';

export const envKeys = () => Object.keys(ENVIRONMENTS) as EnvKey[];

export const loadEnv = (): EnvKey => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY) as EnvKey | null;
    if (saved && saved in ENVIRONMENTS) return saved;
  } catch {
    /* storage unavailable */
  }
  return envKeys()[0]!;
};

export const saveEnv = (key: EnvKey) => {
  try {
    localStorage.setItem(STORAGE_KEY, key);
  } catch {
    /* storage unavailable */
  }
};
