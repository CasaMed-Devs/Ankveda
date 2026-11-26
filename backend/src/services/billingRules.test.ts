import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { StoredEntitlement } from '../types';
import {
  activationTimeFor,
  canStartCheckout,
  checkoutStateOf,
  checkoutTerms,
  deferredStartFor,
  expectedAmountOf,
  isStaleSubscriptionUpdate,
  laterStatus,
  mergeTransaction,
  reusablePendingCheckout,
  shouldReplaceEntitlement,
  subscriptionStateFromRazorpay,
  transactionKindOf,
  transactionStatusOf,
  trialAllowed,
} from './billingRules';

const DAY = 86_400;
const now = Math.floor(Date.now() / 1000);
// 5-day trial at ₹49, then ₹299 / month.
const sub = { startAt: (now + 5 * DAY) * 1000, paidCount: 0, planSnapshot: { trialDays: 5, trialPriceInPaise: 4900 } };

test('trial subscription: authenticated status covers access until the first charge', () => {
  const state = subscriptionStateFromRazorpay({ id: 'sub_1', status: 'authenticated', start_at: now + 5 * DAY, charge_at: now + 5 * DAY, total_count: 120, paid_count: 0, customer_id: 'cust_1' });
  assert.equal(state.status, 'authenticated');
  assert.equal(state.currentPeriodEnd, (now + 5 * DAY) * 1000);
  assert.equal(state.nextChargeAt, (now + 5 * DAY) * 1000);
  assert.equal(state.totalCount, 120);
  assert.equal(state.razorpayCustomerId, 'cust_1');
});

test('active subscription uses the current billing period', () => {
  const state = subscriptionStateFromRazorpay({ id: 'sub_1', status: 'active', current_start: now, current_end: now + 30 * DAY, charge_at: now + 30 * DAY, paid_count: 1 });
  assert.equal(state.currentPeriodStart, now * 1000);
  assert.equal(state.currentPeriodEnd, (now + 30 * DAY) * 1000);
  assert.equal(state.paidCount, 1);
});

test('classifies ₹49 trial, first ₹299 charge and renewals (incl. failed renewals)', () => {
  assert.equal(transactionKindOf({ id: 'pay_t', amount: 4900, currency: 'INR', status: 'captured', created_at: now }, sub, false), 'trial');
  const afterTrial = now + 5 * DAY + 60;
  assert.equal(transactionKindOf({ id: 'pay_1', amount: 29900, currency: 'INR', status: 'captured', created_at: afterTrial }, sub, false), 'first_charge');
  assert.equal(transactionKindOf({ id: 'pay_2', amount: 29900, currency: 'INR', status: 'captured', created_at: afterTrial + 30 * DAY }, sub, true), 'renewal');
  assert.equal(transactionKindOf({ id: 'pay_3', amount: 29900, currency: 'INR', status: 'failed', created_at: afterTrial + 30 * DAY }, sub, true), 'renewal');
  // A failed first attempt doesn't count: the retry is still the first charge.
  assert.equal(transactionKindOf({ id: 'pay_4', amount: 29900, currency: 'INR', status: 'captured', created_at: afterTrial + 3600 }, sub, false), 'first_charge');
});

test('payment status mapping includes refunds', () => {
  assert.equal(transactionStatusOf({ id: 'p', amount: 29900, currency: 'INR', status: 'captured' }), 'captured');
  assert.equal(transactionStatusOf({ id: 'p', amount: 29900, currency: 'INR', status: 'captured', amount_refunded: 10000 }), 'partially_refunded');
  assert.equal(transactionStatusOf({ id: 'p', amount: 29900, currency: 'INR', status: 'refunded', amount_refunded: 29900 }), 'refunded');
  assert.equal(transactionStatusOf({ id: 'p', amount: 29900, currency: 'INR', status: 'failed' }), 'failed');
});

test('out-of-order webhooks never move a transaction backwards', () => {
  assert.equal(laterStatus('captured', 'authorized'), 'captured');
  assert.equal(laterStatus('authorized', 'captured'), 'captured');
  assert.equal(laterStatus('refunded', 'captured'), 'refunded');
});

