import type {
  PlanDoc,
  PlanTerms,
  StoredEntitlement,
  SubscriptionStatus,
  TransactionDoc,
  TransactionKind,
  TransactionStatus,
} from '../types';
import { computeEntitlement } from './entitlement';

/** Razorpay subscription entity fields we read (webhook payload or API fetch). */
export type RazorpaySubscriptionLike = {
  id: string;
  status: string;
  customer_id?: string | null;
  current_start?: number | null;
  current_end?: number | null;
  start_at?: number | null;
  charge_at?: number | null;
  ended_at?: number | null;
  paid_count?: number | null;
  total_count?: number | null;
};

/** Razorpay payment entity fields we read. */
export type RazorpayPaymentLike = {
  id: string;
  amount: number;
  currency: string;
  status: string;
  method?: string | null;
  order_id?: string | null;
  invoice_id?: string | null;
  amount_refunded?: number | null;
  fee?: number | null;
  error_code?: string | null;
  error_description?: string | null;
  created_at?: number | null;
};

const ms = (seconds: number | null | undefined) => (seconds ? seconds * 1000 : null);

/** Fields of subscriptions/{id} derived from a Razorpay subscription entity. */
export const subscriptionStateFromRazorpay = (sub: RazorpaySubscriptionLike) => {
  const status = (sub.status as SubscriptionStatus) ?? 'created';
  // During a trial the subscription is "authenticated" and the first charge happens at start_at.
  const trialEnd = status === 'authenticated' ? ms(sub.start_at ?? sub.charge_at) : null;
  return {
    status,
    razorpayCustomerId: sub.customer_id ?? null,
    startAt: ms(sub.start_at),
    currentPeriodStart: ms(sub.current_start),
    currentPeriodEnd: ms(sub.current_end) ?? trialEnd ?? ms(sub.ended_at),
    nextChargeAt: ms(sub.charge_at),
    endedAt: ms(sub.ended_at),
    paidCount: sub.paid_count ?? 0,
    totalCount: sub.total_count ?? 0,
  };
};

/**
 * subscriptionActivatedAt: the first time the user got Premium access — including the trial.
 *  - "authenticated": the ₹49 trial was paid and the 5-day trial started → the time we learned of it
 *  - "active" (plans without a trial, or a missed trial event): start of the first paid cycle
 * Once set it never changes (renewals, failed payments and cancellation keep it).
 */
const ACCESS_GRANTED: SubscriptionStatus[] = ['authenticated', 'active'];

export const activationTimeFor = (
  existing: number | null,
  nextStatus: SubscriptionStatus,
  currentPeriodStart: number | null,
  now = Date.now(),
): number | null => {
  if (existing) return existing;
  if (!ACCESS_GRANTED.includes(nextStatus)) return null;
  return nextStatus === 'active' ? (currentPeriodStart ?? now) : now;
};

/** Razorpay payment status → our transaction status (accounts for full / partial refunds). */
export const transactionStatusOf = (payment: RazorpayPaymentLike): TransactionStatus => {
  const refunded = payment.amount_refunded ?? 0;
  if (payment.status === 'refunded' || (refunded > 0 && refunded >= payment.amount)) return 'refunded';
  if (refunded > 0) return 'partially_refunded';
  if (payment.status === 'captured') return 'captured';
  if (payment.status === 'authorized') return 'authorized';
  if (payment.status === 'failed') return 'failed';
  return 'created';
};

// Webhooks can arrive out of order; never move a transaction backwards (e.g. captured → authorized).
const STATUS_RANK: Record<TransactionStatus, number> = {
  created: 0,
  authorized: 1,
  failed: 1,
  captured: 2,
  partially_refunded: 3,
  refunded: 4,
};

export const laterStatus = (current: TransactionStatus | undefined, next: TransactionStatus): TransactionStatus =>
  !current || STATUS_RANK[next] >= STATUS_RANK[current] ? next : current;

/**
 * trial        — the upfront trial amount, paid before the first recurring charge (start_at)
 * first_charge — the first recurring cycle (until one has been captured)
 * renewal      — every cycle after a captured first charge (including failed renewal attempts)
 * Uses the subscription's own transaction history rather than Razorpay's paid_count, which can
 * lag when webhooks arrive out of order.
 */
