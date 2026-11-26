import type {
  PaymentSyncSource,
  PlanDoc,
  PlanTerms,
  StoredEntitlement,
  SubscriptionDoc,
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
 * mandate_auth — a re-purchase whose billing is deferred (deferredStartAt): Razorpay's refundable autopay
 *                authorisation, taken before the first recurring charge
 * first_charge — the first recurring cycle (until one has been captured)
 * renewal      — every cycle after a captured first charge (including failed renewal attempts)
 * Uses the subscription's own transaction history rather than Razorpay's paid_count, which can
 * lag when webhooks arrive out of order.
 */
export const transactionKindOf = (
  payment: RazorpayPaymentLike,
  subscription: { startAt: number | null; planSnapshot: { trialDays: number }; deferredStartAt?: number | null },
  hasCapturedFirstCharge: boolean,
): TransactionKind => {
  const createdAt = ms(payment.created_at) ?? Date.now();
  if (subscription.planSnapshot.trialDays > 0 && subscription.startAt && createdAt < subscription.startAt) return 'trial';
  const deferredUntil = subscription.deferredStartAt ? (subscription.startAt ?? subscription.deferredStartAt) : null;
  if (deferredUntil && createdAt < deferredUntil) return 'mandate_auth';
  return hasCapturedFirstCharge ? 'renewal' : 'first_charge';
};

/**
 * What a payment of this kind should cost under the subscription's locked price (grandfathering).
 * null = not a priced charge: an autopay authorisation, or the authorisation of a free trial.
 */
export const expectedAmountOf = (
  kind: TransactionKind,
  sub: Pick<SubscriptionDoc, 'planSnapshot' | 'lockedPriceInPaise' | 'lockedTrialPriceInPaise'>,
): number | null => {
  if (kind === 'mandate_auth') return null;
  if (kind === 'trial') {
    const trialPrice = sub.lockedTrialPriceInPaise ?? sub.planSnapshot.trialPriceInPaise;
    return trialPrice > 0 ? trialPrice : null;
  }
  return sub.lockedPriceInPaise ?? sub.planSnapshot.priceInPaise;
};

/** Statuses at which a payment is settled: the first path to see one is recorded as confirmedVia. */
const SETTLED: TransactionStatus[] = ['captured', 'failed', 'partially_refunded', 'refunded'];

/** Builds / merges a transactions/{paymentId} document from a Razorpay payment entity. */
export const mergeTransaction = (
  existing: TransactionDoc | null,
  payment: RazorpayPaymentLike,
  link: {
    userId: string;
    subscriptionId: string;
    planId: string;
    kind: TransactionKind;
    source: PaymentSyncSource;
    /** expectedAmountOf() for this kind; the value already stored on the document wins. */
    expectedPriceInPaise: number | null;
  },
  now = Date.now(),
): Omit<TransactionDoc, 'schemaVersion' | 'createdAt' | 'updatedAt'> => {
  const status = laterStatus(existing?.status, transactionStatusOf(payment));
  const expected = existing && existing.expectedPriceInPaise !== undefined ? existing.expectedPriceInPaise : link.expectedPriceInPaise;
  const syncSources = existing?.syncSources ?? [];
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
    gateway: 'razorpay',
    confirmedVia: existing?.confirmedVia ?? (SETTLED.includes(status) ? link.source : null),
    syncSources: syncSources.includes(link.source) ? syncSources : [...syncSources, link.source],
    lastSyncedVia: link.source,
    lastSyncedAt: now,
    expectedPriceInPaise: expected,
    priceMismatch: expected !== null && payment.amount !== expected,
  };
};

// ── Subscription ordering ───────────────────────────────────────────────────────

/**
 * Lifecycle order of a Razorpay subscription. Same-rank moves (active / pending / halted) are normal;
 * cancelled / completed / expired are terminal.
 */
const SUBSCRIPTION_RANK: Record<SubscriptionStatus, number> = {
  none: 0,
  created: 0,
  authenticated: 1,
  active: 2,
  pending: 2,
  halted: 2,
  cancelled: 3,
  completed: 3,
  expired: 3,
};

/** Events that carry live data fetched from Razorpay (not a possibly delayed webhook snapshot). */
const LIVE_EVENTS = new Set(['checkout.verified', 'poll', 'restore', 'user.cancelled_trial', 'subscription.resumed']);

/**
 * Is this incoming subscription entity an out-of-order webhook (e.g. subscription.authenticated delivered
 * after subscription.activated)? It is stale when it moves the lifecycle backwards without a newer
 * billing cycle. Live fetches and resume events always apply.
 */
