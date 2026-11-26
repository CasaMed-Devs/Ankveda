import type { Request } from 'express';
import type { TransactionStatus } from '../types';
import { Router } from 'express';
import { z } from 'zod';

import { plansRepo, subscriptionsRepo, termsOf } from '../db/repositories/billing';
import { webhookEventsRepo } from '../db/repositories/ops';
import { uidOf } from '../lib/auth';
import { handle, HttpError, parseBody } from '../lib/http';
import { logger } from '../lib/logger';
import {
  markCancelAtPeriodEnd,
  recordTransaction,
  resolveSubscriptionId,
  syncSubscription,
  type RazorpaySubscriptionEntity,
} from '../services/billing';
import {
  canStartCheckout,
  checkoutStateOf,
  checkoutTerms,
  deferredStartFor,
  reusablePendingCheckout,
  trialAllowed,
  type CheckoutState,
  type RazorpayPaymentLike,
} from '../services/billingRules';
import { isPremiumUser, publicUser } from '../services/entitlement';
import {
  cancelRazorpaySubscription,
  createRazorpaySubscription,
  fetchRazorpayPayment,
  fetchRazorpaySubscription,
  fetchSubscriptionPaymentIds,
  publicKeyId,
  verifyCheckoutSignature,
  verifyWebhookSignature,
} from '../services/razorpay';
import { loadUser } from './me';

export const subscriptionsRouter = Router();

/**
 * Opens a checkout. Rules (services/billingRules):
 *  - allowed with no access, or with access that is ending (cancelled renewal) — a re-purchase creates a
 *    NEW subscription id that takes over access once paid; blocked while renewing or on complimentary access
 *  - the trial is offered once per account (users.trialUsedAt)
 *  - an unpaid checkout for the same plan/terms is reopened instead of creating another Razorpay subscription
 *  - price lock: the new subscription is bound to the CURRENT featured plan for life; existing subscribers
 *    (and users in a trial) stay on the plan they bought, whatever the admin changes later
 *  - re-purchase after cancelling during the trial: the new price, billed from the end of that trial
 *    (the user keeps the trial days they paid for)
 * The subscription is linked to the user (latestSubscriptionId / subscriptionIds) before checkout opens.
 */
subscriptionsRouter.post(
  '/subscriptions',
  handle(async (req, res) => {
    const uid = uidOf(req);
    const { planId } = parseBody(z.object({ planId: z.string().min(1) }), req.body);
    const user = await loadUser(uid);
    if (!canStartCheckout(user.entitlement)) throw new HttpError(409, 'You already have Ankveda Premium.', 'already_premium');

    const plan = await plansRepo.get(planId);
    if (!plan || !plan.active) throw new HttpError(404, 'This plan is no longer available. Please refresh.', 'plan_unavailable');

    const withTrial = trialAllowed(termsOf(plan), user.trialUsedAt);
    const terms = checkoutTerms(termsOf(plan), withTrial);
    // Cancelled during the trial and buying again before it ends → first charge when that trial ends.
    const current = user.entitlement?.subscriptionId ? await subscriptionsRepo.get(user.entitlement.subscriptionId) : null;
    const deferredStartAt = withTrial ? null : deferredStartFor(current);

    let subscriptionId = await reopenPendingCheckout(user.latestSubscriptionId, {
      planId,
      withTrial,
      terms,
      deferredStartAt,
    });
    if (!subscriptionId) {
      const subscription = await createRazorpaySubscription({ plan, planId, uid, phone: user.phone, withTrial, startAt: deferredStartAt });
      await subscriptionsRepo.createPending({
        subscriptionId: subscription.id,
        userId: uid,
        planId,
        totalCount: subscription.total_count,
        startAt: subscription.start_at ? subscription.start_at * 1000 : null,
        withTrial,
        deferredStartAt,
      });
      subscriptionId = subscription.id;
    }

    const billingFrom = deferredStartAt ? new Date(deferredStartAt).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' }) : null;
    res.json({
      keyId: publicKeyId(),
      subscriptionId,
      planName: plan.name,
      description:
        terms.trialDays > 0 ? `${terms.trialDays} day trial · ${plan.name}` : billingFrom ? `${plan.name} · billing from ${billingFrom}` : plan.name,
      phone: `+91${user.phone}`,
      /** Set when the first charge is deferred to the end of a cancelled trial. */
      billingStartsAt: deferredStartAt,
    });
  }),
);

/** The user's latest unpaid checkout, if it can be reopened (same plan and terms, recent, still unpaid in Razorpay). */
const reopenPendingCheckout = async (
  latestSubscriptionId: string | null | undefined,
  want: Parameters<typeof reusablePendingCheckout>[1],
) => {
  if (!latestSubscriptionId) return null;
  const pending = await subscriptionsRepo.get(latestSubscriptionId);
  if (!reusablePendingCheckout(pending, want)) return null;
  try {
    const live = await fetchRazorpaySubscription(latestSubscriptionId);
    return live.status === 'created' ? latestSubscriptionId : null;
  } catch (error) {
    logger.warn('Could not re-check pending checkout; creating a new one', { id: latestSubscriptionId, error });
    return null;
  }
};

