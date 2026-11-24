/**
 * Admin subscription actions. Together with services/billing.ts (Razorpay sync) these are the only
 * writers of subscriptions/{id} and users/{id}.entitlement.
 *
 *  grant          — complimentary access: subscriptions/grant_{auto} (source 'admin_grant'). No Razorpay
 *                   objects, no transactions → never counted as revenue, never shown as paid.
 *  cancel_renewal — stop future Razorpay charges; access continues until the paid period ends.
 *  expire_now     — end access immediately; a still-billable Razorpay subscription is cancelled first,
 *                   so Firestore never says "expired" while Razorpay keeps charging.
 */
import { refs, db } from '../../db/firestore';
import { plansRepo, termsOf } from '../../db/repositories/billing';
import { usersRepo } from '../../db/repositories/users';
import { DAY_MS } from '../../db/schema';
import { HttpError } from '../../lib/http';
import { logger } from '../../lib/logger';
import { SCHEMA_VERSION, type AdminActor, type AdminExpireMode, type StoredEntitlement, type SubscriptionDoc, type SubscriptionStatus } from '../../types';
import { capPeriodEnd, subscriptionStateFromRazorpay } from '../billingRules';
import { computeEntitlement } from '../entitlement';
import { cancelRazorpaySubscription, fetchRazorpaySubscription, razorpayConfigured } from '../razorpay';
import { audit } from './audit';

/** Razorpay will still charge (or may charge) a subscription in these states. */
const BILLABLE: SubscriptionStatus[] = ['created', 'authenticated', 'active', 'pending', 'halted'];

export type GrantInput = {
  planId: string;
  /** Defaults to now. May be backdated, never in the future (grants take effect immediately). */
  startAt?: number;
  durationDays?: number;
  /** Explicit expiry; wins over durationDays. */
  endAt?: number;
  notes?: string | null;
};

