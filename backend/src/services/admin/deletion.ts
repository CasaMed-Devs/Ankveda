/**
 * Permanent user deletion — a resumable job in userDeletions/{userId}.
 *
 * Steps (each idempotent; finished steps are recorded, so a retry resumes where it stopped):
 *   1. cancelRazorpay — cancel every still-billable Razorpay subscription immediately. If billing cannot
 *                       be stopped (no keys, Razorpay error) the job stops here and NOTHING is deleted.
 *   2. transactions   — delete the user's payment records (batched).
 *   3. subscriptions  — recursiveDelete each subscription (removes its events subcollection too).
 *   4. userData       — recursiveDelete users/{id}: profile, reports, chatMessages, dailyGuidance.
 *                       (Firestore never deletes subcollections with their parent — recursiveDelete does.)
 *   5. otp            — the phone-keyed login challenge.
 *
 * App users have no Firebase Auth account (phone OTP + backend JWT) and no Cloud Storage files, so there
 * is nothing else to remove. The audit entry keeps only the opaque user id and counts — no name or phone.
 */
import { refs, db } from '../../db/firestore';
import { HttpError } from '../../lib/http';
import { logger } from '../../lib/logger';
import type { AdminActor, SubscriptionStatus, UserDeletionDoc, UserDeletionStep } from '../../types';
import { accessBucketOf } from '../billingRules';
import { cancelRazorpaySubscription, fetchRazorpaySubscription, razorpayConfigured } from '../razorpay';
import { audit } from './audit';
import { REVENUE_STATUSES } from './stats';

const BILLABLE: SubscriptionStatus[] = ['created', 'authenticated', 'active', 'pending', 'halted'];
const STEPS: UserDeletionStep[] = ['cancelRazorpay', 'transactions', 'subscriptions', 'userData', 'otp'];
const STALE_RUN_MS = 2 * 60_000;

const jobRef = (userId: string) => refs.userDeletions().doc(userId);

const stepError = (step: UserDeletionStep, error: unknown) => {
  const reason = (error as { error?: { description?: string } }).error?.description ?? (error as Error).message ?? String(error);
  return `${step}: ${reason}`;
};

const runStep = async (userId: string, job: UserDeletionDoc, actor: AdminActor, step: UserDeletionStep) => {
  switch (step) {
    case 'cancelRazorpay': {
      const subs = await refs.subscriptions().where('userId', '==', userId).get();
      const billable = subs.docs.filter((d) => (d.data().source ?? 'razorpay') === 'razorpay' && BILLABLE.includes(d.data().status));
      if (billable.length && !razorpayConfigured()) {
        throw new Error('Razorpay keys are not configured, so active billing cannot be stopped');
      }
      for (const doc of billable) {
        try {
          await cancelRazorpaySubscription(doc.id, false);
        } catch (error) {
          // Already cancelled/completed in Razorpay → fine; anything else stops the deletion.
          const latest = await fetchRazorpaySubscription(doc.id).catch(() => null);
          if (!latest || BILLABLE.includes(latest.status as SubscriptionStatus)) throw error;
        }
      }
      return;
    }
    case 'transactions': {
      // Batches of 400; counts are saved after each batch so a retry keeps the totals.
      for (;;) {
        const snap = await refs.transactions().where('userId', '==', userId).limit(400).get();
        if (snap.empty) return;
        const batch = db.batch();
        let paise = 0;
        for (const d of snap.docs) {
          const t = d.data();
          if (REVENUE_STATUSES.includes(t.status)) paise += t.amountInPaise - (t.refundedAmountInPaise ?? 0);
          batch.delete(d.ref);
        }
        job.deleted.transactions += snap.size;
        job.deleted.paymentsInPaise += paise;
        batch.set(jobRef(userId), { ...job, updatedAt: Date.now() });
        await batch.commit();
      }
    }
    case 'subscriptions': {
      const subs = await refs.subscriptions().where('userId', '==', userId).get();
      for (const d of subs.docs) await db.recursiveDelete(d.ref);
      job.deleted.subscriptions += subs.size;
      return;
    }
    case 'userData':
      await db.recursiveDelete(refs.user(userId));
      return;
    case 'otp':
      if (job.phone) await refs.otpChallenges().doc(job.phone).delete();
      return;
  }
};

export const getDeletionJob = async (userId: string) => (await jobRef(userId).get()).data() ?? null;

export const deleteUser = async (userId: string, actor: AdminActor) => {
  const now = Date.now();
  const [user, existing] = await Promise.all([refs.user(userId).get().then((s) => s.data()), getDeletionJob(userId)]);
  if (existing?.status === 'completed') return existing;
  if (!user && !existing) throw new HttpError(404, 'User not found.', 'not_found');
  if (existing?.status === 'running' && now - existing.updatedAt < STALE_RUN_MS) {
    throw new HttpError(409, 'This user is already being deleted. Refresh in a moment.', 'deletion_running');
  }

  const job: UserDeletionDoc = existing
    ? { ...existing, status: 'running', lastError: null, updatedAt: now }
    : {
        status: 'running',
        steps: {},
        requestedBy: actor,
        phone: user?.phone ?? null,
        deleted: { subscriptions: 0, transactions: 0, paymentsInPaise: 0 },
        lastError: null,
        createdAt: now,
        updatedAt: now,
        completedAt: null,
      };
  const accessAtDeletion = user ? accessBucketOf(user.entitlement) : null;
  await jobRef(userId).set(job);

  for (const step of STEPS) {
    if (job.steps[step]) continue;
    try {
      await runStep(userId, job, actor, step);
      job.steps[step] = Date.now();
      job.updatedAt = Date.now();
      await jobRef(userId).set(job);
    } catch (error) {
      job.status = 'failed';
      job.lastError = stepError(step, error);
      job.updatedAt = Date.now();
      await jobRef(userId).set(job);
      logger.error('User deletion stopped', { userId, step, error });
      throw new HttpError(
        502,
        step === 'cancelRazorpay'
          ? `Deletion stopped before anything was removed — ${job.lastError}. Fix this and retry.`
          : `Deletion stopped at "${step}" — ${job.lastError}. Retry to resume from this step.`,
        'deletion_failed',
      );
    }
  }

  const completed: UserDeletionDoc = { ...job, status: 'completed', phone: null, completedAt: Date.now(), updatedAt: Date.now() };
  await jobRef(userId).set(completed);
  await audit.write({
    action: 'user.delete',
    actor,
    targetUserId: userId,
    details: {
      // No personal data: counts only, so revenue changes can be reconciled.
      accessAtDeletion,
      deletedSubscriptions: completed.deleted.subscriptions,
      deletedTransactions: completed.deleted.transactions,
      deletedPaymentsInPaise: completed.deleted.paymentsInPaise,
      resumed: !!existing,
    },
  });
  // Cached headline figures include this user — recompute on the next dashboard load.
  await refs.adminStats().doc('overview').delete().catch(() => undefined);
  return completed;
};
