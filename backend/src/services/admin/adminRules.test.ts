import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { StoredEntitlement } from '../../types';
import { accessBucketOf, capPeriodEnd, effectiveTerms } from '../billingRules';
import { decodeCursor, encodeCursor, pageSizeOf } from './paging';
import { dateKeysBetween, istDateKey, istDateStart, istDayStart, istMonthStart } from './time';

const DAY = 86_400_000;
const plan = { name: 'Premium', priceInPaise: 29900, period: 'monthly' as const, interval: 1, trialDays: 5, trialPriceInPaise: 4900 };

test('effective terms: trial on by default, switched off keeps nothing for new subscribers', () => {
  assert.deepEqual(effectiveTerms(plan), plan);
  assert.deepEqual(effectiveTerms({ ...plan, trialEnabled: true }), plan);
  const off = effectiveTerms({ ...plan, trialEnabled: false });
  assert.equal(off.trialDays, 0);
  assert.equal(off.trialPriceInPaise, 0);
  assert.equal(off.priceInPaise, 29900);
  // A trial with 0 days is no trial, even if a trial price is set.
  assert.equal(effectiveTerms({ ...plan, trialDays: 0 }).trialPriceInPaise, 0);
});

test('admin revocation caps the period for good', () => {
  const now = Date.now();
  assert.equal(capPeriodEnd(now + 30 * DAY, null), now + 30 * DAY);
  assert.equal(capPeriodEnd(now + 30 * DAY, now), now);
  // A later webhook with a longer period cannot extend it.
  assert.equal(capPeriodEnd(now + 60 * DAY, now), now);
  assert.equal(capPeriodEnd(null, now), now);
  assert.equal(capPeriodEnd(now - DAY, now), now - DAY);
});

test('access buckets reflect the current time, not just the stored status', () => {
  const now = Date.now();
  const ent = (e: Partial<StoredEntitlement>): StoredEntitlement => ({
    status: 'active',
    subscriptionId: 'sub_1',
    planId: 'p1',
    planName: 'Premium',
    currentPeriodEnd: now + 10 * DAY,
    cancelAtPeriodEnd: false,
    ...e,
  });
  assert.equal(accessBucketOf(null, now), 'free');
  assert.equal(accessBucketOf(ent({ status: 'created' }), now), 'free');
  assert.equal(accessBucketOf(ent({}), now), 'paid');
  assert.equal(accessBucketOf(ent({ status: 'authenticated' }), now), 'trial');
  assert.equal(accessBucketOf(ent({ status: 'authenticated', cancelAtPeriodEnd: true }), now), 'cancelling');
  assert.equal(accessBucketOf(ent({ status: 'cancelled', cancelAtPeriodEnd: true }), now), 'cancelling');
  assert.equal(accessBucketOf(ent({ source: 'admin_grant' }), now), 'granted');
  assert.equal(accessBucketOf(ent({ source: 'admin_grant', currentPeriodEnd: now - 1 }), now), 'expired');
  assert.equal(accessBucketOf(ent({ currentPeriodEnd: now - DAY }), now), 'expired');
  assert.equal(accessBucketOf(ent({ status: 'halted' }), now), 'expired');
  // Payment retry keeps access for the grace window.
  assert.equal(accessBucketOf(ent({ status: 'pending', currentPeriodEnd: now - DAY }), now), 'paid');
});

test('cursors round-trip and reject tampering', () => {
  const c = encodeCursor({ v: 1732000000000, id: 'u_abc' });
  assert.deepEqual(decodeCursor(c), { v: 1732000000000, id: 'u_abc' });
  assert.deepEqual(decodeCursor(encodeCursor({ v: 'aarav', id: 'u_1' })), { v: 'aarav', id: 'u_1' });
  assert.equal(decodeCursor(undefined), null);
  assert.throws(() => decodeCursor('not-a-cursor'));
  assert.equal(pageSizeOf('50'), 50);
  assert.equal(pageSizeOf('1000'), 20);
  assert.equal(pageSizeOf(undefined), 20);
});

test('IST calendar maths', () => {
  // 2026-11-24 23:00 IST = 17:30 UTC
  const t = Date.parse('2026-11-24T17:30:00Z');
  assert.equal(istDateKey(t), '2026-11-24');
  assert.equal(istDayStart(t), Date.parse('2026-11-23T18:30:00Z'));
  // 00:30 IST next day is a new IST day although it is still the 24th in UTC.
  assert.equal(istDateKey(Date.parse('2026-11-24T19:00:00Z')), '2026-11-25');
  assert.equal(istDateStart('2026-11-25'), Date.parse('2026-11-24T18:30:00Z'));
  assert.equal(istMonthStart(t), Date.parse('2026-10-31T18:30:00Z'));
  assert.equal(istMonthStart(t, -1), Date.parse('2026-09-30T18:30:00Z'));
  assert.deepEqual(dateKeysBetween('2026-02-27', '2026-03-02'), ['2026-02-27', '2026-02-28', '2026-03-01', '2026-03-02']);
});
