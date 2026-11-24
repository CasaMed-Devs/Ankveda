/**
 * GST tax invoices for Ankveda payments — ported from the Astro108 invoice service.
 *
 * One invoice per paid Razorpay payment (transactions/{paymentId}): the ₹ trial charge, the first
 * monthly charge and every renewal. Everything printed is taken from what was actually paid — the
 * transaction amount, and the plan terms snapshotted on the subscription at purchase — so a future
 * price change never alters an old invoice and new payments pick up new prices automatically.
 *
 * Admin grants create no transaction, so they can never get an invoice.
 */
import type { DocumentSnapshot } from 'firebase-admin/firestore';

import {
  INVOICE_APP_NAME,
  INVOICE_HALF_GST_RATE_PERCENT,
  INVOICE_NUMBER_PREFIX,
  INVOICE_SAC,
  INVOICE_SELLER,
} from '../config/invoice';
import { db, refs } from '../db/firestore';
import { DAY_MS } from '../db/schema';
import { logger } from '../lib/logger';
import type { PlanPeriod, SubscriptionDoc, TransactionDoc, TransactionStatus, UserDoc } from '../types';

export type InvoiceType = 'trial' | 'monthly';

/** Same shape as Astro108's Invoice (the template reads it). Money in rupees, instants as ISO strings. */
export interface Invoice {
  id: string; // transactions/{id} — the Razorpay payment id
  invoiceNumber: string;
  type: InvoiceType;
  description: string;
  status: 'paid';
  paymentId: string;
  subscriptionId: string | null;
  paymentMethod: string | null;
  paidAt: string;
  periodStart: string;
  periodEnd: string;
  currency: string;
  // taxableValue + cgst + sgst always equals amount exactly.
  amount: number;
  taxableValue: number;
  cgst: number;
  sgst: number;
  halfGstRatePercent: number;
  customer: { name: string | null; phoneNumber: string };
  appName: string;
  sac: { code: string; description: string };
  seller: typeof INVOICE_SELLER;
}

/** Admin view: the invoice plus its refund state (users never see fully refunded payments). */
export type AdminInvoice = Invoice & { refunded: boolean; refundedAmount: number };

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** Paid (and still billable) payments. Fully refunded ones are invoiced too but hidden from users. */
const BILLED: TransactionStatus[] = ['captured', 'partially_refunded', 'refunded'];

export interface GstBreakdown {
  taxableValue: number;
  cgst: number;
  sgst: number;
}

/**
 * Splits a GST-inclusive amount into its taxable value and the two equal tax halves. Each half is
 * rounded to the paisa first and the taxable value takes the remainder, so the three lines always
 * add back up to exactly what the customer paid.
 */
export function computeGstBreakdown(amountRupees: number): GstBreakdown {
  const amountPaise = Math.round(amountRupees * 100);
  const halfTaxPaise = Math.round((amountPaise * INVOICE_HALF_GST_RATE_PERCENT) / (100 + 2 * INVOICE_HALF_GST_RATE_PERCENT));
  return {
    taxableValue: (amountPaise - 2 * halfTaxPaise) / 100,
    cgst: halfTaxPaise / 100,
    sgst: halfTaxPaise / 100,
  };
}

