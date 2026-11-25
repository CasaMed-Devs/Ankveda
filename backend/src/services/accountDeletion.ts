/**
 * "Delete account" from the app (soft delete).
 *
 * The account disappears from the app, but every record stays in the database:
 *   users/{id}                 → moved to deletedAccounts/{id} (snapshot + deletedAt)
 *   users/{id}/reports|chat…   → untouched (Firestore keeps subcollections when the parent doc is removed)
 *   subscriptions, payments, invoices → untouched, still linked by the same id
 *   phoneAccounts/{phone}      → removed, so the same number signs in as a brand-new account
 *
 * A still-billable Razorpay subscription is cancelled first (immediately — no further charges, no
 * refund). If billing cannot be stopped, nothing is deleted.
 */
import { refs, db } from '../db/firestore';
import { forgetUser } from '../lib/auth';
import { HttpError } from '../lib/http';
import { logger } from '../lib/logger';
import type { DeletedAccountDoc, SubscriptionStatus } from '../types';
import { audit } from './admin/audit';
import { syncSubscription } from './billing';
import { accessBucketOf } from './billingRules';
import { cancelRazorpaySubscription, fetchRazorpaySubscription, razorpayConfigured } from './razorpay';

/** Razorpay still charges (or may charge) a subscription in these states. */
const BILLABLE: SubscriptionStatus[] = ['created', 'authenticated', 'active', 'pending', 'halted'];

const NOT_DELETED = 'We could not cancel your subscription right now, so your account was not deleted. Please try again in a few minutes.';

/** Cancels every still-billable Razorpay subscription of the user. Throws (nothing deleted) if it can't. */
const stopBilling = async (userId: string): Promise<string[]> => {
  const subs = await refs.subscriptions().where('userId', '==', userId).get();
  const billable = subs.docs.filter((d) => (d.data().source ?? 'razorpay') === 'razorpay' && BILLABLE.includes(d.data().status));
  if (billable.length && !razorpayConfigured()) throw new HttpError(502, NOT_DELETED, 'billing_not_stopped');

  const cancelled: string[] = [];
  for (const doc of billable) {
    let entity;
    try {
      entity = await cancelRazorpaySubscription(doc.id, false);
    } catch (error) {
      // Already cancelled / completed in Razorpay is fine; anything still billing stops the deletion.
      const latest = await fetchRazorpaySubscription(doc.id).catch(() => null);
      if (!latest || BILLABLE.includes(latest.status as SubscriptionStatus)) {
        logger.error('Account deletion: could not cancel Razorpay subscription', { userId, subscriptionId: doc.id, error });
        throw new HttpError(502, NOT_DELETED, 'billing_not_stopped');
      }
      entity = latest;
    }
    // Record the cancellation in the subscription's own history.
    await syncSubscription(entity, { event: 'user.account_deleted' });
    cancelled.push(doc.id);
  }
  return cancelled;
};

export const deleteOwnAccount = async (userId: string) => {
  const existing = (await refs.user(userId).get()).data();
  if (!existing) throw new HttpError(401, 'Your account was not found. Please sign in again.', 'unauthorized');

  const billingCancelled = await stopBilling(userId);

  await db.runTransaction(async (tx) => {
    const userRef = refs.user(userId);
    const user = (await tx.get(userRef)).data();
    if (!user) return; // already deleted by a concurrent request
    const mappingRef = refs.phoneAccounts().doc(user.phone);
    const mapping = (await tx.get(mappingRef)).data();
    const now = Date.now();
    const snapshot: DeletedAccountDoc = { ...user, deletedAt: now, deletedBy: 'user', billingCancelled, updatedAt: now };
    tx.set(refs.deletedAccounts().doc(userId), snapshot);
    tx.delete(userRef); // the doc only — reports, chat and daily guidance subcollections stay in place
    if (mapping?.userId === userId) tx.delete(mappingRef);
    audit.inTx(
      tx,
      {
        action: 'account.self_delete',
        actor: null,
        targetUserId: userId,
        details: { accessAtDeletion: accessBucketOf(user.entitlement, now), cancelledSubscriptions: billingCancelled.length },
      },
      now,
    );
  });

  forgetUser(userId);
  // Headline figures include this user — recompute on the next dashboard load.
  await refs.adminStats().doc('overview').delete().catch(() => undefined);
  return { deleted: true as const, billingCancelled: billingCancelled.length };
};