// ── Payment confirmation: polling first, webhook as fallback ─────────────────────

/** Polls of one subscription hit Razorpay at most this often (per instance); repeats get the last answer. */
const POLL_MIN_INTERVAL_MS = 2_000;
const lastPoll = new Map<string, { at: number; state: CheckoutState }>();

/**
 * Fetches the checkout live from Razorpay and records it: the subscription (status, entitlement) and its
 * payments, tagged source 'polling'. The webhook records the same objects later (idempotent) and is
 * what completes the purchase when the app stops polling.
 * `trustedPaymentId`: a payment id whose link to this subscription is proven (checkout signature).
 * `hintPaymentId`: an unverified id from the app — only used when Razorpay says it belongs to this subscription.
 */
const pollCheckout = async (
  subscriptionId: string,
  opts: { trustedPaymentId?: string; hintPaymentId?: string | null; force?: boolean },
): Promise<CheckoutState> => {
  const cached = lastPoll.get(subscriptionId);
  if (!opts.force && cached && Date.now() - cached.at < POLL_MIN_INTERVAL_MS) return cached.state;

  const live = await fetchRazorpaySubscription(subscriptionId);
  await syncSubscription(live as RazorpaySubscriptionEntity, { event: 'poll' });

  let paymentStatus: TransactionStatus | null = null;
  const record = async (paymentId: string, verified: boolean) => {
    try {
      const payment = (await fetchRazorpayPayment(paymentId)) as RazorpayPaymentLike & { subscription_id?: string | null };
      if (!verified && (await resolveSubscriptionId(payment)) !== subscriptionId) {
        logger.warn('Polled payment does not belong to this subscription', { paymentId, subscriptionId });
        return;
      }
      const status = await recordTransaction(payment, subscriptionId, { source: 'polling' });
      paymentStatus ??= status;
    } catch (error) {
      logger.warn('Polling: payment not recorded yet (webhook will retry)', { paymentId, subscriptionId, error });
    }
  };

  if (opts.trustedPaymentId) await record(opts.trustedPaymentId, true);
  else if (opts.hintPaymentId) await record(opts.hintPaymentId, false);
  else {
    const ids = await fetchSubscriptionPaymentIds(subscriptionId).catch((error: unknown) => {
      logger.warn('Polling: could not list subscription payments', { subscriptionId, error });
      return [] as string[];
    });
    for (const id of ids) await record(id, true); // listed by Razorpay under this subscription
  }

  const state = checkoutStateOf(live.status, paymentStatus);
  if (lastPoll.size > 1_000) lastPoll.clear();
  lastPoll.set(subscriptionId, { at: Date.now(), state });
  return state;
};

/**
 * Called by the app as soon as Razorpay Checkout returns success. Checks the checkout signature, then
 * runs the first poll. Returns `state`: 'pending' tells the app to keep polling GET /subscriptions/:id/status.
 */
subscriptionsRouter.post(
  '/subscriptions/verify',
  handle(async (req, res) => {
    const uid = uidOf(req);
    const body = parseBody(
      z.object({ paymentId: z.string().min(1), subscriptionId: z.string().min(1), signature: z.string().min(1) }),
      req.body,
    );
    if (!verifyCheckoutSignature(body.paymentId, body.subscriptionId, body.signature)) {
      throw new HttpError(400, 'We could not verify this payment. If you were charged, use Restore purchases.', 'bad_signature');
    }
    const stored = await subscriptionsRepo.get(body.subscriptionId);
    if (!stored || stored.userId !== uid) throw new HttpError(403, 'This subscription belongs to another account.', 'forbidden');

    const state = await pollCheckout(body.subscriptionId, { trustedPaymentId: body.paymentId, force: true });
    res.json({ state, user: publicUser(uid, await loadUser(uid)) });
  }),
);

/**
 * Polling endpoint: the app calls it every few seconds after checkout until `state` is not 'pending'
 * (also when Checkout returned an error or the app was interrupted — the payment may still have gone
 * through). Owner only. `paymentId` (optional) is the id Checkout returned, if any.
 */
subscriptionsRouter.get(
  '/subscriptions/:id/status',
  handle(async (req, res) => {
    const uid = uidOf(req);
    const subscriptionId = String(req.params.id);
    const hint = typeof req.query.paymentId === 'string' && /^pay_[A-Za-z0-9]+$/.test(req.query.paymentId) ? req.query.paymentId : null;
    const stored = await subscriptionsRepo.get(subscriptionId);
    if (!stored || stored.userId !== uid) throw new HttpError(404, 'Subscription not found.', 'not_found');
    if (stored.source === 'admin_grant') throw new HttpError(400, 'Complimentary access has no payment.', 'complimentary');
    const state = await pollCheckout(subscriptionId, { hintPaymentId: hint });
    res.json({ state, user: publicUser(uid, await loadUser(uid)) });
  }),
);

