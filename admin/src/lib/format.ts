const IST = 'Asia/Kolkata';

export const rupees = (paise: number | null | undefined, opts: { compact?: boolean } = {}) => {
  if (paise === null || paise === undefined) return '—';
  const value = paise / 100;
  if (opts.compact && Math.abs(value) >= 100_000) {
    return `₹${new Intl.NumberFormat('en-IN', { notation: 'compact', maximumFractionDigits: 1 }).format(value)}`;
  }
  return `₹${value.toLocaleString('en-IN', { maximumFractionDigits: value % 1 ? 2 : 0 })}`;
};

export const number = (n: number | null | undefined) => (n === null || n === undefined ? '—' : n.toLocaleString('en-IN'));

export const date = (ms: number | null | undefined) =>
  ms ? new Date(ms).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: IST }) : '—';

export const dateTime = (ms: number | null | undefined) =>
  ms
    ? new Date(ms).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: IST })
    : '—';

export const relative = (ms: number | null | undefined) => {
  if (!ms) return '—';
  const diff = ms - Date.now();
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  if (abs < 60_000) return 'just now';
  if (abs < 3_600_000) return rtf.format(Math.round(diff / 60_000), 'minute');
  if (abs < 86_400_000) return rtf.format(Math.round(diff / 3_600_000), 'hour');
  if (abs < 30 * 86_400_000) return rtf.format(Math.round(diff / 86_400_000), 'day');
  return date(ms);
};

/** "YYYY-MM-DD" for the IST calendar day containing `ms`. */
export const istKey = (ms = Date.now()) => new Date(ms + 330 * 60_000).toISOString().slice(0, 10);

export const addDays = (key: string, days: number) => {
  const d = new Date(`${key}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

export const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;

export const shortDay = (key: string) =>
  new Date(`${key}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });

export const monthLabel = (key: string) =>
  new Date(`${key}-01T00:00:00Z`).toLocaleDateString('en-IN', { month: 'short', year: 'numeric', timeZone: 'UTC' });

/** % change vs the previous period; null when there is no base to compare against. */
export const pctChange = (current: number, previous: number) => (previous > 0 ? ((current - previous) / previous) * 100 : null);

export const periodLabel = (period: string, interval: number) => {
  const unit = { daily: 'day', weekly: 'week', monthly: 'month', yearly: 'year' }[period] ?? period;
  return interval > 1 ? `${interval} ${unit}s` : unit;
};

export const initials = (name: string | null | undefined, fallback = '?') => {
  if (!name) return fallback;
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '')).toUpperCase() || fallback;
};

export const phone = (p: string | null | undefined) => (p ? `+91 ${p.slice(0, 5)} ${p.slice(5)}` : '—');