test('merge keeps first-seen kind and timestamps, records failure reason', () => {
  const link = { userId: 'u_1', subscriptionId: 'sub_1', planId: 'plan_1', kind: 'trial' as const, source: 'webhook' as const, expectedPriceInPaise: 4900 };
  const failed = mergeTransaction(null, { id: 'pay_x', amount: 4900, currency: 'INR', status: 'failed', error_code: 'BAD_REQUEST_ERROR', error_description: 'Card declined', created_at: now }, link, 1000);
  assert.equal(failed.status, 'failed');
  assert.equal(failed.failedAt, 1000);
  assert.equal(failed.errorDescription, 'Card declined');
  assert.equal(failed.subscriptionId, 'sub_1');

  const captured = mergeTransaction(null, { id: 'pay_y', amount: 4900, currency: 'INR', status: 'captured', created_at: now, fee: 116 }, link, 2000);
  const replay = mergeTransaction({ ...captured, schemaVersion: 1, createdAt: 2000, updatedAt: 2000 }, { id: 'pay_y', amount: 4900, currency: 'INR', status: 'authorized', created_at: now }, { ...link, kind: 'renewal' }, 3000);
  assert.equal(replay.status, 'captured');
  assert.equal(replay.kind, 'trial');
  assert.equal(replay.capturedAt, 2000);
  assert.equal(replay.feeInPaise, 116);
});

test('subscriptionActivatedAt: set when the trial starts, never overwritten', () => {
  const cycleStart = (now + 5 * DAY) * 1000;
  assert.equal(activationTimeFor(null, 'created', null), null); // checkout not paid yet
  assert.equal(activationTimeFor(null, 'authenticated', null, 777), 777); // ₹49 trial started → counts
  assert.equal(activationTimeFor(777, 'active', cycleStart), 777); // first ₹299 charge keeps the trial start
  assert.equal(activationTimeFor(777, 'cancelled', null), 777);
  assert.equal(activationTimeFor(777, 'pending', null), 777);
  // Plan without a trial (or a missed trial event): first paid cycle start.
  assert.equal(activationTimeFor(null, 'active', cycleStart, 999), cycleStart);
  assert.equal(activationTimeFor(null, 'active', null, 999), 999);
});

// ── Checkout & re-subscribe rules ───────────────────────────────────────────────
const T = Date.now();
const ent = (over: Partial<StoredEntitlement>): StoredEntitlement => ({
  status: 'active',
  subscriptionId: 'sub_old',
  planId: 'p1',
  planName: 'Premium',
  currentPeriodEnd: T + 3 * 86_400_000,
  cancelAtPeriodEnd: false,
  source: 'razorpay',
  ...over,
});

test('checkout: allowed with no access or ending access; blocked while renewing or on a grant', () => {
  assert.equal(canStartCheckout(null, T), true);
  assert.equal(canStartCheckout(ent({ currentPeriodEnd: T - 1000 }), T), true); // expired
  assert.equal(canStartCheckout(ent({ status: 'cancelled', cancelAtPeriodEnd: true }), T), true); // cancelled trial, days left
  assert.equal(canStartCheckout(ent({ cancelAtPeriodEnd: true }), T), true); // monthly cancelled at cycle end
  assert.equal(canStartCheckout(ent({}), T), false); // renewing
  assert.equal(canStartCheckout(ent({ status: 'authenticated' }), T), false); // in trial, renewing
  assert.equal(canStartCheckout(ent({ source: 'admin_grant' }), T), false);
});

test('trial is offered once per account', () => {
  assert.equal(trialAllowed({ trialDays: 5 }, null), true);
  assert.equal(trialAllowed({ trialDays: 5 }, T - 1000), false);
  assert.equal(trialAllowed({ trialDays: 0 }, null), false);
  const terms = { name: 'Premium', priceInPaise: 29900, period: 'monthly' as const, interval: 1, trialDays: 5, trialPriceInPaise: 4900 };
  assert.deepEqual(checkoutTerms(terms, false), { ...terms, trialDays: 0, trialPriceInPaise: 0 });
  assert.deepEqual(checkoutTerms(terms, true), terms);
});