/** "202611" for any instant in November 2026, Indian time. */
export function invoiceMonthKey(paidAt: Date): string {
  const ist = new Date(paidAt.getTime() + IST_OFFSET_MS);
  return `${ist.getUTCFullYear()}${String(ist.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function formatInvoiceNumber(monthKey: string, sequence: number): string {
  return `${INVOICE_NUMBER_PREFIX}-${monthKey}-${String(sequence).padStart(6, '0')}`;
}

/** Adds `count` months, clamping overflow (31 Jan + 1 month → 28/29 Feb, not March). */
const addMonths = (start: Date, count: number) => {
  const end = new Date(start.getTime());
  end.setUTCMonth(end.getUTCMonth() + count);
  if (end.getUTCDate() !== start.getUTCDate()) end.setUTCDate(0);
  return end;
};

/** End of one billing cycle of the plan, starting at `start`. */
export function cycleEnd(start: Date, period: PlanPeriod, interval: number): Date {
  switch (period) {
    case 'daily':
      return new Date(start.getTime() + interval * DAY_MS);
    case 'weekly':
      return new Date(start.getTime() + interval * 7 * DAY_MS);
    case 'yearly':
      return addMonths(start, 12 * interval);
    default:
      return addMonths(start, interval);
  }
}

const PERIOD_LABEL: Record<PlanPeriod, [string, string]> = {
  daily: ['day', 'days'],
  weekly: ['week', 'weeks'],
  monthly: ['month', 'months'],
  yearly: ['year', 'years'],
};

/** "Ankveda Premium (1 month)" · "5-day Trial · Ankveda Premium". From the terms the user bought. */
export function describeInvoice(type: InvoiceType, plan: Pick<SubscriptionDoc['planSnapshot'], 'name' | 'period' | 'interval' | 'trialDays'>): string {
  if (type === 'trial') return `${plan.trialDays}-day Trial · ${plan.name}`;
  const [one, many] = PERIOD_LABEL[plan.period];
  return `${plan.name} (${plan.interval === 1 ? `1 ${one}` : `${plan.interval} ${many}`})`;
}

/** Whether a payment is billed at all (users additionally never see fully refunded ones). */
export const isInvoiceable = (t: Pick<TransactionDoc, 'status' | 'amountInPaise'>, includeRefunded = false) =>
  t.amountInPaise > 0 && (includeRefunded ? BILLED.includes(t.status) : t.status === 'captured' || t.status === 'partially_refunded');

/**
 * The service period an invoice covers.
 *  - trial: paid date → the first recurring charge Razorpay was given (subscription.startAt).
 *  - monthly: paid date → one cycle later; Razorpay's own current period is used when this payment
 *    opened it (period start within a day of the payment and end at least a day after it).
 */
export function invoicePeriod(type: InvoiceType, paidAt: Date, sub: Pick<SubscriptionDoc, 'startAt' | 'currentPeriodStart' | 'currentPeriodEnd' | 'planSnapshot'>) {
  if (type === 'trial') {
    const firstCharge = sub.startAt && sub.startAt > paidAt.getTime() ? new Date(sub.startAt) : null;
    return { start: paidAt, end: firstCharge ?? new Date(paidAt.getTime() + sub.planSnapshot.trialDays * DAY_MS) };
  }
  const opened = sub.currentPeriodStart !== null && Math.abs(sub.currentPeriodStart - paidAt.getTime()) <= DAY_MS;
  if (opened && sub.currentPeriodEnd && sub.currentPeriodEnd - paidAt.getTime() >= DAY_MS) {
    return { start: paidAt, end: new Date(sub.currentPeriodEnd) };
  }
  return { start: paidAt, end: cycleEnd(paidAt, sub.planSnapshot.period, sub.planSnapshot.interval) };
}

/**
 * Gives a payment its invoice number from the per-month counter. Atomic and idempotent: two
 * concurrent calls can neither hand out the same number twice nor number the same payment twice.
 */
export async function assignInvoiceNumber(paymentId: string): Promise<string | null> {
  const txRef = refs.transactions().doc(paymentId);
  return db.runTransaction(async (tx) => {
    const payment = (await tx.get(txRef)).data();
    if (!payment || !isInvoiceable(payment, true)) return null;
    if (payment.invoiceNumber) return payment.invoiceNumber;
    const monthKey = invoiceMonthKey(new Date(payment.paymentCreatedAt));
    const counterRef = refs.counters().doc(`invoices_${monthKey}`);
    const counter = (await tx.get(counterRef)).data();
    const sequence = (counter?.lastNumber ?? 0) + 1;
    const invoiceNumber = formatInvoiceNumber(monthKey, sequence);
    const now = Date.now();
    tx.set(counterRef, { lastNumber: sequence, updatedAt: now });
    tx.set(txRef, { invoiceNumber, invoiceIssuedAt: now }, { merge: true });
    return invoiceNumber;
  });
}

/** Called after a payment is recorded: a captured payment gets its invoice number right away. */
export async function issueInvoiceIfPaid(paymentId: string) {
  try {
    await assignInvoiceNumber(paymentId);
  } catch (error) {
    // Not fatal: the number is assigned lazily the first time the invoice is read.
    logger.warn('Could not assign invoice number yet', { paymentId, error });
  }
}

const customerOf = (user: UserDoc | undefined, fallbackPhone: string | null) => ({
  name: user?.profile?.fullName?.trim() || null,
  phoneNumber: `+91${user?.phone ?? fallbackPhone ?? ''}`,
});

/** The account an invoice is billed to — the active one, or the snapshot if the user deleted it. */
const accountOf = async (userId: string): Promise<UserDoc | undefined> =>
  (await refs.user(userId).get()).data() ?? (await refs.deletedAccounts().doc(userId).get()).data();

const buildInvoice = (
  paymentId: string,
  payment: TransactionDoc & { invoiceNumber: string },
  sub: SubscriptionDoc,
  customer: Invoice['customer'],
): AdminInvoice => {
  const type: InvoiceType = payment.kind === 'trial' ? 'trial' : 'monthly';
  const paidAt = new Date(payment.paymentCreatedAt);
  const period = invoicePeriod(type, paidAt, sub);
  const amount = payment.amountInPaise / 100;
  return {
    id: paymentId,
    invoiceNumber: payment.invoiceNumber,
    type,
    description: describeInvoice(type, sub.planSnapshot),
    status: 'paid',
    paymentId,
    subscriptionId: payment.subscriptionId ?? null,
    paymentMethod: payment.method ?? null,
    paidAt: paidAt.toISOString(),
    periodStart: period.start.toISOString(),
    periodEnd: period.end.toISOString(),
    currency: payment.currency ?? 'INR',
    amount,
    ...computeGstBreakdown(amount),
    halfGstRatePercent: INVOICE_HALF_GST_RATE_PERCENT,
    customer,
    appName: INVOICE_APP_NAME,
    sac: INVOICE_SAC,
    seller: INVOICE_SELLER,
    refunded: payment.status === 'refunded',
    refundedAmount: (payment.refundedAmountInPaise ?? 0) / 100,
  };
};

/**
 * A user's invoices, newest first. Payments without a number yet (recorded before invoicing existed)
 * are numbered oldest-first so the sequence follows payment order.
 */
export async function listInvoices(userId: string, opts: { includeRefunded?: boolean } = {}): Promise<AdminInvoice[]> {
  const [account, txSnap] = await Promise.all([accountOf(userId), refs.transactions().where('userId', '==', userId).get()]);
  const billed = txSnap.docs
    .map((d) => ({ id: d.id, data: d.data() }))
    .filter((t) => isInvoiceable(t.data, opts.includeRefunded))
    .sort((a, b) => a.data.paymentCreatedAt - b.data.paymentCreatedAt);
  if (billed.length === 0) return [];

  const subIds = [...new Set(billed.map((t) => t.data.subscriptionId))];
  const subSnaps = (await db.getAll(...subIds.map((id) => refs.subscriptions().doc(id)))) as DocumentSnapshot<SubscriptionDoc>[];
  const subs = new Map(subSnaps.filter((s) => s.exists).map((s) => [s.id, s.data() as SubscriptionDoc]));
  const customer = customerOf(account, null);

  const invoices: AdminInvoice[] = [];
  for (const t of billed) {
    const sub = subs.get(t.data.subscriptionId);
    if (!sub || sub.source === 'admin_grant') continue; // grants are never invoiced
    const invoiceNumber = t.data.invoiceNumber ?? (await assignInvoiceNumber(t.id));
    if (!invoiceNumber) continue;
    invoices.push(buildInvoice(t.id, { ...t.data, invoiceNumber }, sub, customer));
  }
  return invoices.reverse();
}

/** One invoice by payment id (admin). `null` when that payment is not billed (failed, unpaid, unknown). */
export async function getInvoice(paymentId: string): Promise<AdminInvoice | null> {
  const payment = (await refs.transactions().doc(paymentId).get()).data();
  if (!payment || !isInvoiceable(payment, true)) return null;
  const [sub, user] = await Promise.all([
    refs.subscriptions().doc(payment.subscriptionId).get().then((s) => s.data()),
    accountOf(payment.userId),
  ]);
  if (!sub || sub.source === 'admin_grant') return null;
  const invoiceNumber = payment.invoiceNumber ?? (await assignInvoiceNumber(paymentId));
  if (!invoiceNumber) return null;
  return buildInvoice(paymentId, { ...payment, invoiceNumber }, sub, customerOf(user, null));
}

/** The user-facing shape (no refund fields). */
export const toPublicInvoice = ({ refunded: _r, refundedAmount: _a, ...invoice }: AdminInvoice): Invoice => invoice;
