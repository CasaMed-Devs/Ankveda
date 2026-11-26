import type { OtpChallengeDoc } from '../../types';
import { db, refs } from '../firestore';
import { DAY_MS } from '../schema';

const WEBHOOK_RETENTION_DAYS = 30;

export const otpRepo = {
  get: async (phone: string): Promise<OtpChallengeDoc | null> => (await refs.otpChallenges().doc(phone).get()).data() ?? null,
  save: (phone: string, challenge: OtpChallengeDoc) => refs.otpChallenges().doc(phone).set(challenge),
  recordFailedAttempt: (phone: string, attempts: number) =>
    refs.otpChallenges().doc(phone).set({ attempts } as Partial<OtpChallengeDoc>, { merge: true }),
  /** Makes the code single-use while keeping the daily send counter (doc is TTL-deleted later). */
  consume: (phone: string) =>
    refs.otpChallenges().doc(phone).set({ codeHash: '', codeExpiresAt: 0, attempts: 0 } as Partial<OtpChallengeDoc>, { merge: true }),
};

/** A claim left unfinished this long (crashed / timed-out instance) may be taken over by a retry. */
const WEBHOOK_CLAIM_STALE_MS = 60_000;

export type WebhookClaim = 'process' | 'done' | 'in_progress';

export const webhookEventsRepo = {
  /**
   * Atomically claims an event id for processing (Razorpay retries deliveries).
   *  process     — first delivery, or an earlier attempt failed / never finished → handle it now
   *  done        — already processed → acknowledge as a duplicate
   *  in_progress — another delivery is handling it right now → ask Razorpay to retry later
   * Only a processed event counts as a duplicate, so a delivery whose processing threw is handled again.
   */
  claim: async (eventId: string, event: string, entityId: string | null): Promise<WebhookClaim> => {
    const ref = refs.webhookEvents().doc(eventId);
    return db.runTransaction(async (tx) => {
      const now = Date.now();
      const existing = (await tx.get(ref)).data();
      if (!existing) {
        tx.create(ref, {
          event,
          entityId,
          receivedAt: now,
          processingStartedAt: now,
          processedAt: null,
          attempts: 1,
          expireAt: now + WEBHOOK_RETENTION_DAYS * DAY_MS,
        });
        return 'process';
      }
      if (existing.processedAt) return 'done';
      const startedAt = existing.processingStartedAt ?? null;
      if (startedAt && now - startedAt < WEBHOOK_CLAIM_STALE_MS) return 'in_progress';
      tx.set(ref, { processingStartedAt: now, attempts: (existing.attempts ?? 1) + 1 }, { merge: true });
      return 'process';
    });
  },
  /** Processing threw: release the claim so Razorpay's retry is handled straight away. */
  release: (eventId: string, error: unknown) =>
    refs.webhookEvents().doc(eventId).set({ processingStartedAt: null, lastError: String((error as Error)?.message ?? error) }, { merge: true }),
  markProcessed: (eventId: string) =>
    refs.webhookEvents().doc(eventId).set({ processedAt: Date.now(), processingStartedAt: null }, { merge: true }),
};