test('an unpaid checkout is reopened only for the same plan and terms, while recent', () => {
  const pending = { status: 'created' as const, planId: 'p1', createdAt: T - 10 * 60_000, planSnapshot: { trialDays: 5 } };
  assert.equal(reusablePendingCheckout(pending, { planId: 'p1', withTrial: true }, T), true);
  assert.equal(reusablePendingCheckout({ ...pending, createdAt: T - 31 * 60_000 }, { planId: 'p1', withTrial: true }, T), false); // trial window 30 min
  assert.equal(reusablePendingCheckout({ ...pending, planSnapshot: { trialDays: 0 }, createdAt: T - 23 * 3_600_000 }, { planId: 'p1', withTrial: false }, T), true);
  assert.equal(reusablePendingCheckout({ ...pending, planSnapshot: { trialDays: 0 }, createdAt: T - 25 * 3_600_000 }, { planId: 'p1', withTrial: false }, T), false);
  assert.equal(reusablePendingCheckout(pending, { planId: 'p2', withTrial: true }, T), false);
  assert.equal(reusablePendingCheckout(pending, { planId: 'p1', withTrial: false }, T), false); // trial since used
  assert.equal(reusablePendingCheckout({ ...pending, status: 'authenticated' }, { planId: 'p1', withTrial: true }, T), false);
  assert.equal(reusablePendingCheckout(null, { planId: 'p1', withTrial: true }, T), false);
});

test('entitlement: a paid re-purchase takes over; late webhooks from the old subscription do not', () => {
  const cancelledTrial = ent({ status: 'cancelled', cancelAtPeriodEnd: true });
  // New monthly subscription paid while the cancelled trial still has days left.
  assert.equal(shouldReplaceEntitlement({ current: cancelledTrial, incomingId: 'sub_new', incomingStatus: 'active', latestSubscriptionId: 'sub_new' }, T), true);
  // The new checkout is still unpaid → keep the old access.
  assert.equal(shouldReplaceEntitlement({ current: cancelledTrial, incomingId: 'sub_new', incomingStatus: 'created', latestSubscriptionId: 'sub_new' }, T), false);
  // Old subscription's late webhook after the new one took over.
  const onNew = ent({ subscriptionId: 'sub_new' });
  assert.equal(shouldReplaceEntitlement({ current: onNew, incomingId: 'sub_old', incomingStatus: 'cancelled', latestSubscriptionId: 'sub_new' }, T), false);
  // Same subscription, nothing set yet, or current expired.
  assert.equal(shouldReplaceEntitlement({ current: onNew, incomingId: 'sub_new', incomingStatus: 'halted', latestSubscriptionId: 'sub_new' }, T), true);
  assert.equal(shouldReplaceEntitlement({ current: null, incomingId: 'sub_a', incomingStatus: 'created', latestSubscriptionId: null }, T), true);
  assert.equal(shouldReplaceEntitlement({ current: ent({ currentPeriodEnd: T - 1 }), incomingId: 'sub_b', incomingStatus: 'created', latestSubscriptionId: 'sub_b' }, T), true);
});

// ── Gateway / confirmation source ───────────────────────────────────────────────

