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
 *   subscriptions/{razorpaySubscriptionId}       → users.userId, → plans.planId
 *   payments/{razorpayPaymentId}                 → users, → subscriptions, → plans
 *   otpChallenges/{phone}                        TTL expireAt
 *   webhookEvents/{razorpayEventId}              TTL expireAt (dedupe log)
 *   adminAuditLog/{auto}                         → plans
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

/** Denormalised cache of the user's current subscription. Only written by syncSubscription(). */
export type StoredEntitlement = {
  status: SubscriptionStatus;
  subscriptionId: string | null;
  planId: string | null;
  planName: string | null;
  currentPeriodEnd: number | null;
  cancelAtPeriodEnd: boolean;
};

export type UserDoc = Audited & {
  phone: string;
  countryCode: '+91';
  profile: UserProfile | null;
  profileCompletedAt: number | null;
  entitlement: StoredEntitlement | null;
  /** astrologyapi.com chat session, tied to the birth details it was started with. */
  chat: { astroSessionId: string | null; profileKey: string | null } | null;
  lastLoginAt: number;
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
  };

export type SubscriptionDoc = Audited & {
  userId: string;
  planId: string;
  /** Plan terms at purchase time — plans are immutable in Razorpay and can be replaced. */
  planSnapshot: PlanTerms;
  status: SubscriptionStatus;
  /** First recurring charge (end of trial). */
  startAt: number | null;
  currentPeriodStart: number | null;
  currentPeriodEnd: number | null;
  cancelAtPeriodEnd: boolean;
  cancelledAt: number | null;
  endedAt: number | null;
  lastEvent: { name: string; receivedAt: number } | null;
};

export type PaymentDoc = Audited & {
  userId: string;
  subscriptionId: string;
  planId: string;
  amountInPaise: number;
  currency: string;
  status: 'captured' | 'authorized' | 'failed' | 'refunded';
  method: string | null;
  kind: 'trial' | 'renewal' | 'first_charge';
  invoiceId: string | null;
  paidAt: number;
};

// ── Operational ──────────────────────────────────────────────────────────────

export type OtpChallengeDoc = {
  codeHash: string;
  attempts: number;
  lastSentAt: number;
  expireAt: number;
};

export type WebhookEventDoc = {
  event: string;
  entityId: string | null;
  receivedAt: number;
  processedAt: number | null;
  expireAt: number;
};

export type AuditLogDoc = {
  action: 'plan.create' | 'plan.update';
  planId: string;
  changes: Record<string, unknown>;
  createdAt: number;
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
