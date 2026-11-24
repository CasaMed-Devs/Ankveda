/**
 * Domain model + Firestore schema (v1).
 *
 * Storage conventions (see src/db/schema.ts):
 *  - Every field ending in `At`, `Start`, `End` or `Until` is an instant: epoch ms in code,
 *    a Firestore Timestamp in the database (so TTL policies and console browsing work).
 *  - `dob` is a calendar date string "YYYY-MM-DD" (not an instant).
 *  - References between documents are plain string ids (userId, planId, subscriptionId).
 *
 * Collections
 *   users/{userId}                               userId = u_ + sha256("+91"+phone)[:24]
 *   users/{userId}/reports/{reportId}            → user (parent)
 *   users/{userId}/chatMessages/{messageId}      → user (parent)
 *   users/{userId}/dailyGuidance/{YYYY-MM-DD}    → user (parent), TTL expireAt
 *   plans/{planId}                               never hard-deleted (subscriptions reference it)
 *   subscriptions/{razorpaySubscriptionId}       → users.userId, → plans.planId   (users.entitlement.subscriptionId → here)
 *   subscriptions/{id}/events/{auto}             append-only status history
 *   transactions/{razorpayPaymentId}             → subscriptions (subscriptionId), → users, → plans
 *   otpChallenges/{phone}                        TTL expireAt
 *   webhookEvents/{razorpayEventId}              TTL expireAt (dedupe log)
 *   adminAuditLog/{auto}                         → users (targetUserId), → plans   (server-written, append-only)
 *   adminStats/overview                          cached dashboard aggregations
 *   adminDailyStats/{YYYY-MM}                    cached per-day statistics (IST)
 *   userDeletions/{userId}                       resumable permanent-deletion job
 *   subscriptions/grant_{auto}                   admin grants (source 'admin_grant', no Razorpay objects)
 *
 * The API contract with the app is defined at the bottom (Public*) — keep in sync with app/src/lib/types.ts.
 */

export const SCHEMA_VERSION = 1;

type Audited = { schemaVersion: number; createdAt: number; updatedAt: number };

// ── Users ────────────────────────────────────────────────────────────────────

export type ProfileNumbers = { birth: number; lifePath: number; name: number };

export type UserProfile = {
  fullName: string;
  dob: string;
  /** Derived Chaldean numbers, recomputed whenever the profile changes. */
  numbers: ProfileNumbers;
};

export type SubscriptionStatus =
  | 'none'
  | 'created'
  | 'authenticated'
  | 'active'
  | 'pending'
  | 'halted'
  | 'cancelled'
  | 'completed'
  | 'expired';

/** Who paid for a subscription: Razorpay checkout, or a complimentary grant by an admin (never revenue). */
export type SubscriptionSource = 'razorpay' | 'admin_grant';

/** An admin (Firebase Auth user with the `admin` custom claim). */
export type AdminActor = { uid: string; email: string | null };

/**
 * Denormalised cache of the user's current subscription. Only written by services/billing.ts
 * (syncSubscription for Razorpay, grantSubscription / adminExpire for admin actions).
 */
export type StoredEntitlement = {
  status: SubscriptionStatus;
  subscriptionId: string | null;
  planId: string | null;
  planName: string | null;
  currentPeriodEnd: number | null;
  cancelAtPeriodEnd: boolean;
  /** Missing on older documents = 'razorpay'. */
  source?: SubscriptionSource;
};

export type UserDoc = Audited & {
  phone: string;
  countryCode: '+91';
  profile: UserProfile | null;
  /** Lower-cased full name for admin prefix search (written with the profile). */
  nameLower?: string | null;
  profileCompletedAt: number | null;
  entitlement: StoredEntitlement | null;
  /** astrologyapi.com chat session, tied to the birth details it was started with. */
  chat: { astroSessionId: string | null; profileKey: string | null } | null;
  lastLoginAt: number;
};

/**
 * phoneAccounts/{phone} — the CURRENT account for a phone number. Login resolves through it, so after
 * a user deletes their account the same number gets a brand-new account (new id, no history).
 */
