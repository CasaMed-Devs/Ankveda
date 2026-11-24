import { refs, db } from '../db/firestore';
import { usersRepo } from '../db/repositories/users';
import { logger } from '../lib/logger';
import { SCHEMA_VERSION, type StoredEntitlement, type SubscriptionDoc, type UserDoc } from '../types';
import {
  activationTimeFor,
  capPeriodEnd,
  mergeTransaction,
  subscriptionStateFromRazorpay,
  transactionKindOf,
  type RazorpayPaymentLike,
  type RazorpaySubscriptionLike,
} from './billingRules';
import { computeEntitlement } from './entitlement';
import { issueInvoiceIfPaid } from './invoice';
import { subscriptionIdForInvoice } from './razorpay';

export type RazorpaySubscriptionEntity = RazorpaySubscriptionLike & { notes?: unknown };

type SyncSource = { event: string; razorpayEventId?: string | null };

/**
 * The single writer of subscription state and the user's entitlement cache.
 * Updates subscriptions/{id}, appends to subscriptions/{id}/events and refreshes
 * users/{userId}.entitlement — all in one Firestore transaction. Idempotent.
 */
export const syncSubscription = async (entity: RazorpaySubscriptionEntity, source: SyncSource) => {
  const subRef = refs.subscriptions().doc(entity.id);
  return db.runTransaction(async (tx) => {
    const stored = (await tx.get(subRef)).data();
    if (!stored) {
      logger.warn('Razorpay subscription not created through Ankveda checkout', { id: entity.id, event: source.event });
      return null;
    }
    const userRef = refs.user(stored.userId);
    const user = (await tx.get(userRef)).data();
    if (!user) return null;

    const state = subscriptionStateFromRazorpay(entity);
    const now = Date.now();
    const cancelAtPeriodEnd = state.status === 'cancelled' || stored.cancelAtPeriodEnd;
    // A cancelled subscription keeps access until the end of what was paid for (trial end or month end):
    // never shorten the period on cancellation.
    // An admin "expire now" (accessRevokedAt) caps the period for good.
    const currentPeriodEnd = capPeriodEnd(
      state.status === 'cancelled'
        ? Math.max(state.currentPeriodEnd ?? 0, stored.currentPeriodEnd ?? 0) || null
        : (state.currentPeriodEnd ?? stored.currentPeriodEnd),
      stored.accessRevokedAt,
    );
    const nextSub: SubscriptionDoc = {
      ...stored,
      ...state,
      razorpayCustomerId: state.razorpayCustomerId ?? stored.razorpayCustomerId,
      startAt: state.startAt ?? stored.startAt,
      currentPeriodEnd,
      totalCount: state.totalCount || stored.totalCount,
      subscriptionActivatedAt: activationTimeFor(stored.subscriptionActivatedAt ?? null, state.status, state.currentPeriodStart, now),
      cancelAtPeriodEnd,
      cancelledAt: state.status === 'cancelled' ? (stored.cancelledAt ?? now) : stored.cancelledAt,
      lastEvent: { name: source.event, receivedAt: now },
      updatedAt: now,
    };
    tx.set(subRef, nextSub);
    if (stored.status !== nextSub.status || source.razorpayEventId) {
      tx.create(refs.subscriptionEvents(entity.id).doc(), {
        event: source.event,
        fromStatus: stored.status,
        toStatus: nextSub.status,
        razorpayEventId: source.razorpayEventId ?? null,
        receivedAt: now,
      });
    }

    const entitlement: StoredEntitlement = {
      status: nextSub.status,
      subscriptionId: entity.id,
      planId: stored.planId,
      planName: stored.planSnapshot.name,
      currentPeriodEnd: nextSub.currentPeriodEnd,
      cancelAtPeriodEnd,
      source: 'razorpay',
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
    const user = (await tx.get(userRef)).data();
    const sub = (await tx.get(subRef)).data();
    const now = Date.now();
    if (sub) {
      tx.set(subRef, { ...sub, cancelAtPeriodEnd: true, cancelledAt: sub.cancelledAt ?? now, updatedAt: now });
      tx.create(refs.subscriptionEvents(subscriptionId).doc(), {
        event: 'user.cancel_requested',
        fromStatus: sub.status,
        toStatus: sub.status,
        razorpayEventId: null,
        receivedAt: now,
      });
    }
    if (user?.entitlement) {
      tx.set(userRef, usersRepo.entitlementWrite({ ...user.entitlement, cancelAtPeriodEnd: true }), { merge: true });
    }
  });

/** Finds the Razorpay subscription a payment belongs to (direct field, else via its invoice). */
export const resolveSubscriptionId = async (payment: RazorpayPaymentLike & { subscription_id?: string | null }, hint?: string | null) => {
  if (hint) return hint;
  if (payment.subscription_id) return payment.subscription_id;
  if (payment.invoice_id) {
    try {
      return await subscriptionIdForInvoice(payment.invoice_id);
    } catch (error) {
      logger.warn('Could not resolve invoice → subscription', { invoiceId: payment.invoice_id, error });
    }
  }
  return null;
};

/**
 * Upserts transactions/{razorpayPaymentId} for a subscription payment. Idempotent and order-safe:
 * keyed by the payment id, and statuses never move backwards.
 */
export const recordTransaction = async (payment: RazorpayPaymentLike, subscriptionId: string) => {
  const subRef = refs.subscriptions().doc(subscriptionId);
  const txRef = refs.transactions().doc(payment.id);
  await db.runTransaction(async (tx) => {
    const sub = (await tx.get(subRef)).data();
    if (!sub) {
      logger.warn('Payment for a subscription Ankveda does not know', { paymentId: payment.id, subscriptionId });
      return;
    }
    const existing = (await tx.get(txRef)).data() ?? null;
    const firstCharges = await tx.get(
      refs.transactions().where('subscriptionId', '==', subscriptionId).where('kind', '==', 'first_charge').where('status', '==', 'captured').limit(2),
    );
    const hasCapturedFirstCharge = firstCharges.docs.some((d) => d.id !== payment.id);
    const now = Date.now();
    const data = mergeTransaction(existing, payment, {
      userId: sub.userId,
      subscriptionId,
      planId: sub.planId,
      kind: transactionKindOf(payment, sub, hasCapturedFirstCharge),
    });
    tx.set(txRef, {
      ...data,
      // The invoice number is issued once and must survive every later webhook (e.g. a refund).
      invoiceNumber: existing?.invoiceNumber,
      invoiceIssuedAt: existing?.invoiceIssuedAt,
      schemaVersion: SCHEMA_VERSION,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });
  });
  // A captured payment gets its tax invoice number as soon as it is paid (idempotent).
  await issueInvoiceIfPaid(payment.id);
};
