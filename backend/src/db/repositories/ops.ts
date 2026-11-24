import type { OtpChallengeDoc } from '../../types';
import { refs } from '../firestore';
import { DAY_MS } from '../schema';

const WEBHOOK_RETENTION_DAYS = 30;

export const otpRepo = {
  get: async (phone: string): Promise<OtpChallengeDoc | null> => (await refs.otpChallenges().doc(phone).get()).data() ?? null,
  save: (phone: string, challenge: OtpChallengeDoc) => refs.otpChallenges().doc(phone).set(challenge),
  recordFailedAttempt: (phone: string, attempts: number) =>
    refs.otpChallenges().doc(phone).set({ attempts } as Partial<OtpChallengeDoc>, { merge: true }),
  remove: (phone: string) => refs.otpChallenges().doc(phone).delete(),
};

export const webhookEventsRepo = {
  /**
   * Atomically records an event id. Returns false if it was already processed (Razorpay retries),
   * using create() so two concurrent deliveries can't both win.
   */
  recordOnce: async (eventId: string, event: string, entityId: string | null): Promise<boolean> => {
    const now = Date.now();
    try {
      await refs.webhookEvents().doc(eventId).create({
        event,
        entityId,
        receivedAt: now,
        processedAt: null,
        expireAt: now + WEBHOOK_RETENTION_DAYS * DAY_MS,
      });
      return true;
    } catch (error) {
      if ((error as { code?: number }).code === 6) return false; // ALREADY_EXISTS
      throw error;
    }
  },
  markProcessed: (eventId: string) =>
    refs.webhookEvents().doc(eventId).set({ processedAt: Date.now() }, { merge: true }),
};
