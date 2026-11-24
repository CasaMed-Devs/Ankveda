/** Calendar maths in India Standard Time (UTC+05:30, no DST) — the business day for Ankveda. */
import { DAY_MS } from '../../db/schema';

const IST_OFFSET_MS = 330 * 60_000;

/** Start (epoch ms) of the IST day containing `ms`. */
export const istDayStart = (ms: number) => Math.floor((ms + IST_OFFSET_MS) / DAY_MS) * DAY_MS - IST_OFFSET_MS;

/** "YYYY-MM-DD" of the IST day containing `ms`. */
export const istDateKey = (ms: number) => new Date(ms + IST_OFFSET_MS).toISOString().slice(0, 10);

/** Start (epoch ms) of the IST day "YYYY-MM-DD". */
export const istDateStart = (key: string) => Date.parse(`${key}T00:00:00.000Z`) - IST_OFFSET_MS;

/** Start (epoch ms) of the IST month containing `ms`, shifted by `monthDelta` months. */
export const istMonthStart = (ms: number, monthDelta = 0) => {
  const d = new Date(ms + IST_OFFSET_MS);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + monthDelta, 1) - IST_OFFSET_MS;
};

/** Every IST date key from `from` to `to` inclusive. */
export const dateKeysBetween = (from: string, to: string) => {
  const keys: string[] = [];
  for (let t = istDateStart(from); t <= istDateStart(to); t += DAY_MS) keys.push(istDateKey(t));
  return keys;
};

export const isDateKey = (value: unknown): value is string =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
