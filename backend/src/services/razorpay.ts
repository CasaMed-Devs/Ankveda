import Razorpay from 'razorpay';
import { validatePaymentVerification, validateWebhookSignature } from 'razorpay/dist/utils/razorpay-utils';

import { config } from '../config';
import { HttpError } from '../lib/http';
import type { PlanDoc, PlanPeriod } from '../types';

let client: Razorpay | null = null;

export const razorpayConfigured = () => !!config.razorpay;

const getClient = () => {
  const keys = config.razorpay;
  if (!keys) throw new HttpError(503, 'Payments are not configured yet. Add Razorpay keys on the server.', 'payments_unconfigured');
  if (!client) client = new Razorpay({ key_id: keys.keyId, key_secret: keys.keySecret });
  return client;
};

// How many billing cycles a subscription runs before it ends (Razorpay requires a total_count).
const TOTAL_COUNT: Record<PlanPeriod, number> = { daily: 365, weekly: 260, monthly: 120, yearly: 10 };

export const createRazorpayPlan = async (plan: Pick<PlanDoc, 'name' | 'description' | 'priceInPaise' | 'period' | 'interval'>) => {
  const created = await getClient().plans.create({
    period: plan.period,
    interval: plan.interval,
    item: { name: plan.name, amount: plan.priceInPaise, currency: 'INR', description: plan.description ?? plan.name },
  });
  return created.id;
};

/**
 * Auto-renewing subscription. A trial is modelled as:
 *   - first recurring charge delayed by `trialDays` (start_at), and
 *   - an optional upfront add-on charged at authorisation (the trial price, e.g. ₹49).
 */
export const createRazorpaySubscription = async (args: {
  plan: PlanDoc;
  planId: string;
  uid: string;
  phone: string;
}) => {
  const { plan } = args;
  const hasTrial = plan.trialDays > 0;
  const subscription = await getClient().subscriptions.create({
    plan_id: plan.razorpayPlanId,
    total_count: TOTAL_COUNT[plan.period],
    quantity: 1,
    customer_notify: 1,
    ...(hasTrial ? { start_at: Math.floor(Date.now() / 1000) + plan.trialDays * 86_400 } : {}),
    ...(hasTrial && plan.trialPriceInPaise > 0
      ? { addons: [{ item: { name: `${plan.trialDays} day trial`, amount: plan.trialPriceInPaise, currency: 'INR' } }] }
      : {}),
    notes: { uid: args.uid, planId: args.planId, phone: args.phone },
  });
  return subscription;
};

export const fetchRazorpaySubscription = (id: string) => getClient().subscriptions.fetch(id);

export const cancelRazorpaySubscription = (id: string) => getClient().subscriptions.cancel(id, true);

export const verifyCheckoutSignature = (paymentId: string, subscriptionId: string, signature: string) => {
  const keys = config.razorpay;
  if (!keys) return false;
  return validatePaymentVerification({ subscription_id: subscriptionId, payment_id: paymentId }, signature, keys.keySecret);
};

export const verifyWebhookSignature = (rawBody: string, signature: string) => {
  const secret = config.razorpayWebhookSecret;
  if (!secret) return false;
  return validateWebhookSignature(rawBody, signature, secret);
};

/** The public key id the app passes to Razorpay Checkout. */
export const publicKeyId = () => {
  const keys = config.razorpay;
  if (!keys) throw new HttpError(503, 'Payments are not configured yet.', 'payments_unconfigured');
  return keys.keyId;
};
