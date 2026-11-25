import { SCHEMA_VERSION, type Daily, type DailyDoc } from '../../types';
import { db, refs } from '../firestore';
import { DAY_MS } from '../schema';

const DAILY_RETENTION_DAYS = 30;
/** How long one request may hold the "generating" claim before another may take over. */
export const DAILY_LOCK_MS = 90_000;

const toDaily = (doc: DailyDoc): Daily => ({
  date: doc.date,
  luckyNumber: doc.luckyNumber,
  luckyTime: doc.luckyTime,
  theme: doc.theme,
  title: doc.title,
  message: doc.message,
});

/** Docs written before the claim lock existed have no status: they are finished reports. */
const isReady = (doc: DailyDoc) => (doc.status ?? 'ready') === 'ready';

export type DailyClaim = { kind: 'ready'; daily: Daily } | { kind: 'claimed' } | { kind: 'busy' };

export const dailyRepo = {
  /**
   * Today's finished guidance, if any. One report per user per IST day: the date is the document id,
   * and a profile edit does not invalidate it (new details apply from the next day).
   */
  get: async (userId: string, date: string): Promise<Daily | null> => {
    const doc = (await refs.dailyGuidance(userId).doc(date).get()).data();
    return doc && isReady(doc) ? toDaily(doc) : null;
  },

  /**
   * Claims today's generation so concurrent requests (Home + Daily, double taps) produce one report.
   * ready → return it; free or stale claim → take it; someone else generating → busy.
   */
  claim: (userId: string, date: string, profileKey: string): Promise<DailyClaim> =>
    db.runTransaction(async (tx) => {
      const ref = refs.dailyGuidance(userId).doc(date);
      const doc = (await tx.get(ref)).data();
      const now = Date.now();
      if (doc && isReady(doc)) return { kind: 'ready', daily: toDaily(doc) };
      if (doc?.lockedUntil && doc.lockedUntil > now) return { kind: 'busy' };
      const placeholder: DailyDoc = {
        date,
        luckyNumber: '',
        luckyTime: '',
        theme: '',
        title: '',
        message: '',
        status: 'generating',
        lockedUntil: now + DAILY_LOCK_MS,
        schemaVersion: SCHEMA_VERSION,
        profileKey,
        createdAt: now,
        expireAt: now + DAILY_RETENTION_DAYS * DAY_MS,
      };
      tx.set(ref, placeholder);
      return { kind: 'claimed' };
    }),

  /** Generation failed: drop the claim so the next open retries (a failure doesn't use up the day). */
  release: (userId: string, date: string) => refs.dailyGuidance(userId).doc(date).delete(),

  save: (userId: string, daily: Daily, profileKey: string) => {
    const now = Date.now();
    const doc: DailyDoc = {
      ...daily,
      status: 'ready',
      lockedUntil: null,
      schemaVersion: SCHEMA_VERSION,
      profileKey,
      createdAt: now,
      expireAt: now + DAILY_RETENTION_DAYS * DAY_MS,
    };
    return refs.dailyGuidance(userId).doc(daily.date).set(doc);
  },
};
