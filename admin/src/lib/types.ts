/** Shapes returned by the admin API (backend/src/routes/admin.ts, services/admin/*). Instants are epoch ms. */

export type SubscriptionStatus = 'none' | 'created' | 'authenticated' | 'active' | 'pending' | 'halted' | 'cancelled' | 'completed' | 'expired';
export type AccessBucket = 'free' | 'trial' | 'paid' | 'granted' | 'cancelling' | 'expired';
export type TransactionStatus = 'created' | 'authorized' | 'captured' | 'failed' | 'refunded' | 'partially_refunded';
export type Source = 'razorpay' | 'admin_grant';
export type Actor = { uid: string; email: string | null };

export type Paged<T> = { items: T[]; nextCursor: string | null; total?: number | null; mode?: 'list' | 'search' };

export type UserRow = {
  id: string;
  name: string | null;
  phone: string;
  dob: string | null;
  createdAt: number;
  lastLoginAt: number | null;
  profileComplete: boolean;
  access: AccessBucket;
  entitlement: {
    status: SubscriptionStatus;
    subscriptionId: string | null;
    planId: string | null;
    planName: string | null;
    currentPeriodEnd: number | null;
    cancelAtPeriodEnd: boolean;
    source: Source;
  } | null;
  subscriptionStartAt: number | null;
};

export type SubscriptionRow = {
  id: string;
  userId: string;
  userName: string | null;
  userPhone: string | null;
  planId: string;
  planName: string;
  razorpayPlanId: string | null;
  source: Source;
  type: 'complimentary' | 'trial' | 'paid';
  amountInPaise: number;
  trialPriceInPaise: number;
  trialDays: number;
  period: string;
  interval: number;
  status: SubscriptionStatus;
  paymentStatus: 'complimentary' | 'checkout_pending' | 'failed' | 'paid' | 'trial_paid' | 'none';
  startAt: number | null;
  currentPeriodStart: number | null;
  expiresAt: number | null;
  nextChargeAt: number | null;
  paidCount: number;
  cancelAtPeriodEnd: boolean;
  cancelledAt: number | null;
  accessRevokedAt: number | null;
  grant: { grantedBy: Actor; notes: string | null; grantedAt: number } | null;
  adminAction: { type: 'cancel_renewal' | 'expire_now'; by: Actor; notes: string | null; performedAt: number } | null;
  razorpayCustomerId: string | null;
  createdAt: number;
};

export type SubscriptionEvent = { id: string; event: string; fromStatus: SubscriptionStatus | null; toStatus: SubscriptionStatus; razorpayEventId: string | null; receivedAt: number };

export type TransactionRow = {
  id: string;
  razorpayPaymentId: string;
  razorpayOrderId: string | null;
  razorpayInvoiceId: string | null;
  userId: string;
  userName: string | null;
  userPhone: string | null;
  subscriptionId: string;
  planId: string;
  planName: string | null;
  amountInPaise: number;
  refundedAmountInPaise: number;
  feeInPaise: number | null;
  currency: string;
  status: TransactionStatus;
  kind: 'trial' | 'first_charge' | 'renewal';
  method: string | null;
  errorCode: string | null;
  errorDescription: string | null;
  paymentCreatedAt: number;
  capturedAt: number | null;
};

export type AuditAction =
  | 'admin.login'
  | 'plan.create'
  | 'plan.update'
  | 'pricing.update'
  | 'subscription.grant'
  | 'subscription.expire'
  | 'subscription.cancel_renewal'
  | 'user.delete'
  | 'maintenance.run';

export type AuditRow = {
  id: string;
  action: AuditAction;
  actor: Actor | null;
  targetUserId: string | null;
  subscriptionId: string | null;
  planId: string | null;
  details: Record<string, unknown>;
  createdAt: number;
};

export type Overview = {
  computedAt: number;
  cached: boolean;
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

export type DayStat = {
  date: string;
  registrations: number;
  revenueInPaise: number;
  payments: number;
  failedPayments: number;
  newSubscriptions: number;
  grants: number;
};

export type Notification = {
  id: string;
  kind: 'payment_failed' | 'subscription_at_risk' | 'deletion_failed';
  title: string;
  body: string;
  at: number;
  userId: string;
};

export type Activity = {
  recentUsers: UserRow[];
  recentPurchases: SubscriptionRow[];
  recentlyExpired: UserRow[];
  latestPayments: TransactionRow[];
  notifications: Notification[];
};

export type UserDetail = {
  user: UserRow & {
    countryCode: string;
    profileCompletedAt: number | null;
    numbers: { birth: number; lifePath: number; name: number } | null;
    updatedAt: number;
    reportCount: number;
  };
  currentSubscription: (SubscriptionRow & { events: SubscriptionEvent[] }) | null;
  subscriptions: SubscriptionRow[];
  transactions: TransactionRow[];
  audit: AuditRow[];
  deletion: { status: 'running' | 'failed'; lastError: string | null; steps: Record<string, number> } | null;
};

export type PlanOption = { id: string; name: string; priceInPaise: number; period: string; interval: number; active: boolean; featured: boolean };

export type PricingPlan = {
  id: string;
  name: string;
  description: string | null;
  priceInPaise: number;
  currency: string;
  period: string;
  interval: number;
  trialEnabled: boolean;
  trialDays: number;
  trialPriceInPaise: number;
  effective: { trialDays: number; trialPriceInPaise: number; priceInPaise: number };
  monthlyPlanEnabled: boolean;
  featured: boolean;
  razorpayPlanId: string;
  archivedAt: number | null;
  createdAt: number;
  updatedAt: number;
  updatedBy: Actor | null;
};

export type Pricing = { plan: PricingPlan | null; history: PricingPlan[]; razorpayConfigured: boolean };

export type SystemInfo = {
  environment: string;
  firestoreDatabaseId: string;
  razorpayConfigured: boolean;
  razorpayWebhookConfigured: boolean;
  razorpayKeyMode: 'live' | 'test' | null;
  reportRunner: string;
};