export const grantSubscription = async (userId: string, input: GrantInput, actor: AdminActor) => {
  const now = Date.now();
  const startAt = input.startAt ?? now;
  if (startAt > now + 60_000) {
    throw new HttpError(400, 'The start date cannot be in the future — a grant gives access immediately.', 'validation');
  }
  const endAt = input.endAt ?? (input.durationDays ? startAt + input.durationDays * DAY_MS : null);
  if (!endAt) throw new HttpError(400, 'Choose a duration or an expiry date.', 'validation');
  if (endAt <= startAt) throw new HttpError(400, 'The expiry must be after the start date.', 'validation');
  if (endAt <= now) throw new HttpError(400, 'That expiry is already in the past.', 'validation');

  const plan = await plansRepo.get(input.planId);
  if (!plan) throw new HttpError(404, 'Plan not found.', 'not_found');

  const subRef = refs.subscriptions().doc(`grant_${refs.subscriptions().doc().id}`);
  const userRef = refs.user(userId);

  return db.runTransaction(async (tx) => {
    const user = (await tx.get(userRef)).data();
    if (!user) throw new HttpError(404, 'User not found.', 'not_found');
    const current = user.entitlement;
    const currentAccess = computeEntitlement(current, now).active;
    if (currentAccess && current?.source !== 'admin_grant') {
      throw new HttpError(
        409,
        'This user has an active paid subscription. Cancel its renewal or expire it first, so Razorpay does not keep charging while the grant is active.',
        'paid_subscription_active',
      );
    }
    // A running grant is superseded: it ends when the new one starts.
    const previousGrant = currentAccess && current?.subscriptionId ? (await tx.get(refs.subscriptions().doc(current.subscriptionId))).data() : null;

    const terms = { ...termsOf(plan), trialDays: 0, trialPriceInPaise: 0 };
    const doc: SubscriptionDoc = {
      schemaVersion: SCHEMA_VERSION,
      userId,
      planId: input.planId,
      planSnapshot: terms,
      razorpayPlanId: null,
      razorpayCustomerId: null,
      status: 'active',
      startAt,
      currentPeriodStart: startAt,
      currentPeriodEnd: endAt,
      nextChargeAt: null,
      paidCount: 0,
      totalCount: 0,
      subscriptionActivatedAt: startAt,
      cancelAtPeriodEnd: false,
      cancelledAt: null,
      endedAt: null,
      lastEvent: { name: 'admin.grant', receivedAt: now },
      source: 'admin_grant',
      grant: { grantedBy: actor, notes: input.notes?.trim() || null, grantedAt: now },
      accessRevokedAt: null,
      adminAction: null,
      createdAt: now,
      updatedAt: now,
    };

    if (previousGrant && current?.subscriptionId) {
      const prevRef = refs.subscriptions().doc(current.subscriptionId);
      tx.set(prevRef, {
        ...previousGrant,
        status: 'expired',
        currentPeriodEnd: Math.min(previousGrant.currentPeriodEnd ?? now, now),
        endedAt: now,
        accessRevokedAt: now,
        lastEvent: { name: 'admin.grant_superseded', receivedAt: now },
        updatedAt: now,
      });
      tx.create(refs.subscriptionEvents(current.subscriptionId).doc(), {
        event: 'admin.grant_superseded',
        fromStatus: previousGrant.status,
        toStatus: 'expired',
        razorpayEventId: null,
        receivedAt: now,
      });
    }

    tx.create(subRef, doc);
    tx.create(refs.subscriptionEvents(subRef.id).doc(), {
      event: 'admin.grant',
      fromStatus: null,
      toStatus: 'active',
      razorpayEventId: null,
      receivedAt: now,
    });
    const entitlement: StoredEntitlement = {
      status: 'active',
      subscriptionId: subRef.id,
      planId: input.planId,
      planName: plan.name,
      currentPeriodEnd: endAt,
      cancelAtPeriodEnd: false,
      source: 'admin_grant',
    };
    tx.set(userRef, usersRepo.entitlementWrite(entitlement), { merge: true });
    audit.inTx(
      tx,
      {
        action: 'subscription.grant',
        actor,
        targetUserId: userId,
        subscriptionId: subRef.id,
        planId: input.planId,
        details: {
          planName: plan.name,
          startAt,
          endAt,
          durationDays: Math.round((endAt - startAt) / DAY_MS),
          notes: doc.grant?.notes ?? null,
          supersededGrant: previousGrant ? current?.subscriptionId : null,
        },
      },
      now,
    );
    return { id: subRef.id, ...doc };
  });
};

/** Cancels in Razorpay; if Razorpay reports it already ended, carries on with its current state. */
const cancelInRazorpay = async (subscriptionId: string, atCycleEnd: boolean) => {
  if (!razorpayConfigured()) {
    throw new HttpError(
      503,
      'Razorpay keys are not configured on the server, so billing cannot be stopped. Nothing was changed.',
      'payments_unconfigured',
    );
  }
  try {
    return await cancelRazorpaySubscription(subscriptionId, atCycleEnd);
  } catch (error) {
    const latest = await fetchRazorpaySubscription(subscriptionId).catch(() => null);
    if (latest && !BILLABLE.includes(latest.status as SubscriptionStatus)) return latest;
    logger.error('Razorpay cancel failed', { subscriptionId, atCycleEnd, error });
    const reason = (error as { error?: { description?: string } }).error?.description ?? (error as Error).message;
    throw new HttpError(502, `Razorpay could not cancel this subscription: ${reason}. Nothing was changed.`, 'razorpay_error');
  }
};

