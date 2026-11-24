import type { Request } from 'express';
import { Router } from 'express';
import { z } from 'zod';

import { plansRepo, subscriptionsRepo } from '../db/repositories/billing';
import { webhookEventsRepo } from '../db/repositories/ops';
import { uidOf } from '../lib/auth';
import { handle, HttpError, parseBody } from '../lib/http';
import { logger } from '../lib/logger';
import { markCancelAtPeriodEnd, recordPayment, syncSubscription, type RazorpaySubscriptionEntity } from '../services/billing';
import { isPremiumUser, publicUser } from '../services/entitlement';
import {
  cancelRazorpaySubscription,
  createRazorpaySubscription,
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
    await subscriptionsRepo.createPending(subscription.id, uid, planId);

    res.json({
      keyId: publicKeyId(),
      subscriptionId: subscription.id,
      planName: plan.name,
      description: plan.trialDays > 0 ? `${plan.trialDays} day trial · ${plan.name}` : plan.name,
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

    await syncSubscription(await fetchRazorpaySubscription(body.subscriptionId), 'checkout.verified');
    res.json({ user: publicUser(uid, await loadUser(uid)) });
  }),
);

/** Re-reads the user's recent subscriptions from Razorpay (Restore purchases). */
subscriptionsRouter.post(
  '/subscriptions/restore',
  handle(async (req, res) => {
    const uid = uidOf(req);
    for (const sub of await subscriptionsRepo.listByUser(uid, 5)) {
      try {
        await syncSubscription(await fetchRazorpaySubscription(sub.id), 'restore');
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
    await cancelRazorpaySubscription(subscriptionId);
    await markCancelAtPeriodEnd(uid, subscriptionId);
    res.json({ user: publicUser(uid, await loadUser(uid)) });
  }),
);

type WebhookBody = {
  event?: string;
  payload?: {
    subscription?: { entity?: RazorpaySubscriptionEntity };
    payment?: { entity?: Parameters<typeof recordPayment>[0] & { subscription_id?: string } };
  };
};

const rawBodyOf = (req: Request) => {
  const raw = (req as Request & { rawBody?: Buffer }).rawBody;
  return raw ? raw.toString('utf8') : JSON.stringify(req.body);
};

/**
 * Razorpay webhook (Dashboard → Webhooks → <api>/webhooks/razorpay).
 * Events: subscription.* (state) and subscription.charged / payment.* (payments ledger).
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
    const payment = body.payload?.payment?.entity;

    const eventId = req.header('x-razorpay-event-id');
    if (eventId && !(await webhookEventsRepo.recordOnce(eventId, event, subscription?.id ?? payment?.id ?? null))) {
      res.json({ ok: true, duplicate: true });
      return;
    }

    if (subscription?.id) await syncSubscription(subscription, event);
    const subscriptionId = subscription?.id ?? payment?.subscription_id;
    if (payment?.id && subscriptionId) await recordPayment(payment, subscriptionId, event);

    if (eventId) await webhookEventsRepo.markProcessed(eventId);
    res.json({ ok: true });
  }),
);