/** Re-reads the user's recent subscriptions from Razorpay (Restore purchases). */
subscriptionsRouter.post(
  '/subscriptions/restore',
  handle(async (req, res) => {
    const uid = uidOf(req);
    const linked = (await loadUser(uid)).subscriptionIds;
    // Newest first; older accounts without the list fall back to the userId query.
    const ids = linked?.length
      ? linked.slice(-5).reverse()
      : (await subscriptionsRepo.listByUser(uid, 5)).filter((s) => s.source !== 'admin_grant').map((s) => s.id);
    for (const id of ids) {
      if (id.startsWith('grant_')) continue; // complimentary access has no Razorpay subscription
      try {
        await syncSubscription(await fetchRazorpaySubscription(id), { event: 'restore' });
      } catch (error) {
        logger.warn('Restore: could not refresh subscription', { id, error });
      }
    }
    const user = publicUser(uid, await loadUser(uid));
    res.json({ user, restored: user.entitlement.active });
  }),
);

/** Cancels at the end of the current billing cycle (access continues until then). */
subscriptionsRouter.post(
  '/subscriptions/cancel',
  handle(async (req, res) => {
    const uid = uidOf(req);
    const user = await loadUser(uid);
    const subscriptionId = user.entitlement?.subscriptionId;
    if (!subscriptionId || !isPremiumUser(user)) throw new HttpError(400, 'There is no active subscription to cancel.', 'no_subscription');
    const stored = await subscriptionsRepo.get(subscriptionId);
    if (stored?.source === 'admin_grant') {
      throw new HttpError(400, 'This is complimentary access from Ankveda — there is no payment to cancel.', 'complimentary');
    }
    const inTrial = stored?.status === 'authenticated';
    const cancelled = await cancelRazorpaySubscription(subscriptionId, !inTrial);
    await markCancelAtPeriodEnd(uid, subscriptionId);
    // Trial cancels immediately in Razorpay; sync so the status history shows it (access stays until the trial ends).
    if (inTrial) await syncSubscription(cancelled, { event: 'user.cancelled_trial' });
    res.json({ user: publicUser(uid, await loadUser(uid)) });
  }),
);

type WebhookBody = {
  event?: string;
  payload?: {
    subscription?: { entity?: RazorpaySubscriptionEntity };
    payment?: { entity?: RazorpayPaymentLike & { subscription_id?: string | null } };
    refund?: { entity?: { payment_id?: string } };
  };
};

const rawBodyOf = (req: Request) => {
  const raw = (req as Request & { rawBody?: Buffer }).rawBody;
  return raw ? raw.toString('utf8') : JSON.stringify(req.body);
};

/**
 * Razorpay webhook → <api>/webhooks/razorpay. The FALLBACK for checkouts (the app polls first) and the
 * only path for renewals, failed renewals and refunds. Subscribe to:
 *   subscription.authenticated / activated / charged / pending / halted / cancelled / completed / paused / resumed
 *   payment.authorized / captured / failed, refund.created / processed
 * Every event is claimed in webhookEvents (only a fully processed event is a duplicate, so a delivery that
 * failed is processed again on Razorpay's retry), then:
 *   subscription.* → subscriptions/{id} (+ events history, user entitlement)
 *   payments       → transactions/{paymentId}
 *   refunds        → the refunded transaction is re-read from Razorpay
 */
export const webhookRouter = Router();

webhookRouter.post(
  '/webhooks/razorpay',
  handle(async (req, res) => {
    if (!verifyWebhookSignature(rawBodyOf(req), req.header('x-razorpay-signature') ?? '')) {
      throw new HttpError(400, 'Invalid signature', 'bad_signature');
    }
    const body = req.body as WebhookBody;
    const event = body.event ?? 'unknown';
    const subscription = body.payload?.subscription?.entity;
    let payment = body.payload?.payment?.entity;
    const refund = body.payload?.refund?.entity;

    const eventId = req.header('x-razorpay-event-id') ?? null;
    if (eventId) {
      const claim = await webhookEventsRepo.claim(eventId, event, subscription?.id ?? payment?.id ?? refund?.payment_id ?? null);
      if (claim === 'done') {
        res.json({ ok: true, duplicate: true });
        return;
      }
      // Another delivery of this event is being handled right now: a non-2xx makes Razorpay retry later.
      if (claim === 'in_progress') throw new HttpError(409, 'Event is being processed', 'in_progress');
    }

    try {
      if (subscription?.id) await syncSubscription(subscription, { event, razorpayEventId: eventId });

      // Refund events carry the refund; re-read the payment so the transaction shows the refunded amount.
      if (!payment && refund?.payment_id) payment = (await fetchRazorpayPayment(refund.payment_id)) as RazorpayPaymentLike;
      if (payment?.id) {
        const subscriptionId = await resolveSubscriptionId(payment, subscription?.id);
        if (subscriptionId) await recordTransaction(payment, subscriptionId, { source: 'webhook' });
        else logger.info('Payment is not part of a subscription, ignored', { paymentId: payment.id, event });
      }
    } catch (error) {
      if (eventId) await webhookEventsRepo.release(eventId, error).catch(() => undefined);
      throw error;
    }

    if (eventId) await webhookEventsRepo.markProcessed(eventId);
    res.json({ ok: true });
  }),
);