test('transactions record the gateway, the first path that confirmed them, and every path', () => {
  const link = { userId: 'u_1', subscriptionId: 'sub_1', planId: 'plan_1', kind: 'first_charge' as const, expectedPriceInPaise: 29900 };
  const pay = { id: 'pay_z', amount: 29900, currency: 'INR', created_at: now };
  // Polling sees it authorized first (not settled yet), then captured.
  const seen = mergeTransaction(null, { ...pay, status: 'authorized' }, { ...link, source: 'polling' }, 1000);
  assert.equal(seen.gateway, 'razorpay');
  assert.equal(seen.confirmedVia, null);
  const polled = mergeTransaction({ ...seen, schemaVersion: 1, createdAt: 1000, updatedAt: 1000 }, { ...pay, status: 'captured' }, { ...link, source: 'polling' }, 2000);
  assert.equal(polled.confirmedVia, 'polling');
  // The webhook arrives later: confirmedVia stays, both sources are listed.
  const hooked = mergeTransaction({ ...polled, schemaVersion: 1, createdAt: 1000, updatedAt: 2000 }, { ...pay, status: 'captured' }, { ...link, source: 'webhook' }, 3000);
  assert.equal(hooked.confirmedVia, 'polling');
  assert.deepEqual(hooked.syncSources, ['polling', 'webhook']);
  assert.equal(hooked.lastSyncedVia, 'webhook');
  // The app never polled: the webhook confirms it.
  const onlyHook = mergeTransaction(null, { ...pay, status: 'captured' }, { ...link, source: 'webhook' }, 1000);
  assert.equal(onlyHook.confirmedVia, 'webhook');
});

test('checkout poll state', () => {
  assert.equal(checkoutStateOf('authenticated', 'captured'), 'confirmed');
  assert.equal(checkoutStateOf('active', null), 'confirmed');
  assert.equal(checkoutStateOf('created', 'failed'), 'failed');
  assert.equal(checkoutStateOf('created', null), 'pending');
  assert.equal(checkoutStateOf('created', 'captured'), 'pending');
});

// ── Price lock (grandfathering) ───────────────────────────────────────────────────

test('price lock: charges are checked against the locked price, not the current plan', () => {
  // Bought at ₹299 with a ₹49 trial; the admin has since moved new users to ₹399.
  const snapshot = { name: 'P', priceInPaise: 29900, period: 'monthly' as const, interval: 1, trialDays: 5, trialPriceInPaise: 4900 };
  const locked = { planSnapshot: snapshot, lockedPriceInPaise: 29900, lockedTrialPriceInPaise: 4900 };
  assert.equal(expectedAmountOf('trial', locked), 4900);
  assert.equal(expectedAmountOf('first_charge', locked), 29900);
  assert.equal(expectedAmountOf('renewal', locked), 29900);
  assert.equal(expectedAmountOf('mandate_auth', locked), null);
  // Older documents without lock fields fall back to the snapshot; a free trial has no priced charge.
  const legacy = { planSnapshot: { ...snapshot, trialPriceInPaise: 0 } };
  assert.equal(expectedAmountOf('renewal', legacy), 29900);
  assert.equal(expectedAmountOf('trial', legacy), null);

  const link = { userId: 'u', subscriptionId: 's', planId: 'p', kind: 'renewal' as const, source: 'webhook' as const, expectedPriceInPaise: 29900 };
  assert.equal(mergeTransaction(null, { id: 'p1', amount: 29900, currency: 'INR', status: 'captured' }, link).priceMismatch, false);
  assert.equal(mergeTransaction(null, { id: 'p2', amount: 39900, currency: 'INR', status: 'captured' }, link).priceMismatch, true);
});

