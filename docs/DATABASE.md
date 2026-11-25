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
                 │ adminAuditLog│        │  transactions     │N──────────────────────┘
                 │ planId→plans │        │ {razorpayPayId}   │  userId → users
                 └──────────────┘        │ subscriptionId →  │
                                         └───────────────────┘
  otpChallenges/{phone} (TTL)      webhookEvents/{razorpayEventId} (TTL, dedupe)
```

## Collections

| Collection | Document id | Purpose | References |
|---|---|---|---|
| `users` | `u_` + 24 hex — random for accounts created now; `sha256("+91"+phone)[:24]` for older ones | **Active** accounts only: profile (name, DOB, derived numbers), entitlement cache, chat session | — |
| `phoneAccounts` | phone (10 digits) | The phone number's **current** account (`userId`). Login resolves through it; removed when that account is deleted | `userId` → users |
| `deletedAccounts` | user id | Snapshot of an account the user deleted from the app (`deletedAt`, `deletedBy`, `billingCancelled`). Its subcollections, subscriptions, payments and invoices stay in place under the same id | — |
| `users/{id}/reports` | auto | One numerology report (input, status, generated content) | parent user; `userId` denormalised for collection-group queries |
| `users/{id}/chatMessages` | auto | Astrologer chat history | parent user |
| `users/{id}/dailyGuidance` | `YYYY-MM-DD` (IST) | Daily lucky number, time, message (TTL 30 days) | parent user |
| `plans` | auto | Paywall plans (price, period, trial) mirrored to Razorpay plans | — |
| `subscriptions` | **Razorpay subscription id** | Subscription state, `planSnapshot` (terms at purchase), Razorpay plan/customer ids, paid/total cycles, next charge, `subscriptionActivatedAt` (when the user got the subscription, counting the trial — set when the ₹49 trial starts, or at the first charge for plans without a trial; set once) | `userId` → users, `planId` → plans |
| `subscriptions/{id}/events` | auto | Append-only status history (`fromStatus → toStatus`, Razorpay event id) | parent subscription |
| `transactions` | **Razorpay payment id** | Every payment attempt: trial ₹49, first charge, renewals, failures (with reason), refunds | `subscriptionId` → subscriptions, `userId`, `planId` |
| `counters` | `invoices_{YYYYMM}` (IST) | Last tax-invoice sequence issued that month (`lastNumber`) — never reset or reused | — |
| `otpChallenges` | phone | Hashed login code, attempts (TTL) | — |
| `webhookEvents` | Razorpay event id | Exactly-once webhook processing (TTL 30 days) | — |
| `adminAuditLog` | auto (`login_{uid}_{authTime}` for logins) | Append-only admin audit: `action`, `actor {uid,email}`, `targetUserId`, `subscriptionId`, `planId`, `details`. Written only by the backend, in the same transaction as the change. Entries from before admin accounts have no `actor` | `targetUserId` → users, `planId` → plans |
| `adminStats/overview` | `overview` | Cached dashboard figures (aggregation queries, recomputed after 5 min) | — |
| `adminDailyStats` | `YYYY-MM` (IST) | `days.{DD}`: registrations, net revenue, payments, failed payments, subscriptions started, grants. A day is final 3 days after it ends; newer days refresh every 10 min | — |
| `userDeletions` | user id | Resumable permanent-deletion job: steps done, counts deleted, last error. Holds the phone only until the job completes | `userId` (deleted) |

### Admin fields (all optional — documents written before the admin dashboard stay valid)

| Field | Meaning |
|---|---|
| `users.nameLower` | Normalised lower-case full name for admin prefix search (written with the profile; Settings → *Rebuild name search* backfills) |
| `users.entitlement.source`, `subscriptions.source` | `razorpay` (missing = razorpay) or `admin_grant` |
| `subscriptions/grant_{auto}` | Complimentary access granted by an admin: `source: admin_grant`, `grant {grantedBy, notes, grantedAt}`, `razorpayPlanId: null`, no Razorpay objects and **no transactions** (never revenue) |
| `subscriptions.accessRevokedAt` | Set by *Expire access immediately*. Caps `currentPeriodEnd` permanently — `syncSubscription` applies the cap, so a later Razorpay webhook cannot restore access |
| `subscriptions.adminAction` | Last admin action (`cancel_renewal` / `expire_now`), who, when, notes |
| `plans.trialEnabled` | `false` = no trial for new subscribers while keeping the configured days/amount (`effectiveTerms()`); missing = on |
| `plans.updatedBy` | Admin who last changed the plan |
| `transactions.invoiceNumber`, `invoiceIssuedAt` | GST tax invoice `ANK-YYYYMM-000001`, issued once when the payment is captured (`services/invoice.ts`); kept through every later webhook |

## Design decisions

- **Natural keys as document ids.** Phone hash, Razorpay ids and dates make writes idempotent: a retried webhook or a double-tap upserts the same document instead of creating duplicates. It also means a webhook needs no query, just a direct lookup by id.
- **Subcollections for user-owned data.** Ownership is in the path. Per-user queries need no composite index. Deleting an account later is one `recursiveDelete(users/{id})`. Admin and analytics use `collectionGroup('reports')`.
- **Top-level collections for billing.** Webhooks arrive with only Razorpay ids, and finance views span all users.
- **References are string ids, not `DocumentReference`.** They are portable in JSON, logs, the admin dashboard and exports.
- **Snapshots for history.** `subscriptions.planSnapshot` and `reports.profileSnapshot` keep the facts at the time, even after a plan or the profile changes.
- **Denormalised cache, few writers.** `users.entitlement` is derived only from `subscriptions/{id}`, always in the same transaction: `syncSubscription()` for Razorpay, `grantSubscription()` / `adminExpire()` (`services/admin/subscriptionActions.ts`) for admin actions. It cannot drift.
- **Instants are stored as Timestamps.** Any field named `…At`, `…Start`, `…End` or `…Until` is a Firestore Timestamp; the converters handle this. The API still returns epoch ms. `dob` is a calendar-date string.
- **Every document has `schemaVersion`, `createdAt` and `updatedAt`.** Future migrations can find older documents by version.

## Billing: users ⇄ subscriptions ⇄ transactions

The **Razorpay subscription id** (`sub_…`) is the key that ties billing together:

```
users/{userId}.entitlement.subscriptionId ──► subscriptions/{sub_…} ◄── transactions/{pay_…}.subscriptionId
users/{userId}.latestSubscriptionId ────────►   ├─ userId ──► users/{userId}
users/{userId}.subscriptionIds[] ───────────►   ├─ planId ──► plans/{planId}
                                                ├─ replacedBySubscriptionId / replacesSubscriptionId (re-purchase chain)
                                                └─ events/{auto}  (status history)
