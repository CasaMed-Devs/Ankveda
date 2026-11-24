import { refs, db } from '../db/firestore';
import { paymentsRepo } from '../db/repositories/billing';
import { usersRepo } from '../db/repositories/users';
import { logger } from '../lib/logger';
import type { StoredEntitlement, SubscriptionDoc, UserDoc } from '../types';
import { computeEntitlement, subscriptionStateFromRazorpay } from './entitlement';
import type { fetchRazorpaySubscription } from './razorpay';

export type RazorpaySubscriptionEntity = Awaited<ReturnType<typeof fetchRazorpaySubscription>>;

/**
 * The single writer of subscription state and the user's entitlement cache.
 * Called from checkout verification, restore, cancel and webhooks — all idempotent.
 */
export const syncSubscription = async (entity: RazorpaySubscriptionEntity, eventName = 'sync') => {
  const subRef = refs.subscriptions().doc(entity.id);
  return db.runTransaction(async (tx) => {
    const stored = (await tx.get(subRef)).data();
    const notes = (entity.notes ?? {}) as Record<string, string>;
    const userId = stored?.userId ?? notes.uid;
    if (!stored || !userId) {
      logger.warn('Razorpay subscription not created through Ankveda checkout', { id: entity.id });
      return null;
    }
    const userRef = refs.user(userId);
    const user = (await tx.get(userRef)).data();
    if (!user) return null;

    const state = subscriptionStateFromRazorpay(entity);
    const now = Date.now();
    const cancelAtPeriodEnd = state.status === 'cancelled' || stored.cancelAtPeriodEnd;
    const nextSub: SubscriptionDoc = {
      ...stored,
      ...state,
      cancelAtPeriodEnd,
      cancelledAt: state.status === 'cancelled' ? (stored.cancelledAt ?? now) : stored.cancelledAt,
      lastEvent: { name: eventName, receivedAt: now },
      updatedAt: now,
    };
    tx.set(subRef, nextSub);

    const entitlement: StoredEntitlement = {
      status: nextSub.status,
      subscriptionId: entity.id,
      planId: stored.planId,
      planName: stored.planSnapshot.name,
      currentPeriodEnd: nextSub.currentPeriodEnd,
      cancelAtPeriodEnd,
    };
    // Don't let an old/other subscription overwrite a newer active one.
    const current = user.entitlement?.subscriptionId;
    const replace = !current || current === entity.id || !computeEntitlement(user.entitlement).active;
    if (replace) tx.set(userRef, usersRepo.entitlementWrite(entitlement), { merge: true });
    return replace ? ({ ...user, entitlement } as UserDoc) : user;
  });
};

/** Marks the current subscription as cancelling at period end (after Razorpay confirms). */
export const markCancelAtPeriodEnd = (userId: string, subscriptionId: string) =>
  db.runTransaction(async (tx) => {
    const userRef = refs.user(userId);
    const subRef = refs.subscriptions().doc(subscriptionId);
    const [user, sub] = [(await tx.get(userRef)).data(), (await tx.get(subRef)).data()];
    const now = Date.now();
    if (sub) tx.set(subRef, { ...sub, cancelAtPeriodEnd: true, cancelledAt: sub.cancelledAt ?? now, updatedAt: now });
    if (user?.entitlement) {
      tx.set(userRef, usersRepo.entitlementWrite({ ...user.entitlement, cancelAtPeriodEnd: true }), { merge: true });
    }
  });

type RazorpayPaymentEntity = {
  id: string;
  amount: number;
  currency: string;
  status: string;
  method?: string;
  invoice_id?: string | null;
  created_at?: number;
};

/** Writes the payments ledger from subscription.charged / payment.* webhooks. */
export const recordPayment = async (payment: RazorpayPaymentEntity, subscriptionId: string, eventName: string) => {
  const sub = (await refs.subscriptions().doc(subscriptionId).get()).data();
  if (!sub) {
    logger.warn('Payment for unknown subscription', { paymentId: payment.id, subscriptionId });
    return;
  }
  const isTrial = sub.planSnapshot.trialDays > 0 && payment.amount === sub.planSnapshot.trialPriceInPaise && sub.status !== 'active';
  await paymentsRepo.upsert(payment.id, {
    userId: sub.userId,
    subscriptionId,
    planId: sub.planId,
    amountInPaise: payment.amount,
    currency: payment.currency,
    status: payment.status === 'captured' ? 'captured' : payment.status === 'refunded' ? 'refunded' : payment.status === 'failed' ? 'failed' : 'authorized',
    method: payment.method ?? null,
    kind: isTrial ? 'trial' : eventName === 'subscription.charged' && sub.currentPeriodStart ? 'renewal' : 'first_charge',
    invoiceId: payment.invoice_id ?? null,
    paidAt: payment.created_at ? payment.created_at * 1000 : Date.now(),
  });
};