export type PhoneAccountDoc = { userId: string; createdAt: number; updatedAt: number };

/**
 * deletedAccounts/{userId} — an account the user deleted from the app. The users/{id} doc moves here
 * (snapshot); its subcollections (reports, chat, daily guidance), subscriptions, payments and invoices
 * stay where they are, linked by the same id. Nothing is shown in the app again.
 */
export type DeletedAccountDoc = UserDoc & {
  deletedAt: number;
  deletedBy: 'user';
  /** Razorpay subscriptions whose billing was cancelled as part of the deletion. */
  billingCancelled: string[];
};

// ── Reports ──────────────────────────────────────────────────────────────────

export const REPORT_TYPES = ['name', 'phone', 'birthdate', 'compatibility', 'career', 'future', 'car'] as const;
export type ReportType = (typeof REPORT_TYPES)[number];
export type ReportStatus = 'locked' | 'processing' | 'complete' | 'failed';
export type ReportStage = 'received' | 'numbers' | 'writing' | 'done';

export type ReportInput = {
  fullName?: string;
  dob?: string;
  phone?: string;
  partnerName?: string;
  partnerDob?: string;
  careerFocus?: string;
  period?: '3m' | '6m' | '12m';
  carNumber?: string;
};

export type ReportNumber = { label: string; value: string };
export type ReportSection = { eyebrow?: string; title: string; body: string };

export type ReportContent = {
  headline: string;
  traits: string;
  primary: { label: string; value: string; calculation: string };
  numbers: ReportNumber[];
  sections: ReportSection[];
  basis: string;
};

export type ReportDoc = Audited & {
  /** Denormalised parent id — enables collectionGroup('reports') queries for admin. */
  userId: string;
  type: ReportType;
  status: ReportStatus;
  stage: ReportStage;
  input: ReportInput;
  /** Profile at creation time (reports without a name field use it). */
  profileSnapshot: { fullName: string; dob: string };
  content: ReportContent | null;
  saved: boolean;
  error: string | null;
  attempts: number;
  /** Generation lock — one runner (Vercel inline or Firebase trigger) processes a report at a time. */
  lockedUntil: number | null;
  generator: { model: string; astroSource: string } | null;
  completedAt: number | null;
};

// ── Chat & daily ─────────────────────────────────────────────────────────────

export type ChatProvider = 'astrologyapi' | 'openai' | 'template';

export type ChatMessageDoc = {
  schemaVersion: number;
  role: 'user' | 'astrologer';
  text: string;
  provider: ChatProvider | null;
  createdAt: number;
};

export type Daily = {
  date: string;
  luckyNumber: string;
  luckyTime: string;
  theme: string;
  title: string;
  message: string;
};

export type DailyDoc = Daily & {
  schemaVersion: number;
  /** "name|dob" the guidance was written for; a profile edit invalidates it. */
  profileKey: string;
  createdAt: number;
  expireAt: number;
};

// ── Billing ──────────────────────────────────────────────────────────────────

export type PlanPeriod = 'daily' | 'weekly' | 'monthly' | 'yearly';

export type PlanTerms = {
  name: string;
  priceInPaise: number;
  period: PlanPeriod;
  interval: number;
  trialDays: number;
  trialPriceInPaise: number;
};

export type PlanDoc = Audited &
  PlanTerms & {
    description: string | null;
    currency: 'INR';
    featured: boolean;
    active: boolean;
    razorpayPlanId: string;
    archivedAt: number | null;
    /**
     * The trial is applied when a subscription is created (start_at delay + add-on), not in the
     * Razorpay plan, so it can be switched off or changed in place. Missing = enabled.
     * Use effectiveTerms()/termsOf(): trialDays and trialPriceInPaise keep the configured values.
     */
    trialEnabled?: boolean;
    /** Admin who last changed this plan. */
    updatedBy?: AdminActor | null;
  };