test('re-purchase after cancelling the trial: billing deferred to the old trial end', () => {
  const trialEnd = T + 3 * 86_400_000;
  const snapshot = { name: 'P', priceInPaise: 29900, period: 'monthly' as const, interval: 1, trialDays: 5, trialPriceInPaise: 4900 };
  const cancelledTrial = {
    status: 'cancelled' as const,
    planSnapshot: snapshot,
    paidCount: 0,
    currentPeriodEnd: trialEnd,
    source: 'razorpay' as const,
    accessRevokedAt: null,
  };
  assert.equal(deferredStartFor(cancelledTrial, T), trialEnd);
  // Trial already over, or almost over → bill now.
  assert.equal(deferredStartFor({ ...cancelledTrial, currentPeriodEnd: T - 1 }, T), null);
  assert.equal(deferredStartFor({ ...cancelledTrial, currentPeriodEnd: T + 5 * 60_000 }, T), null);
  // A paid subscription cancelled at cycle end, a non-trial one, a grant, revoked access, or still in trial → bill now.
  assert.equal(deferredStartFor({ ...cancelledTrial, paidCount: 1 }, T), null);
  assert.equal(deferredStartFor({ ...cancelledTrial, planSnapshot: { ...snapshot, trialDays: 0 } }, T), null);
  assert.equal(deferredStartFor({ ...cancelledTrial, source: 'admin_grant' as const }, T), null);
  assert.equal(deferredStartFor({ ...cancelledTrial, accessRevokedAt: T - 1 }, T), null);
  assert.equal(deferredStartFor({ ...cancelledTrial, status: 'authenticated' as const }, T), null);
  assert.equal(deferredStartFor(null, T), null);

  // Payments before the deferred start are the autopay authorisation; the charge at the start is the first charge.
  const deferredSub = { startAt: trialEnd, deferredStartAt: trialEnd, planSnapshot: { trialDays: 0 } };
  const sec = Math.floor(T / 1000);
  assert.equal(transactionKindOf({ id: 'a', amount: 500, currency: 'INR', status: 'refunded', created_at: sec }, deferredSub, false), 'mandate_auth');
  assert.equal(
    transactionKindOf({ id: 'b', amount: 39900, currency: 'INR', status: 'captured', created_at: Math.floor(trialEnd / 1000) + 60 }, deferredSub, false),
    'first_charge',
  );
});

test('an unpaid checkout is not reopened after a price change or for a different deferred start', () => {
  const pending = { status: 'created' as const, planId: 'p1', createdAt: T - 10 * 60_000, planSnapshot: { trialDays: 5, priceInPaise: 29900, trialPriceInPaise: 4900 } };
  assert.equal(reusablePendingCheckout(pending, { planId: 'p1', withTrial: true, terms: { priceInPaise: 29900, trialPriceInPaise: 4900 } }, T), true);
  // Trial amount edited in place by the admin.
  assert.equal(reusablePendingCheckout(pending, { planId: 'p1', withTrial: true, terms: { priceInPaise: 29900, trialPriceInPaise: 9900 } }, T), false);
  const deferred = { ...pending, planSnapshot: { ...pending.planSnapshot, trialDays: 0 }, deferredStartAt: T + 86_400_000 };
  assert.equal(reusablePendingCheckout(deferred, { planId: 'p1', withTrial: false, deferredStartAt: T + 86_400_000 }, T), true);
  assert.equal(reusablePendingCheckout(deferred, { planId: 'p1', withTrial: false, deferredStartAt: null }, T), false);
});

// ── Out-of-order subscription webhooks ──────────────────────────────────────────

test('a late webhook cannot move a subscription backwards', () => {
  const active = { status: 'active' as const, paidCount: 1, currentPeriodStart: (now + 5 * DAY) * 1000 };
  // subscription.authenticated delivered after subscription.activated.
  assert.equal(isStaleSubscriptionUpdate(active, { id: 's', status: 'authenticated', paid_count: 0 }, 'subscription.authenticated'), true);
  // Normal moves.
  assert.equal(isStaleSubscriptionUpdate(active, { id: 's', status: 'pending', paid_count: 1 }, 'subscription.pending'), false);
  assert.equal(isStaleSubscriptionUpdate(active, { id: 's', status: 'cancelled', paid_count: 1 }, 'subscription.cancelled'), false);
  // A cancelled trial is not revived by its delayed authenticated webhook…
  const cancelled = { status: 'cancelled' as const, paidCount: 0, currentPeriodStart: null };
  assert.equal(isStaleSubscriptionUpdate(cancelled, { id: 's', status: 'authenticated', paid_count: 0 }, 'subscription.authenticated'), true);
  // …but a resume, or live data from polling / restore, always applies.
  assert.equal(isStaleSubscriptionUpdate(cancelled, { id: 's', status: 'active', paid_count: 0 }, 'subscription.resumed'), false);
  assert.equal(isStaleSubscriptionUpdate(cancelled, { id: 's', status: 'authenticated', paid_count: 0 }, 'poll'), false);
  // A newer billing cycle is never stale.
  assert.equal(isStaleSubscriptionUpdate(cancelled, { id: 's', status: 'active', paid_count: 1 }, 'subscription.charged'), false);
});
