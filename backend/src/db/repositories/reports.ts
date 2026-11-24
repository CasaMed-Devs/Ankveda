import { SCHEMA_VERSION, type ReportDoc, type ReportInput, type ReportType } from '../../types';
import { isPremiumUser } from '../../services/entitlement';
import { db, refs } from '../firestore';

const LOCK_MS = 5 * 60_000;
/** A report "processing" for longer than this is treated as failed (the runner died). */
export const STALE_PROCESSING_MS = 6 * 60_000;

export const isStale = (report: ReportDoc, now = Date.now()) =>
  report.status === 'processing' && now - report.updatedAt > STALE_PROCESSING_MS;

export type ReportWithId = ReportDoc & { id: string };

export const reportsRepo = {
  create: async (
    userId: string,
    args: { type: ReportType; input: ReportInput; profileSnapshot: { fullName: string; dob: string }; status: 'locked' | 'processing' },
  ): Promise<ReportWithId> => {
    const now = Date.now();
    const doc: ReportDoc = {
      schemaVersion: SCHEMA_VERSION,
      userId,
      type: args.type,
      status: args.status,
      stage: 'received',
      input: args.input,
      profileSnapshot: args.profileSnapshot,
      content: null,
      saved: false,
      error: null,
      attempts: 0,
      lockedUntil: null,
      generator: null,
      completedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    const ref = refs.reports(userId).doc();
    await ref.create(doc);
    return { id: ref.id, ...doc };
  },

  get: async (userId: string, reportId: string): Promise<ReportDoc | null> =>
    (await refs.reports(userId).doc(reportId).get()).data() ?? null,

  list: async (userId: string, limit: number): Promise<ReportWithId[]> => {
    const snap = await refs.reports(userId).orderBy('createdAt', 'desc').limit(limit).get();
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  },

  countSince: async (userId: string, sinceMs: number) =>
    (await refs.reports(userId).where('createdAt', '>', sinceMs).count().get()).data().count,

  patch: (userId: string, reportId: string, patch: Partial<ReportDoc>) =>
    refs.reports(userId).doc(reportId).set({ ...patch, updatedAt: Date.now() }, { merge: true }),

  /** (Re)queue for generation: locked / failed / stale → processing. */
  queue: (userId: string, reportId: string) =>
    db.runTransaction(async (tx) => {
      const ref = refs.reports(userId).doc(reportId);
      const report = (await tx.get(ref)).data();
      if (!report) return null;
      if (report.status === 'complete' || (report.status === 'processing' && !isStale(report))) return report;
      const next: ReportDoc = { ...report, status: 'processing', stage: 'received', error: null, lockedUntil: null, updatedAt: Date.now() };
      tx.set(ref, next);
      return next;
    }),

  /**
   * Claims a report for generation. Returns null if another runner holds the lock or it is not
   * waiting — so the Vercel inline runner and the Firebase trigger never process it twice.
   *
   * Paid-access gate: generation only ever starts for a user who has purchased the trial or the
   * subscription (isPremiumUser). Checked here, inside the claim transaction, because every path
   * that generates (inline runner, Firestore trigger, retries) goes through claim(). A report queued
   * for a user without access is put back to "locked" and nothing is generated.
   */
  claim: (userId: string, reportId: string) =>
    db.runTransaction(async (tx) => {
      const ref = refs.reports(userId).doc(reportId);
      const [reportSnap, userSnap] = await Promise.all([tx.get(ref), tx.get(refs.user(userId))]);
      const report = reportSnap.data();
      const user = userSnap.data();
      const now = Date.now();
      if (!report || report.status !== 'processing') return null;
      if (report.lockedUntil && report.lockedUntil > now) return null;
      if (!user || !isPremiumUser(user)) {
        tx.set(ref, { ...report, status: 'locked', stage: 'received', error: null, lockedUntil: null, updatedAt: now });
        return { blocked: true as const };
      }
      const next: ReportDoc = { ...report, stage: 'numbers', attempts: report.attempts + 1, lockedUntil: now + LOCK_MS, updatedAt: now };
      tx.set(ref, next);
      return next;
    }),
};