/**
 * subscriptions/{razorpaySubscriptionId} — the Razorpay subscription id is the primary key and the
 * foreign key used by users.entitlement.subscriptionId and transactions.subscriptionId.
 */
export type SubscriptionDoc = Audited & {
  userId: string;
  planId: string;
  /** Plan terms at purchase time — plans are immutable in Razorpay and can be replaced. */
  planSnapshot: PlanTerms;
  /** null for admin grants (no Razorpay objects exist — ids are never invented). */
  razorpayPlanId: string | null;
  razorpayCustomerId: string | null;
  status: SubscriptionStatus;
  /** First recurring charge (end of trial). */
  startAt: number | null;
  currentPeriodStart: number | null;
  currentPeriodEnd: number | null;
  /** Next scheduled charge. */
  nextChargeAt: number | null;
  /** Billing cycles paid so far / total cycles the subscription runs for. */
  paidCount: number;
  totalCount: number;
  /**
   * When the user got the subscription, counting the trial: set when the ₹49 trial starts
   * ("authenticated"), or at the first charge for plans without a trial ("active").
   * Set once, never overwritten; null until checkout is paid.
   */
  subscriptionActivatedAt: number | null;
  cancelAtPeriodEnd: boolean;
  cancelledAt: number | null;
  endedAt: number | null;
  lastEvent: { name: string; receivedAt: number } | null;
  /**
   * 'admin_grant' subscriptions have an id "grant_…", no Razorpay objects and no transactions.
   * Missing on older documents = 'razorpay'.
   */
  source?: SubscriptionSource;
  grant?: { grantedBy: AdminActor; notes: string | null; grantedAt: number } | null;
  /**
   * Set when an admin ends access immediately. Caps currentPeriodEnd for good, so a later
   * Razorpay webhook (e.g. subscription.cancelled) cannot restore access.
   */
  accessRevokedAt?: number | null;
  /** Last admin action on this subscription (expire / cancel renewal). */
  adminAction?: { type: AdminExpireMode; by: AdminActor; notes: string | null; performedAt: number } | null;
};

/**
 * cancel_renewal — stop future Razorpay charges; access continues until the paid period ends.
 * expire_now     — end access immediately (and stop Razorpay billing if it is still running).
 */
export type AdminExpireMode = 'cancel_renewal' | 'expire_now';

/** subscriptions/{subscriptionId}/events/{auto} — append-only audit trail of every state change. */
export type SubscriptionEventDoc = {
  event: string;
  fromStatus: SubscriptionStatus | null;
  toStatus: SubscriptionStatus;
  /** Razorpay webhook event id (null for checkout / restore / cancel calls). */
  razorpayEventId: string | null;
  receivedAt: number;
};

export type TransactionStatus = 'created' | 'authorized' | 'captured' | 'failed' | 'refunded' | 'partially_refunded';
export type TransactionKind = 'trial' | 'first_charge' | 'renewal';

/**
 * transactions/{razorpayPaymentId} — every payment attempt for a subscription (success, failure, refund).
 * Linked by subscriptionId (Razorpay subscription id) → subscriptions, and userId → users.
 */
export type TransactionDoc = Audited & {
  userId: string;
  subscriptionId: string;
  planId: string;
  razorpayInvoiceId: string | null;
  razorpayOrderId: string | null;
  amountInPaise: number;
  refundedAmountInPaise: number;
  /** Razorpay fee + GST on it, when reported. */
  feeInPaise: number | null;
  currency: string;
  status: TransactionStatus;
  kind: TransactionKind;
  method: string | null;
  errorCode: string | null;
  errorDescription: string | null;
  /** When Razorpay created the payment. */
  paymentCreatedAt: number;
  capturedAt: number | null;
  failedAt: number | null;
  refundedAt: number | null;
  /** Tax invoice number ("ANK-YYYYMM-000001"), assigned once when the payment is captured. */
  invoiceNumber?: string;
  invoiceIssuedAt?: number;
};

/** counters/invoices_{YYYYMM} — last invoice sequence issued in that IST month. */
export type CounterDoc = { lastNumber: number; updatedAt: number };

