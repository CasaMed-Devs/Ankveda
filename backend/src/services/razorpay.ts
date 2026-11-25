import Razorpay from 'razorpay';
import { validatePaymentVerification, validateWebhookSignature } from 'razorpay/dist/utils/razorpay-utils';

import { config } from '../config';
import { HttpError } from '../lib/http';
import type { PlanDoc, PlanPeriod } from '../types';
import { effectiveTerms } from './billingRules';

let client: Razorpay | null = null;

export const razorpayConfigured = () => !!config.razorpay;

const getClient = () => {
  const keys = config.razorpay;
  if (!keys) throw new HttpError(503, 'Payments are not configured yet. Add Razorpay keys on the server.', 'payments_unconfigured');
  if (!client) client = new Razorpay({ key_id: keys.keyId, key_secret: keys.keySecret });
  return client;
};

// How many billing cycles a subscription runs before it ends (Razorpay requires a total_count).
export const TOTAL_COUNT: Record<PlanPeriod, number> = { daily: 365, weekly: 260, monthly: 120, yearly: 10 };

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
 * `withTrial: false` (trial already used by this account) → no delay and no add-on: the first
 * monthly charge is taken at authorisation.
 */
export const createRazorpaySubscription = async (args: {
  plan: PlanDoc;
  planId: string;
  uid: string;
  phone: string;
  withTrial: boolean;
}) => {
  // Effective terms: a trial switched off in the admin dashboard is not applied.
  const plan = { ...args.plan, ...effectiveTerms(args.plan) };
  const hasTrial = args.withTrial && plan.trialDays > 0;
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

/** An existing Razorpay plan (admin "use existing plan id" — amount/period are validated against it). */
export const fetchRazorpayPlan = async (id: string) => {
  const plan = await getClient().plans.fetch(id);
  const item = (plan as { item?: { amount?: number | string; currency?: string; name?: string } }).item ?? {};
  return {
    id: plan.id,
    period: plan.period as PlanPeriod,
    interval: Number(plan.interval),
    amountInPaise: Number(item.amount ?? 0),
    currency: item.currency ?? 'INR',
    name: item.name ?? null,
  };
};

export const fetchRazorpaySubscription = (id: string) => getClient().subscriptions.fetch(id);

export const fetchRazorpayPayment = (id: string) => getClient().payments.fetch(id);

/** Subscription payments carry an invoice id; the invoice names the subscription. */
export const subscriptionIdForInvoice = async (invoiceId: string) =>
  ((await getClient().invoices.fetch(invoiceId)) as { subscription_id?: string | null }).subscription_id ?? null;

/**
 * Cancels renewal. During the trial (status "authenticated") Razorpay has no running cycle, so the
 * subscription is cancelled immediately — the ₹299 first charge never happens. Otherwise it ends at cycle end.
 */
export const cancelRazorpaySubscription = (id: string, atCycleEnd: boolean) => getClient().subscriptions.cancel(id, atCycleEnd);

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
