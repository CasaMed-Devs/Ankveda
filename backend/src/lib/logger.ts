/**
 * Minimal structured logger (one JSON line per entry). Works on Vercel and Cloud Functions,
 * both of which parse JSON log lines; keeps shared code free of platform SDKs.
 */
type Level = 'info' | 'warn' | 'error';

const serialise = (value: unknown): unknown => {
  if (value instanceof Error) return { name: value.name, message: value.message, stack: value.stack };
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, serialise(v)]));
  }
  return value;
};

const write = (level: Level, message: string, data?: unknown) => {
  const line = JSON.stringify({ severity: level.toUpperCase(), level, message, ...(data === undefined ? {} : { data: serialise(data) }) });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
};

export const logger = {
  info: (message: string, data?: unknown) => write('info', message, data),
  warn: (message: string, data?: unknown) => write('warn', message, data),
  error: (message: string, data?: unknown) => write('error', message, data),
};