// ── Operational ──────────────────────────────────────────────────────────────

export type OtpChallengeDoc = {
  codeHash: string;
  /** Wrong-code attempts for the current code. */
  attempts: number;
  lastSentAt: number;
  /** The current code stops working at this time (5 minutes). */
  codeExpiresAt: number;
  /** Codes sent on `sendDay` (IST date) — daily SMS cap. */
  sendCount: number;
  sendDay: string;
  /** TTL: the document is deleted a day after the last send. */
  expireAt: number;
};

export type WebhookEventDoc = {
  event: string;
  entityId: string | null;
  receivedAt: number;
  processedAt: number | null;
  expireAt: number;
};

export type AuditAction =
  | 'account.self_delete'
  | 'admin.login'
  | 'plan.create'
  | 'plan.update'
  | 'pricing.update'
  | 'subscription.grant'
  | 'subscription.expire'
  | 'subscription.cancel_renewal'
  | 'user.delete'
  | 'maintenance.run';

/**
 * adminAuditLog/{auto} — written only by the backend (Firestore rules deny every client).
 * Entries from before admin accounts existed have no `actor` (shared-password admin).
 */
export type AuditLogDoc = {
  action: AuditAction;
  actor?: AdminActor | null;
  targetUserId?: string | null;
  subscriptionId?: string | null;
  planId?: string | null;
  /** What changed. Never holds names or phone numbers of deleted users. */
  details?: Record<string, unknown>;
  /** Legacy field of plan.create / plan.update entries. */
  changes?: Record<string, unknown>;
  createdAt: number;
};

/** adminStats/overview — cached dashboard figures (recomputed by aggregation queries, never incremented). */
export type AdminOverviewDoc = {
  computedAt: number;
  users: { total: number; today: number; yesterday: number; thisMonth: number; lastMonth: number };
  access: { trial: number; paid: number; granted: number; cancelling: number; expired: number; free: number };
  subscriptions: { purchases: number; grants: number; byStatus: Partial<Record<SubscriptionStatus, number>> };
  revenue: {
    totalInPaise: number;
    successfulPayments: number;
    todayInPaise: number;
    yesterdayInPaise: number;
    thisMonthInPaise: number;
    lastMonthInPaise: number;
    failedPayments7d: number;
    refundedInPaise: number;
  };
  plans: { planId: string; name: string; subscribers: number }[];
};

/** One day in adminDailyStats/{YYYY-MM}.days[DD] (IST calendar days). */
export type DailyStat = {
  registrations: number;
  /** Net of refunds, successful payments only (grants are never revenue). */
  revenueInPaise: number;
  payments: number;
  failedPayments: number;
  newSubscriptions: number;
  grants: number;
};

export type DailyStatsMonthDoc = {
  days: Record<string, DailyStat & { computedAt: number }>;
  updatedAt: number;
};

export type UserDeletionStep = 'cancelRazorpay' | 'subscriptions' | 'transactions' | 'userData' | 'otp';

/** userDeletions/{userId} — resumable permanent deletion job (no personal data). */
export type UserDeletionDoc = {
  status: 'running' | 'failed' | 'completed';
  steps: Partial<Record<UserDeletionStep, number>>;
  requestedBy: AdminActor;
  /** Kept for the phone-keyed OTP record; cleared once the job completes. */
  phone: string | null;
  deleted: { subscriptions: number; transactions: number; paymentsInPaise: number };
  lastError: string | null;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
};

// ── Public API shapes (what the app receives) ────────────────────────────────

export type Entitlement = {
  active: boolean;
  status: SubscriptionStatus;
  planId?: string;
  planName?: string;
  subscriptionId?: string;
  currentPeriodEnd?: number;
  cancelAtPeriodEnd?: boolean;
};

export type PublicPlan = PlanTerms & { id: string };

export type ChatMessage = {
  id: string;
  role: 'user' | 'astrologer';
  text: string;
  createdAt: number;
};