```

| User field | Meaning |
|---|---|
| `entitlement.subscriptionId` | The subscription **giving access now** (cache, written only by `syncSubscription` / admin actions) |
| `latestSubscriptionId` | The **most recent** subscription created for the user, paid or not. Written when checkout opens, so it is set even when Razorpay is closed without paying |
| `subscriptionIds` | **Every** subscription of the user, oldest first (`arrayUnion`) — Razorpay checkouts and admin grants |
| `trialUsedAt` | First time this account used the trial. Set ⇒ later purchases have no trial (once per account; a deleted account's number starts a new account and gets the trial again) |

All four are optional, so older documents stay valid. `npm run billing:backfill-links` (dry run; `-- --apply` to write) fills them in for existing users.

**Checkout and re-subscribe rules** (`services/billingRules.ts`, unit-tested):
- A checkout is allowed with no access, or with access that is ending (renewal cancelled). It is refused while a subscription renews, or during complimentary (admin) access.
- **Re-purchase** (for example, trial → cancel → buy monthly a few days later) always creates a **new** subscription id. The first ₹299 is charged at once, with no trial. When it is paid, `syncSubscription` moves `entitlement` to the new id. Any days left on the old one are dropped, and the two are linked with `replacedBySubscriptionId` ⇄ `replacesSubscriptionId` (plus a `replaced_by_new_subscription` history event on the old one). Late webhooks from the old subscription never take access back.
- An **unpaid checkout** (`created`) for the same plan and terms is reopened instead of creating another Razorpay subscription. A trial checkout can be reopened for 30 minutes, because Razorpay fixes `start_at` when it is created; a checkout without a trial can be reopened for 24 hours.

| Step | What is written |
|---|---|
| Checkout starts (`POST /subscriptions`) | `subscriptions/{sub_…}` created (status `created`, plan snapshot — without the trial if already used — trial end) + history event + `users.latestSubscriptionId` / `subscriptionIds`, all in one transaction. A reopened unpaid checkout writes nothing new |
| Payment verified in the app (`POST /subscriptions/verify`) | subscription synced from Razorpay, user entitlement set, **checkout payment recorded in `transactions`** (₹49 trial) |
| Webhook `subscription.*` | subscription state + history event + user entitlement (single writer: `syncSubscription`) |
| Webhook `subscription.charged` / `payment.*` | `transactions/{pay_…}` upserted: `trial` → `first_charge` → `renewal`, failures keep the reason |
| Webhook `refund.*` | the payment is re-read from Razorpay; transaction becomes `refunded` / `partially_refunded` |
| User cancels | in trial: cancelled immediately (₹299 never charged); otherwise at cycle end. Access continues until the paid period ends |
| Admin grants | `subscriptions/grant_…` (`source: admin_grant`) + history event + entitlement + audit entry. Refused while a paid Razorpay subscription has access |
| Admin *Cancel future billing* | Razorpay cancel (cycle end; trials / retries immediately) first, then subscription + history + entitlement + audit. Access until the paid period ends |
| Admin *Expire access immediately* | Razorpay cancel (immediately) if still billable, then `accessRevokedAt` + history + entitlement + audit. If Razorpay fails, nothing is written |
| Admin deletes a user | Razorpay billing stopped first, then transactions, subscriptions (+ events), `users/{id}` with all subcollections, OTP record. Resumable (`userDeletions/{id}`) |

Rules: webhook deliveries are processed once (`webhookEvents`), transaction statuses never move backwards when webhooks arrive out of order, and payments for subscriptions Ankveda did not create are ignored (the Razorpay account is shared with other apps).

Current plan: **Ankveda Premium** — 5-day trial **₹49**, then **₹299 / month** (Razorpay `plan_U42bTOOMKoDkmS`, featured). Change pricing from the admin dashboard → Paywall & Pricing (trial edits in place; a new monthly amount creates or links a new Razorpay plan and archives the old one).

## Accounts, phone numbers and deletion

A phone number and an account are separate things. Login (`usersRepo.resolveOnLogin`, one transaction):
1. `phoneAccounts/{phone}` → that account;
2. else an older account keyed by the phone hash → adopted as is (no migration) and the mapping written;
3. else a brand-new account with a random id.

**Delete account** (`DELETE /me`, `services/accountDeletion.ts`): any still-billable Razorpay subscription is cancelled first (immediately — if it can't be, nothing is deleted). Then, atomically: `users/{id}` is copied to `deletedAccounts/{id}` and removed, and `phoneAccounts/{phone}` is removed. **Nothing else is deleted**: `users/{id}/reports|chatMessages|dailyGuidance` stay (Firestore keeps subcollections when the parent doc is removed), and so do subscriptions, transactions and invoices. The old token stops working (no `users/{id}`), and the next login with that number creates a new account — no history, no subscription, trial offered again. Admins see these accounts under *Users → Deleted accounts*; *Delete permanently* (admin) removes everything, including the snapshot.

## Tax invoices

One GST tax invoice per paid payment (`transactions/{pay_…}` with status captured / partially refunded / refunded). Same seller and template as Astro108 (`backend/src/config/invoice.ts`, `services/invoiceHtml.ts`); GST-inclusive, split CGST 9% + SGST 9%, SAC 998439.

- **Numbering** `ANK-YYYYMM-000001` from `counters/invoices_{YYYYMM}` in a transaction — atomic, idempotent, issued when the payment is captured (older payments get theirs on first read). Ankveda's own series, so it never collides with Astro108's `INV-…` under the same GSTIN.
- **Content** comes from what was paid: the transaction amount and the subscription's `planSnapshot` (plan name, period, trial days). Price changes never alter old invoices; new payments use new prices automatically.
- **Admin grants never have an invoice** (they create no transaction). Fully refunded payments are hidden from the user's list (`GET /invoices`) but shown to admins (`GET /admin/users/:id/invoices`, printable `GET /admin/invoices/:paymentId`).
- The app renders the same HTML to a PDF on-device (`app/src/lib/invoices`).

## Integrity rules (Firestore has no FK constraints, so the repositories enforce them)

1. Children are created in transactions that read the parents first. For example, `subscriptionsRepo.createPending` checks that the user and the plan exist.
2. Plans are never deleted. Deactivating sets `archivedAt`, because subscriptions reference them.
3. Report generation uses a claim lock (`lockedUntil`, `attempts`). The Vercel inline runner and the Firebase trigger may both see a report, but only one processes it. A report stuck in `processing` for more than 6 minutes is shown as failed so the user can retry.
4. Webhooks are recorded with `create()` on the event id, so a concurrent duplicate delivery loses and is ignored.
5. Writes go through `set()` and the converters, never `update()`, which would skip the Timestamp conversion.

## Indexes & TTL (`firestore.indexes.json`)

- `subscriptions(userId ↑, createdAt ↓)`: restore purchases
- `transactions(userId ↑, paymentCreatedAt ↓)` and `transactions(subscriptionId ↑, paymentCreatedAt ↓)`: billing history per user / per subscription
- collection group `reports(status ↑, updatedAt ↑)`: admin and stuck-job queries
- TTL on `otpChallenges.expireAt`, `webhookEvents.expireAt` and `dailyGuidance.expireAt`
- Admin dashboard (cursor pagination always orders by one field + document id):
  - `users`: `entitlement.status` / `entitlement.planId` / `entitlement.source` / `entitlement` (null = free) with `createdAt ↓` (status, plan and registration-date filters); `entitlement.status|source|planId` with `entitlement.currentPeriodEnd` (access counts)
  - `subscriptions`: `status` / `source` with `createdAt` (↓ lists, ↑ daily stats); `source, status, currentPeriodEnd` (lapsed-grant sweep)
  - `transactions`: `status, paymentCreatedAt` (↓ lists, ↑ revenue aggregations)
  - `adminAuditLog`: `action` / `targetUserId` with `createdAt ↓`

Deploy with `npx firebase-tools deploy --only firestore`.

## What to revisit as the app grows

- **Self-service account deletion** (a Google Play requirement): admins can delete users from the dashboard (`services/admin/deletion.ts`); an in-app "Delete my account" can call the same job.
- **Financial record retention.** Deleting a user currently removes their payment records too (as chosen for the dashboard). If GST / audit retention is required, change the `transactions` step in `deletion.ts` to pseudonymise instead of delete. Razorpay keeps its own records either way.
- **Separate staging data.** Staging (Vercel) and production (Firebase) currently share `(default)`. A second database, `staging`, needs only `FIRESTORE_DATABASE_ID=staging` on Vercel.
- **Analytics.** Export to BigQuery (Firebase extension) instead of running heavy queries on Firestore.
- **Chat volume.** If histories grow large, page `chatMessages` by `createdAt` and summarise older turns.
