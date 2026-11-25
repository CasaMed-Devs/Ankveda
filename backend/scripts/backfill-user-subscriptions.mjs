#!/usr/bin/env node
/**
 * One-time (idempotent) backfill of the user → subscription links added with "trial once / re-subscribe":
 *
 *   users/{id}.subscriptionIds       every subscription of the user, oldest first
 *   users/{id}.latestSubscriptionId  the newest one (paid or not)
 *   users/{id}.trialUsedAt           earliest subscriptionActivatedAt of a Razorpay subscription with a trial
 *
 * Dry run by default (prints what would change). Write with --apply:
 *
 *   cd backend
 *   node scripts/backfill-user-subscriptions.mjs            # dry run
 *   node scripts/backfill-user-subscriptions.mjs --apply
 *
 * Credentials: FIREBASE_SERVICE_ACCOUNT (raw/base64 JSON) or backend/service-account.json.
 * Database: FIRESTORE_DATABASE_ID (default "(default)"). Emulator: FIRESTORE_EMULATOR_HOST + GCLOUD_PROJECT.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { cert, initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

const here = dirname(fileURLToPath(import.meta.url));
const apply = process.argv.includes('--apply');
const emulator = !!process.env.FIRESTORE_EMULATOR_HOST;

const loadServiceAccount = () => {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT?.trim();
  if (raw) return JSON.parse(raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8'));
  const file = resolve(here, '..', 'service-account.json');
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
  return null;
};

const serviceAccount = emulator ? null : loadServiceAccount();
if (!emulator && !serviceAccount) {
  console.error('No credentials: set FIREBASE_SERVICE_ACCOUNT or add backend/service-account.json.');
  process.exit(1);
}
const projectId = serviceAccount?.project_id ?? process.env.GCLOUD_PROJECT ?? 'demo-ankveda';
const app = serviceAccount
  ? initializeApp({ projectId, credential: cert({ ...serviceAccount, private_key: serviceAccount.private_key.replace(/\\n/g, '\n') }) })
  : initializeApp({ projectId });
const databaseId = process.env.FIRESTORE_DATABASE_ID || '(default)';
const db = databaseId === '(default)' ? getFirestore(app) : getFirestore(app, databaseId);

const millis = (v) => (v instanceof Timestamp ? v.toMillis() : typeof v === 'number' ? v : null);

console.log(`Project ${projectId}, database ${databaseId}${emulator ? ' (emulator)' : ''} — ${apply ? 'APPLY' : 'dry run'}`);

// Group every subscription by user.
const byUser = new Map();
for (const doc of (await db.collection('subscriptions').get()).docs) {
  const s = doc.data();
  if (!s.userId) continue;
  const list = byUser.get(s.userId) ?? [];
  list.push({ id: doc.id, ...s });
  byUser.set(s.userId, list);
}

let changed = 0;
let skipped = 0;
let writer = db.batch();
let pending = 0;

for (const [userId, subs] of byUser) {
  const userRef = db.collection('users').doc(userId);
  const user = (await userRef.get()).data();
  if (!user) {
    skipped++; // deleted account (snapshot in deletedAccounts) — nothing to link
    continue;
  }
  subs.sort((a, b) => (millis(a.createdAt) ?? 0) - (millis(b.createdAt) ?? 0));
  const ids = subs.map((s) => s.id);
  const trialUses = subs
    .filter((s) => s.source !== 'admin_grant' && (s.planSnapshot?.trialDays ?? 0) > 0 && millis(s.subscriptionActivatedAt))
    .map((s) => millis(s.subscriptionActivatedAt));
  const trialUsedAt = millis(user.trialUsedAt) ?? (trialUses.length ? Math.min(...trialUses) : null);

  const next = {
    subscriptionIds: [...new Set([...(user.subscriptionIds ?? []), ...ids])],
    latestSubscriptionId: user.latestSubscriptionId ?? ids[ids.length - 1],
    trialUsedAt: trialUsedAt ? Timestamp.fromMillis(trialUsedAt) : null,
  };
  const same =
    JSON.stringify(next.subscriptionIds) === JSON.stringify(user.subscriptionIds ?? null) &&
    next.latestSubscriptionId === user.latestSubscriptionId &&
    millis(next.trialUsedAt) === millis(user.trialUsedAt ?? null);
  if (same) continue;

  changed++;
  console.log(
    `${userId}: ${ids.length} subscription(s), latest ${next.latestSubscriptionId}, trialUsedAt ${trialUsedAt ? new Date(trialUsedAt).toISOString() : '—'}`,
  );
  if (apply) {
    writer.set(userRef, { ...next, updatedAt: Timestamp.now() }, { merge: true });
    if (++pending === 400) {
      await writer.commit();
      writer = db.batch();
      pending = 0;
    }
  }
}
if (apply && pending) await writer.commit();

console.log(`\n${changed} user(s) ${apply ? 'updated' : 'would be updated'}; ${skipped} subscription owner(s) no longer exist.`);
if (!apply && changed) console.log('Re-run with --apply to write.');