export const adminExpire = async (subscriptionId: string, mode: AdminExpireMode, notes: string | null, actor: AdminActor) => {
  const now = Date.now();
  const stored = (await refs.subscriptions().doc(subscriptionId).get()).data();
  if (!stored) throw new HttpError(404, 'Subscription not found.', 'not_found');
  const isGrant = stored.source === 'admin_grant';
  const billable = !isGrant && BILLABLE.includes(stored.status);
  const hasAccessNow = (capPeriodEnd(stored.currentPeriodEnd, stored.accessRevokedAt) ?? 0) > now && stored.status !== 'expired';

  if (mode === 'cancel_renewal') {
    if (isGrant) throw new HttpError(400, 'Complimentary grants have no billing to cancel. Use "Expire access now" instead.', 'validation');
    if (!billable || (stored.cancelAtPeriodEnd && stored.status === 'active')) {
      throw new HttpError(409, 'Renewal is already cancelled for this subscription.', 'already_cancelled');
    }
  } else if (!hasAccessNow && !billable) {
    throw new HttpError(409, 'This subscription has already ended.', 'already_expired');
  }

  // 1. Razorpay first — if it fails, nothing is written.
  let razorpayState: ReturnType<typeof subscriptionStateFromRazorpay> | null = null;
  if (billable) {
    // An active cycle can end at cycle end; trials / failed-payment states are cancelled immediately
    // (Razorpay has no running paid cycle for them). For expire_now, always immediately.
    const atCycleEnd = mode === 'cancel_renewal' && stored.status === 'active';
    razorpayState = subscriptionStateFromRazorpay(await cancelInRazorpay(subscriptionId, atCycleEnd));
  }

  // 2. Firestore: subscription + history + entitlement + audit, atomically.
  const subRef = refs.subscriptions().doc(subscriptionId);
  const userRef = refs.user(stored.userId);
  await db.runTransaction(async (tx) => {
    const sub = (await tx.get(subRef)).data();
    if (!sub) throw new HttpError(404, 'Subscription not found.', 'not_found');
    const user = (await tx.get(userRef)).data();

    const expireNow = mode === 'expire_now';
    const accessRevokedAt = expireNow ? now : (sub.accessRevokedAt ?? null);
    const status: SubscriptionStatus = isGrant ? 'expired' : (razorpayState?.status ?? sub.status);
    const periodEnd = razorpayState && status !== 'cancelled' ? (razorpayState.currentPeriodEnd ?? sub.currentPeriodEnd) : sub.currentPeriodEnd;
    const next: SubscriptionDoc = {
      ...sub,
      status,
      currentPeriodEnd: capPeriodEnd(periodEnd, accessRevokedAt),
      nextChargeAt: null,
      cancelAtPeriodEnd: true,
      cancelledAt: sub.cancelledAt ?? now,
      endedAt: expireNow ? now : (razorpayState?.endedAt ?? sub.endedAt),
      accessRevokedAt,
      adminAction: { type: mode, by: actor, notes: notes?.trim() || null, performedAt: now },
      lastEvent: { name: `admin.${mode}`, receivedAt: now },
      updatedAt: now,
    };
    tx.set(subRef, next);
    tx.create(refs.subscriptionEvents(subscriptionId).doc(), {
      event: `admin.${mode}`,
      fromStatus: sub.status,
      toStatus: status,
      razorpayEventId: null,
      receivedAt: now,
    });
    if (user?.entitlement?.subscriptionId === subscriptionId) {
      tx.set(
        userRef,
        usersRepo.entitlementWrite({
          ...user.entitlement,
          status,
          currentPeriodEnd: next.currentPeriodEnd,
          cancelAtPeriodEnd: true,
          source: sub.source ?? 'razorpay',
        }),
        { merge: true },
      );
    }
    audit.inTx(
      tx,
      {
        action: expireNow ? 'subscription.expire' : 'subscription.cancel_renewal',
        actor,
        targetUserId: sub.userId,
        subscriptionId,
        planId: sub.planId,
        details: {
          mode,
          source: sub.source ?? 'razorpay',
          fromStatus: sub.status,
          toStatus: status,
          razorpayCancelled: !!razorpayState,
          accessUntil: next.currentPeriodEnd,
          notes: notes?.trim() || null,
        },
      },
      now,
    );
  });
  return (await subRef.get()).data();
};
