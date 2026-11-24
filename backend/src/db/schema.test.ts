import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Timestamp } from 'firebase-admin/firestore';

import { fromStored, toStored } from './schema';

test('instant keys become Timestamps, other numbers stay numbers', () => {
  const stored = toStored({
    createdAt: 1_700_000_000_000,
    lockedUntil: 1_700_000_300_000,
    priceInPaise: 49_900,
    attempts: 2,
    dob: '1996-08-16',
    cancelAtPeriodEnd: true,
    entitlement: { currentPeriodEnd: 1_800_000_000_000, status: 'active', currentPeriodStart: null },
  }) as Record<string, unknown>;

  assert.ok(stored.createdAt instanceof Timestamp);
  assert.ok(stored.lockedUntil instanceof Timestamp);
  assert.equal(stored.priceInPaise, 49_900);
  assert.equal(stored.attempts, 2);
  assert.equal(stored.dob, '1996-08-16');
  assert.equal(stored.cancelAtPeriodEnd, true);
  const entitlement = stored.entitlement as Record<string, unknown>;
  assert.ok(entitlement.currentPeriodEnd instanceof Timestamp);
  assert.equal(entitlement.currentPeriodStart, null);
});

test('round trip restores epoch milliseconds', () => {
  const original = { createdAt: 1_700_000_000_123, nested: { paidAt: 1_700_000_000_456 }, list: [{ receivedAt: 5 }] };
  assert.deepEqual(fromStored(toStored(original)), original);
});
