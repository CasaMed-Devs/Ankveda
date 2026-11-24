import assert from 'node:assert/strict';
import { test } from 'node:test';

import { chooseLoginAccount, newUserId } from './users';

const legacyId = 'u_0123456789abcdef01234567';

test('login: the phone mapping wins when its account exists', () => {
  assert.deepEqual(chooseLoginAccount({ mappedUserId: 'u_new', mappedExists: true, legacyId, legacyExists: true }), { kind: 'mapped', userId: 'u_new' });
});

test('login: accounts from before phoneAccounts existed are adopted (same id, no migration)', () => {
  assert.deepEqual(chooseLoginAccount({ mappedUserId: null, mappedExists: false, legacyId, legacyExists: true }), { kind: 'legacy', userId: legacyId });
});

test('login: a number whose account was deleted starts a brand-new account', () => {
  // Deleted: users/{id} is gone and the mapping was removed.
  assert.deepEqual(chooseLoginAccount({ mappedUserId: null, mappedExists: false, legacyId, legacyExists: false }), { kind: 'new' });
  // A stale mapping to a missing account never resurrects anything.
  assert.deepEqual(chooseLoginAccount({ mappedUserId: 'u_gone', mappedExists: false, legacyId, legacyExists: false }), { kind: 'new' });
});

test('login: a mapping to another account never falls back to the legacy one', () => {
  assert.deepEqual(chooseLoginAccount({ mappedUserId: 'u_other', mappedExists: false, legacyId, legacyExists: true }), { kind: 'new' });
});

test('new account ids are random and keep the u_ + 24 hex format', () => {
  const a = newUserId();
  const b = newUserId();
  assert.match(a, /^u_[a-f0-9]{24}$/);
  assert.notEqual(a, b);
});
