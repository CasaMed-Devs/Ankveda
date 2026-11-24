import assert from 'node:assert/strict';
import { test } from 'node:test';

import { activationTimeFor, laterStatus, mergeTransaction, subscriptionStateFromRazorpay, transactionKindOf, transactionStatusOf } from './billingRules';

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
  const link = { userId: 'u_1', subscriptionId: 'sub_1', planId: 'plan_1', kind: 'trial' as const };
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
