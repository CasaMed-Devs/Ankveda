import assert from 'node:assert/strict';
import { test } from 'node:test';

import { META_EVENT_NAMES } from '../types';
import {
  buildMetaEventDoc,
  META_EVENT_RETENTION_DAYS,
  metaEventBodySchema,
  metaEventDocId,
  metaEventRow,
} from './metaEventRules';

const DAY_MS = 86_400_000;
const parse = (body: unknown) => metaEventBodySchema.safeParse(body);

// ── Validation: what the app is allowed to send ──────────────────────────────

test('accepts every event the app logs', () => {
  for (const event of META_EVENT_NAMES) assert.equal(parse({ event }).success, true, event);
  assert.deepEqual([...META_EVENT_NAMES], ['CompleteRegistration', 'Login', 'ViewContent', 'InitiatedCheckout', 'Purchase']);
});

test('accepts a full Purchase payload', () => {
  const result = parse({
    event: 'Purchase',
    params: { value: 49, currency: 'INR', planId: 'plan_1', subscriptionId: 'sub_ABC', contentType: 'subscription' },
    platform: 'android',
    appVersion: '1.0.0',
    clientTime: Date.now(),
  });
  assert.equal(result.success, true);
});

test('rejects events Meta/the app does not send (install and activate are SDK-only)', () => {
  assert.equal(parse({ event: 'AppInstall' }).success, false);
  assert.equal(parse({ event: 'ActivateApp' }).success, false);
  assert.equal(parse({ event: 'purchase' }).success, false); // case-sensitive
  assert.equal(parse({}).success, false);
});

test('rejects unknown parameters, so personal data cannot be sent', () => {
  assert.equal(parse({ event: 'Login', params: { phone: '9000000001' } }).success, false);
  assert.equal(parse({ event: 'Login', params: { fullName: 'Aarav' } }).success, false);
  assert.equal(parse({ event: 'Login', params: { method: 'phone_otp', dob: '1990-01-01' } }).success, false);
});

test('rejects bad values', () => {
  assert.equal(parse({ event: 'Purchase', params: { value: -1 } }).success, false);
  assert.equal(parse({ event: 'Purchase', params: { value: Number.NaN } }).success, false);
  assert.equal(parse({ event: 'Purchase', params: { value: 2_000_000 } }).success, false);
  assert.equal(parse({ event: 'Purchase', params: { currency: 'RUPEES' } }).success, false);
  assert.equal(parse({ event: 'Purchase', params: { planId: 'x'.repeat(81) } }).success, false);
  assert.equal(parse({ event: 'Login', clientTime: -5 }).success, false);
});

// ── Stored document ──────────────────────────────────────────────────────────

test('builds the stored document with a 90-day expiry', () => {
  const now = 1_700_000_000_000;
  const doc = buildMetaEventDoc('u_1', { event: 'InitiatedCheckout', params: { value: 49, currency: 'INR', planId: 'p1' }, platform: 'android' }, now);
  assert.equal(doc.userId, 'u_1');
  assert.equal(doc.event, 'InitiatedCheckout');
  assert.deepEqual(doc.params, { value: 49, currency: 'INR', planId: 'p1' });
  assert.equal(doc.platform, 'android');
  assert.equal(doc.appVersion, null);
  assert.equal(doc.clientTime, null);
  assert.equal(doc.createdAt, now);
  assert.equal(doc.expireAt, now + META_EVENT_RETENTION_DAYS * DAY_MS);
  assert.equal(META_EVENT_RETENTION_DAYS, 90);
  assert.equal(typeof doc.schemaVersion, 'number');
});

test('an event without parameters stores empty params', () => {
  assert.deepEqual(buildMetaEventDoc('u_1', { event: 'Login' }).params, {});
});

// ── Duplicate protection ─────────────────────────────────────────────────────

test('Purchase is keyed by subscription id (reported twice → stored once)', () => {
  assert.equal(metaEventDocId({ event: 'Purchase', params: { subscriptionId: 'sub_ABC' } }), 'Purchase_sub_ABC');
  assert.equal(
    metaEventDocId({ event: 'Purchase', params: { subscriptionId: 'sub_ABC', value: 49 } }),
    metaEventDocId({ event: 'Purchase', params: { subscriptionId: 'sub_ABC', value: 299 } }),
  );
});

test('other events, and a Purchase without a subscription id, get an auto id', () => {
  assert.equal(metaEventDocId({ event: 'Login' }), null);
  assert.equal(metaEventDocId({ event: 'InitiatedCheckout', params: { subscriptionId: 'sub_ABC' } }), null);
  assert.equal(metaEventDocId({ event: 'Purchase', params: { value: 49 } }), null);
});

// ── Admin row ────────────────────────────────────────────────────────────────

test('maps a stored event to the dashboard row', () => {
  const doc = buildMetaEventDoc(
    'u_9',
    { event: 'Purchase', params: { value: 49, currency: 'INR', planId: 'p1', subscriptionId: 'sub_1' }, platform: 'android', appVersion: '1.0.0' },
    1_700_000_000_000,
  );
  const row = metaEventRow('Purchase_sub_1', doc);
  assert.equal(row.id, 'Purchase_sub_1');
  assert.equal(row.event, 'Purchase');
  assert.equal(row.userId, 'u_9');
  assert.equal(row.value, 49);
  assert.equal(row.currency, 'INR');
  assert.equal(row.planId, 'p1');
  assert.equal(row.subscriptionId, 'sub_1');
  assert.equal(row.platform, 'android');
  assert.equal(row.appVersion, '1.0.0');
  assert.equal(row.createdAt, 1_700_000_000_000);
});

test('rows for events without a value show nulls, not zeros', () => {
  const row = metaEventRow('x', buildMetaEventDoc('u_1', { event: 'ViewContent', params: { contentType: 'paywall' } }));
  assert.equal(row.value, null);
  assert.equal(row.currency, null);
  assert.equal(row.subscriptionId, null);
});