export const isStaleSubscriptionUpdate = (
  stored: Pick<SubscriptionDoc, 'status' | 'paidCount' | 'currentPeriodStart'>,
  incoming: RazorpaySubscriptionLike,
  event: string,
): boolean => {
  if (LIVE_EVENTS.has(event)) return false;
  const next = (incoming.status as SubscriptionStatus) ?? 'created';
  const nextRank = SUBSCRIPTION_RANK[next] ?? 2;
  const storedRank = SUBSCRIPTION_RANK[stored.status] ?? 2;
  if (nextRank >= storedRank) return false;
  const newerCycle =
    (incoming.paid_count ?? 0) > (stored.paidCount ?? 0) || (ms(incoming.current_start) ?? 0) > (stored.currentPeriodStart ?? 0);
  return !newerCycle;
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

// ── Checkout & re-subscribe rules ───────────────────────────────────────────────

/**
 * May this user open a new checkout?
 *  - no access, or access that is ending (cancelled renewal) on a Razorpay subscription → yes
 *  - active and renewing, or complimentary (admin grant) access → no
 */
export const canStartCheckout = (entitlement: StoredEntitlement | null | undefined, now = Date.now()): boolean => {
  if (!computeEntitlement(entitlement, now).active) return true;
  if (entitlement?.source === 'admin_grant') return false;
  return entitlement?.status === 'cancelled' || !!entitlement?.cancelAtPeriodEnd;
};

/** The trial is offered once per account: never again after it has been used. */
export const trialAllowed = (terms: Pick<PlanTerms, 'trialDays'>, trialUsedAt: number | null | undefined): boolean =>
  terms.trialDays > 0 && !trialUsedAt;

/** Terms for this checkout: the plan's terms, without the trial when the user is not eligible. */
export const checkoutTerms = (terms: PlanTerms, withTrial: boolean): PlanTerms =>
  withTrial ? terms : { ...terms, trialDays: 0, trialPriceInPaise: 0 };

/** How long an unpaid checkout may be reopened. Trial checkouts are short: Razorpay fixes start_at at creation. */
export const REUSE_TRIAL_CHECKOUT_MS = 30 * 60_000;
export const REUSE_CHECKOUT_MS = 24 * 60 * 60_000;

/** Can this unpaid checkout be reopened instead of creating a new Razorpay subscription? */
export const reusablePendingCheckout = (
  pending:
    | {
        status: SubscriptionStatus;
        planId: string;
        createdAt: number;
        planSnapshot: Pick<PlanTerms, 'trialDays'> & Partial<Pick<PlanTerms, 'priceInPaise' | 'trialPriceInPaise'>>;
        source?: string;
        deferredStartAt?: number | null;
      }
    | null
    | undefined,
  want: {
    planId: string;
    withTrial: boolean;
    /** The terms this checkout would get now: an unpaid checkout on older amounts is not reopened. */
    terms?: Pick<PlanTerms, 'priceInPaise' | 'trialPriceInPaise'>;
    deferredStartAt?: number | null;
  },
  now = Date.now(),
): boolean => {
  if (!pending || pending.status !== 'created' || pending.source === 'admin_grant') return false;
  if (pending.planId !== want.planId) return false;
  if (pending.planSnapshot.trialDays > 0 !== want.withTrial) return false;
  if (want.terms) {
    const { priceInPaise, trialPriceInPaise } = pending.planSnapshot;
    if (priceInPaise !== undefined && priceInPaise !== want.terms.priceInPaise) return false;
    if (want.withTrial && trialPriceInPaise !== undefined && trialPriceInPaise !== want.terms.trialPriceInPaise) return false;
  }
  // A deferred-start checkout has its start_at fixed in Razorpay: reuse it only for the same start.
  if ((pending.deferredStartAt ?? null) !== (want.deferredStartAt ?? null)) return false;
  const window = want.withTrial ? REUSE_TRIAL_CHECKOUT_MS : REUSE_CHECKOUT_MS;
  return now - pending.createdAt < window;
};

/**
 * Result of polling a checkout:
 *  confirmed — the subscription is authorised (trial / deferred start) or charged → Premium is on
 *  failed    — the checkout payment failed and the subscription was never authorised
 *  pending   — not settled yet (keep polling; the webhook completes it if the app gives up)
 */
export type CheckoutState = 'pending' | 'confirmed' | 'failed';

export const checkoutStateOf = (subscriptionStatus: string, paymentStatus: TransactionStatus | null): CheckoutState => {
  if (subscriptionStatus === 'authenticated' || subscriptionStatus === 'active') return 'confirmed';
  if (subscriptionStatus === 'created' && paymentStatus === 'failed') return 'failed';
  return 'pending';
};

/** Razorpay needs start_at in the future; leave room for the user to finish checkout. */
export const MIN_DEFERRED_START_MS = 30 * 60_000;

/**
 * Re-purchase after cancelling during the trial: when should billing of the new subscription start?
 * The user paid for the trial, so the new subscription's first charge waits until the cancelled trial
 * would have ended, at the NEW price (the cancelled subscription's price lock ends with it).
 * Returns that time, or null to bill immediately (no cancelled trial, or too little of it left).
 */
export const deferredStartFor = (
  previous:
    | Pick<SubscriptionDoc, 'status' | 'planSnapshot' | 'paidCount' | 'currentPeriodEnd' | 'source' | 'accessRevokedAt'>
    | null
    | undefined,
  now = Date.now(),
): number | null => {
  if (!previous || previous.source === 'admin_grant' || previous.accessRevokedAt) return null;
  if (previous.status !== 'cancelled' || previous.planSnapshot.trialDays <= 0 || previous.paidCount > 0) return null;
  if (!previous.currentPeriodEnd || previous.currentPeriodEnd - now < MIN_DEFERRED_START_MS) return null;
  return previous.currentPeriodEnd;
};

const GRANTS_ACCESS: SubscriptionStatus[] = ['authenticated', 'active'];

/**
 * Should users/{id}.entitlement point at the incoming subscription?
 * Yes when there is none, it is the same one, the current one no longer gives access, or the incoming one
 * is the user's latest checkout and now gives access (a re-purchase replaces a cancelled-but-running one).
 * Late webhooks from an older subscription never take over a newer one.
 */
export const shouldReplaceEntitlement = (
  args: {
    current: StoredEntitlement | null | undefined;
    incomingId: string;
    incomingStatus: SubscriptionStatus;
    latestSubscriptionId: string | null | undefined;
  },
  now = Date.now(),
): boolean => {
  const currentId = args.current?.subscriptionId;
  if (!currentId || currentId === args.incomingId) return true;
  if (!computeEntitlement(args.current, now).active) return true;
  return args.latestSubscriptionId === args.incomingId && GRANTS_ACCESS.includes(args.incomingStatus);
};