export const transactionKindOf = (
  payment: RazorpayPaymentLike,
  subscription: { startAt: number | null; planSnapshot: { trialDays: number } },
  hasCapturedFirstCharge: boolean,
): TransactionKind => {
  const createdAt = ms(payment.created_at) ?? Date.now();
  if (subscription.planSnapshot.trialDays > 0 && subscription.startAt && createdAt < subscription.startAt) return 'trial';
  return hasCapturedFirstCharge ? 'renewal' : 'first_charge';
};

/** Builds / merges a transactions/{paymentId} document from a Razorpay payment entity. */
export const mergeTransaction = (
  existing: TransactionDoc | null,
  payment: RazorpayPaymentLike,
  link: { userId: string; subscriptionId: string; planId: string; kind: TransactionKind },
  now = Date.now(),
): Omit<TransactionDoc, 'schemaVersion' | 'createdAt' | 'updatedAt'> => {
  const status = laterStatus(existing?.status, transactionStatusOf(payment));
  return {
    userId: link.userId,
    subscriptionId: link.subscriptionId,
    planId: link.planId,
    razorpayInvoiceId: payment.invoice_id ?? existing?.razorpayInvoiceId ?? null,
    razorpayOrderId: payment.order_id ?? existing?.razorpayOrderId ?? null,
    amountInPaise: payment.amount,
    refundedAmountInPaise: Math.max(payment.amount_refunded ?? 0, existing?.refundedAmountInPaise ?? 0),
    feeInPaise: payment.fee ?? existing?.feeInPaise ?? null,
    currency: payment.currency,
    status,
    kind: existing?.kind ?? link.kind,
    method: payment.method ?? existing?.method ?? null,
    errorCode: payment.error_code ?? existing?.errorCode ?? null,
    errorDescription: payment.error_description ?? existing?.errorDescription ?? null,
    paymentCreatedAt: ms(payment.created_at) ?? existing?.paymentCreatedAt ?? now,
    capturedAt: existing?.capturedAt ?? (status === 'captured' || status.endsWith('refunded') ? now : null),
    failedAt: existing?.failedAt ?? (status === 'failed' ? now : null),
    refundedAt: existing?.refundedAt ?? (status.endsWith('refunded') ? now : null),
  };
};

// ── Admin rules ──────────────────────────────────────────────────────────────

/**
 * The terms a new subscriber gets. The trial is not part of the Razorpay plan (it is applied when the
 * subscription is created), so an admin can switch it off without a new plan: trialEnabled === false
 * means no trial, while the configured days / amount are kept for when it is switched back on.
 */
export const effectiveTerms = (
  plan: Pick<PlanDoc, 'name' | 'priceInPaise' | 'period' | 'interval' | 'trialDays' | 'trialPriceInPaise' | 'trialEnabled'>,
): PlanTerms => {
  const trialOn = plan.trialEnabled !== false && plan.trialDays > 0;
  return {
    name: plan.name,
    priceInPaise: plan.priceInPaise,
    period: plan.period,
    interval: plan.interval,
    trialDays: trialOn ? plan.trialDays : 0,
    trialPriceInPaise: trialOn ? plan.trialPriceInPaise : 0,
  };
};

/** An admin "expire now" caps the period for good — later webhooks cannot extend it again. */
export const capPeriodEnd = (periodEnd: number | null, accessRevokedAt: number | null | undefined): number | null => {
  if (!accessRevokedAt) return periodEnd;
  return periodEnd === null ? accessRevokedAt : Math.min(periodEnd, accessRevokedAt);
};

/**
 * What a user's access looks like right now (admin lists, filters, dashboard):
 *   free       — never subscribed
 *   trial      — in a Razorpay trial ("authenticated")
 *   paid       — paying Razorpay subscriber (active / payment retry within grace)
 *   granted    — complimentary access granted by an admin
 *   cancelling — cancelled, access continues until the paid period ends
 *   expired    — had a subscription, no access now
 */
export type AccessBucket = 'free' | 'trial' | 'paid' | 'granted' | 'cancelling' | 'expired';

export const accessBucketOf = (entitlement: StoredEntitlement | null | undefined, now = Date.now()): AccessBucket => {
  if (!entitlement || entitlement.status === 'none' || entitlement.status === 'created') return 'free';
  if (!computeEntitlement(entitlement, now).active) return 'expired';
  if (entitlement.source === 'admin_grant') return 'granted';
  if (entitlement.status === 'cancelled' || entitlement.cancelAtPeriodEnd) return 'cancelling';
  if (entitlement.status === 'authenticated') return 'trial';
  return 'paid';
};
