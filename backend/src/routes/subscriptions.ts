import type { Request } from 'express';
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
import type { RazorpayPaymentLike } from '../services/billingRules';
import { isPremiumUser, publicUser } from '../services/entitlement';
import {
  cancelRazorpaySubscription,
  createRazorpaySubscription,
  fetchRazorpayPayment,
  fetchRazorpaySubscription,
  publicKeyId,
  verifyCheckoutSignature,
  verifyWebhookSignature,
} from '../services/razorpay';
import { loadUser } from './me';

export const subscriptionsRouter = Router();

subscriptionsRouter.post(
  '/subscriptions',
  handle(async (req, res) => {
    const uid = uidOf(req);
    const { planId } = parseBody(z.object({ planId: z.string().min(1) }), req.body);
    const user = await loadUser(uid);
    if (isPremiumUser(user)) throw new HttpError(409, 'You already have Ankveda Premium.', 'already_premium');

    const plan = await plansRepo.get(planId);
    if (!plan || !plan.active) throw new HttpError(404, 'This plan is no longer available. Please refresh.', 'plan_unavailable');

    const subscription = await createRazorpaySubscription({ plan, planId, uid, phone: user.phone });
    await subscriptionsRepo.createPending({
      subscriptionId: subscription.id,
      userId: uid,
      planId,
      totalCount: subscription.total_count,
      startAt: subscription.start_at ? subscription.start_at * 1000 : null,
    });

    res.json({
      keyId: publicKeyId(),
      subscriptionId: subscription.id,
      planName: plan.name,
      description: termsOf(plan).trialDays > 0 ? `${termsOf(plan).trialDays} day trial · ${plan.name}` : plan.name,
      phone: `+91${user.phone}`,
    });
  }),
);

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

    await syncSubscription(await fetchRazorpaySubscription(body.subscriptionId), { event: 'checkout.verified' });
    // Record the checkout payment now (trial amount / first charge); webhooks later keep it up to date.
    try {
      await recordTransaction((await fetchRazorpayPayment(body.paymentId)) as RazorpayPaymentLike, body.subscriptionId);
    } catch (error) {
      logger.warn('Checkout payment not recorded yet (webhook will retry)', { paymentId: body.paymentId, error });
    }
    res.json({ user: publicUser(uid, await loadUser(uid)) });
  }),
);

/** Re-reads the user's recent subscriptions from Razorpay (Restore purchases). */
subscriptionsRouter.post(
  '/subscriptions/restore',
  handle(async (req, res) => {
    const uid = uidOf(req);
    for (const sub of await subscriptionsRepo.listByUser(uid, 5)) {
      if (sub.source === 'admin_grant') continue; // complimentary access has no Razorpay subscription
      try {
        await syncSubscription(await fetchRazorpaySubscription(sub.id), { event: 'restore' });
      } catch (error) {
        logger.warn('Restore: could not refresh subscription', { id: sub.id, error });
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
 * Razorpay webhook → <api>/webhooks/razorpay. Subscribe to:
 *   subscription.authenticated / activated / charged / pending / halted / cancelled / completed / paused / resumed
 *   payment.authorized / captured / failed, refund.created / processed
 * Every delivery is recorded once (webhookEvents), then:
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
    if (eventId && !(await webhookEventsRepo.recordOnce(eventId, event, subscription?.id ?? payment?.id ?? refund?.payment_id ?? null))) {
      res.json({ ok: true, duplicate: true });
      return;
    }

    if (subscription?.id) await syncSubscription(subscription, { event, razorpayEventId: eventId });

    // Refund events carry the refund; re-read the payment so the transaction shows the refunded amount.
    if (!payment && refund?.payment_id) payment = (await fetchRazorpayPayment(refund.payment_id)) as RazorpayPaymentLike;
    if (payment?.id) {
      const subscriptionId = await resolveSubscriptionId(payment, subscription?.id);
      if (subscriptionId) await recordTransaction(payment, subscriptionId);
      else logger.info('Payment is not part of a subscription, ignored', { paymentId: payment.id, event });
    }

    if (eventId) await webhookEventsRepo.markProcessed(eventId);
    res.json({ ok: true });
  }),
);
