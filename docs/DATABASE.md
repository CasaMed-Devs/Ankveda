# Ankveda — Firestore data model (schema v1)

Firebase project `ankveda-e6471`, database `(default)`, location **asia-south2 (Delhi)**.
Only the backend reads and writes Firestore (Admin SDK). Client access is denied by `firestore.rules`.
Code: types in `backend/src/types.ts`, typed refs in `backend/src/db/firestore.ts`, all access in `backend/src/db/repositories/*`.

## Entity relationships

```
                 ┌──────────────┐        ┌───────────────────┐
                 │   plans      │1      N│  subscriptions    │N      1┌──────────────────────────────┐
                 │ {planId}     ├────────┤ {razorpaySubId}   ├────────┤ users {userId}               │
                 └──────┬───────┘        │ userId → users    │        │  ├─ reports/{reportId}       │
                        │1               │ planId → plans    │        │  ├─ chatMessages/{messageId} │
                        │                └────────┬──────────┘        │  └─ dailyGuidance/{date}     │
                        │                         │1                  └──────────────┬───────────────┘
                        │N                        │N                                 │1
                 ┌──────┴───────┐        ┌────────┴──────────┐                       │
                 │ adminAuditLog│        │  payments         │N──────────────────────┘
                 │ planId→plans │        │ {razorpayPayId}   │  userId → users
                 └──────────────┘        │ subscriptionId →  │
                                         └───────────────────┘
  otpChallenges/{phone} (TTL)      webhookEvents/{razorpayEventId} (TTL, dedupe)
```

## Collections

| Collection | Document id | Purpose | References |
|---|---|---|---|
| `users` | `u_` + sha256("+91"+phone)[:24] | Account, profile (name, DOB, derived numbers), entitlement cache, chat session | — |
| `users/{id}/reports` | auto | One numerology report (input, status, generated content) | parent user; `userId` denormalised for collection-group queries |
| `users/{id}/chatMessages` | auto | Astrologer chat history | parent user |
| `users/{id}/dailyGuidance` | `YYYY-MM-DD` (IST) | Daily lucky number, time, message (TTL 30 days) | parent user |
| `plans` | auto | Paywall plans (price, period, trial) mirrored to Razorpay plans | — |
| `subscriptions` | Razorpay subscription id | Subscription state + `planSnapshot` (terms at purchase) | `userId` → users, `planId` → plans |
| `payments` | Razorpay payment id | Payment ledger from webhooks (trial, first charge, renewals) | `userId`, `subscriptionId`, `planId` |
| `otpChallenges` | phone | Hashed login code, attempts (TTL) | — |
| `webhookEvents` | Razorpay event id | Exactly-once webhook processing (TTL 30 days) | — |
| `adminAuditLog` | auto | Who changed which plan, when | `planId` → plans |

## Design decisions

- **Natural keys as document ids.** Phone hash, Razorpay ids and dates make writes idempotent: a retried webhook or a double-tap upserts the same document instead of creating duplicates. It also means a webhook needs no query, just a direct lookup by id.
- **Subcollections for user-owned data.** Ownership is in the path. Per-user queries need no composite index. Deleting an account later is one `recursiveDelete(users/{id})`. Admin and analytics use `collectionGroup('reports')`.
- **Top-level collections for billing.** Webhooks arrive with only Razorpay ids, and finance views span all users.
- **References are string ids, not `DocumentReference`.** They are portable in JSON, logs, the admin page and exports.
- **Snapshots for history.** `subscriptions.planSnapshot` and `reports.profileSnapshot` keep the facts at the time, even after a plan or the profile changes.
- **Denormalised cache with a single writer.** `users.entitlement` is derived only from `subscriptions/{id}`, inside `syncSubscription()` (a transaction), so it cannot drift.
- **Instants are stored as Timestamps.** Any field named `…At`, `…Start`, `…End` or `…Until` is a Firestore Timestamp; the converters handle this. The API still returns epoch ms. `dob` is a calendar-date string.
- **Every document has `schemaVersion`, `createdAt` and `updatedAt`.** Future migrations can find older documents by version.

## Integrity rules (Firestore has no FK constraints, so the repositories enforce them)

1. Children are created in transactions that read the parents first. For example, `subscriptionsRepo.createPending` checks that the user and the plan exist.
2. Plans are never deleted. Deactivating sets `archivedAt`, because subscriptions reference them.
3. Report generation uses a claim lock (`lockedUntil`, `attempts`). The Vercel inline runner and the Firebase trigger may both see a report, but only one processes it. A report stuck in `processing` for more than 6 minutes is shown as failed so the user can retry.
4. Webhooks are recorded with `create()` on the event id, so a concurrent duplicate delivery loses and is ignored.
5. Writes go through `set()` and the converters, never `update()`, which would skip the Timestamp conversion.

## Indexes & TTL (`firestore.indexes.json`)

- `subscriptions(userId ↑, createdAt ↓)`: restore purchases
- `payments(userId ↑, paidAt ↓)` and `payments(subscriptionId ↑, paidAt ↓)`: billing history
- collection group `reports(status ↑, updatedAt ↑)`: admin and stuck-job queries
- TTL on `otpChallenges.expireAt`, `webhookEvents.expireAt` and `dailyGuidance.expireAt`

Deploy with `npx firebase-tools deploy --only firestore`.

## What to revisit as the app grows

- **Account deletion** (a Google Play requirement): `recursiveDelete(users/{id})` after cancelling the Razorpay renewal. The schema already supports it.
- **Separate staging data.** Staging (Vercel) and production (Firebase) currently share `(default)`. A second database, `staging`, needs only `FIRESTORE_DATABASE_ID=staging` on Vercel.
- **Analytics.** Export to BigQuery (Firebase extension) instead of running heavy queries on Firestore.
- **Chat volume.** If histories grow large, page `chatMessages` by `createdAt` and summarise older turns.
