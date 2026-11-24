/**
 * Admin list queries — always server-side filtered, cursor-paginated and limited.
 * Related user names are joined with one batched getAll() per page (no per-row queries).
 * Totals use count() aggregations (billed at 1 read per 1,000 index entries).
 */
import { Timestamp, type Query } from 'firebase-admin/firestore';

import { db, refs } from '../../db/firestore';
import { uidForPhone } from '../../lib/auth';
import { HttpError } from '../../lib/http';
import type { AuditAction, AuditLogDoc, DeletedAccountDoc, SubscriptionDoc, TransactionDoc, UserDoc } from '../../types';
import { accessBucketOf, capPeriodEnd } from '../billingRules';
import { isInvoiceable } from '../invoice';
import { runPage, type Page } from './paging';

const ts = (ms: number) => Timestamp.fromMillis(ms);

// ── Users ────────────────────────────────────────────────────────────────────

export const USER_STATUS_FILTERS = ['free', 'trial', 'active', 'cancelled', 'expired', 'granted', 'deleted'] as const;
export type UserStatusFilter = (typeof USER_STATUS_FILTERS)[number];

export type UserListQuery = {
  pageSize: number;
  cursor?: string | null;
  status?: UserStatusFilter;
  planId?: string;
  from?: number;
  to?: number;
  q?: string;
};

export const userRow = (id: string, u: UserDoc, sub?: SubscriptionDoc | null) => ({
  id,
  /** Set when the user deleted this account from the app (data kept; the number now signs in fresh). */
  deleted: 'deletedAt' in u && typeof u.deletedAt === 'number' ? { at: u.deletedAt } : null,
  name: u.profile?.fullName ?? null,
  phone: u.phone,
  dob: u.profile?.dob ?? null,
  createdAt: u.createdAt,
  lastLoginAt: u.lastLoginAt ?? null,
  profileComplete: !!u.profile?.fullName && !!u.profile?.dob,
  access: accessBucketOf(u.entitlement),
  entitlement: u.entitlement
    ? {
        status: u.entitlement.status,
        subscriptionId: u.entitlement.subscriptionId,
        planId: u.entitlement.planId,
        planName: u.entitlement.planName,
        currentPeriodEnd: u.entitlement.currentPeriodEnd,
        cancelAtPeriodEnd: u.entitlement.cancelAtPeriodEnd,
        source: u.entitlement.source ?? 'razorpay',
      }
    : null,
  subscriptionStartAt: sub ? (sub.subscriptionActivatedAt ?? sub.startAt ?? sub.createdAt) : null,
});

/**
 * Status filters map to stored entitlement values (equality only → simple composite indexes).
 * The row's `access` field is always recomputed from the current time, so a lapsed period shows as expired.
 */
const applyUserStatus = (q: Query<UserDoc>, status: UserStatusFilter) => {
  switch (status) {
    case 'free':
      return q.where('entitlement', '==', null);
    case 'trial':
      return q.where('entitlement.status', '==', 'authenticated');
    case 'active':
      return q.where('entitlement.status', 'in', ['active', 'pending']);
    case 'cancelled':
      return q.where('entitlement.status', '==', 'cancelled');
    case 'expired':
      return q.where('entitlement.status', 'in', ['halted', 'completed', 'expired']);
    case 'granted':
      return q.where('entitlement.source', '==', 'admin_grant');
    case 'deleted':
      return q; // handled by listDeletedAccounts
  }
};

/** Loads the current subscription of each user on the page (one batched read) for start dates. */
const currentSubscriptions = async (users: (UserDoc & { id: string })[]) => {
  const ids = [...new Set(users.map((u) => u.entitlement?.subscriptionId).filter((v): v is string => !!v))];
  if (ids.length === 0) return new Map<string, SubscriptionDoc>();
  const snaps = await db.getAll(...ids.map((id) => refs.subscriptions().doc(id)));
  return new Map(snaps.filter((s) => s.exists).map((s) => [s.id, s.data() as SubscriptionDoc]));
};

const toUserPage = async (page: Page<UserDoc & { id: string }>) => {
  const subs = await currentSubscriptions(page.items);
  return { items: page.items.map((u) => userRow(u.id, u, subs.get(u.entitlement?.subscriptionId ?? ''))), nextCursor: page.nextCursor };
};

export const listUsers = async (query: UserListQuery) => {
  const q = query.q?.trim();
  if (q) return searchUsers(q, query);

  if (query.status === 'deleted') return listDeletedAccounts(query);

  let base: Query<UserDoc> = refs.users();
  if (query.status) base = applyUserStatus(base, query.status);
  if (query.planId) base = base.where('entitlement.planId', '==', query.planId);
  if (query.from) base = base.where('createdAt', '>=', ts(query.from));
  if (query.to) base = base.where('createdAt', '<', ts(query.to));

  const [page, total] = await Promise.all([
    runPage(base, { field: 'createdAt', direction: 'desc', instant: true, pageSize: query.pageSize, cursor: query.cursor }),
    query.cursor ? Promise.resolve(null) : base.count().get().then((s) => s.data().count),
  ]);
  return { ...(await toUserPage(page)), total, mode: 'list' as const };
};

/** Accounts users deleted from the app, newest deletion first (deletedAccounts collection). */
const listDeletedAccounts = async (query: UserListQuery) => {
  let base: Query<DeletedAccountDoc> = refs.deletedAccounts();
  if (query.from) base = base.where('deletedAt', '>=', ts(query.from));
  if (query.to) base = base.where('deletedAt', '<', ts(query.to));
  const [page, total] = await Promise.all([
    runPage(base, { field: 'deletedAt', direction: 'desc', instant: true, pageSize: query.pageSize, cursor: query.cursor }),
    query.cursor ? Promise.resolve(null) : base.count().get().then((s) => s.data().count),
  ]);
  const subs = await currentSubscriptions(page.items);
  return {
    items: page.items.map((u) => userRow(u.id, u, subs.get(u.entitlement?.subscriptionId ?? ''))),
    nextCursor: page.nextCursor,
    total,
    mode: 'list' as const,
  };
};

/** Every account for a phone number: the current one (via phoneAccounts, or the legacy id) and deleted ones. */
const accountsForPhone = async (phone: string) => {
  const mapping = (await refs.phoneAccounts().doc(phone).get()).data();
  const ids = [...new Set([mapping?.userId, uidForPhone(phone)].filter((v): v is string => !!v))];
  const [active, deleted] = await Promise.all([
    db.getAll(...ids.map((id) => refs.user(id))),
    refs.deletedAccounts().where('phone', '==', phone).get(),
  ]);
  return [
    ...active.filter((s) => s.exists).map((s) => ({ ...(s.data() as UserDoc), id: s.id })),
    ...deleted.docs.map((d) => ({ ...d.data(), id: d.id })),
  ];
};

/**
 * Search (filters do not apply while searching):
 *   u_…            exact user id
 *   10 digits      exact phone (user id is derived from the phone, so this is a direct read)
 *   2–9 digits     phone prefix
 *   text           name prefix (case-insensitive, users.nameLower)
 */
const searchUsers = async (raw: string, query: UserListQuery) => {
  const digits = raw.replace(/[\s+-]/g, '').replace(/^91(?=\d{10}$)/, '');
  if (/^u_[a-f0-9]{24}$/.test(raw) || /^[6-9]\d{9}$/.test(digits)) {
    let found: (UserDoc & { id: string })[];
    if (raw.startsWith('u_')) {
      const [active, deleted] = await Promise.all([refs.user(raw).get(), refs.deletedAccounts().doc(raw).get()]);
      const doc = active.data() ?? deleted.data();
      found = doc ? [{ ...doc, id: raw }] : [];
    } else {
      found = await accountsForPhone(digits);
    }
    const items = found.length ? (await toUserPage({ items: found, nextCursor: null })).items : [];
    return { items, nextCursor: null, total: items.length, mode: 'search' as const };
  }
  let field: string;
  let prefix: string;
  if (/^\d{2,9}$/.test(digits)) {
    field = 'phone';
    prefix = digits;
  } else if (raw.length >= 2) {
    field = 'nameLower';
    prefix = raw.trim().replace(/\s+/g, ' ').toLowerCase();
  } else {
    throw new HttpError(400, 'Type at least 2 characters to search.', 'validation');
  }
  const base = refs.users().where(field, '>=', prefix).where(field, '<', `${prefix}`);
  const page = await runPage(base, { field, direction: 'asc', instant: false, pageSize: query.pageSize, cursor: query.cursor });
  return { ...(await toUserPage(page)), total: null, mode: 'search' as const };
};

/** id → { name, phone } for rows that reference users (one batched read per page). */
export const userNames = async (userIds: string[]) => {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (ids.length === 0) return new Map<string, { name: string | null; phone: string | null }>();
  const snaps = await db.getAll(...ids.map((id) => refs.user(id)));
  return new Map(
    snaps.map((s) => {
      const u = s.data() as UserDoc | undefined;
      return [s.id, { name: u?.profile?.fullName ?? null, phone: u?.phone ?? null }] as const;
    }),
  );
};

// ── Subscriptions ────────────────────────────────────────────────────────────

export const SUBSCRIPTION_FILTERS = ['all', 'active', 'trial', 'expired', 'cancelled', 'payment_failed', 'granted', 'checkout'] as const;
export type SubscriptionFilter = (typeof SUBSCRIPTION_FILTERS)[number];

/** A label for the payment side of a subscription — derived, never invented. */
export const paymentStatusOf = (s: SubscriptionDoc) => {
  if (s.source === 'admin_grant') return 'complimentary';
  if (s.status === 'created') return 'checkout_pending';
  if (s.status === 'pending' || s.status === 'halted') return 'failed';
  if (s.paidCount > 0) return 'paid';
  if (s.status === 'authenticated' || s.subscriptionActivatedAt) return 'trial_paid';
  return 'none';
};

export const subscriptionRow = (id: string, s: SubscriptionDoc, user?: { name: string | null; phone: string | null }) => ({
  id,
  userId: s.userId,
  userName: user?.name ?? null,
  userPhone: user?.phone ?? null,
  planId: s.planId,
  planName: s.planSnapshot.name,
  razorpayPlanId: s.razorpayPlanId ?? null,
  source: s.source ?? 'razorpay',
  type: s.source === 'admin_grant' ? 'complimentary' : s.status === 'authenticated' ? 'trial' : 'paid',
  amountInPaise: s.planSnapshot.priceInPaise,
  trialPriceInPaise: s.planSnapshot.trialPriceInPaise,
  trialDays: s.planSnapshot.trialDays,
  period: s.planSnapshot.period,
  interval: s.planSnapshot.interval,
  status: s.status,
  paymentStatus: paymentStatusOf(s),
  startAt: s.subscriptionActivatedAt ?? s.currentPeriodStart ?? s.startAt ?? null,
  currentPeriodStart: s.currentPeriodStart,
  expiresAt: capPeriodEnd(s.currentPeriodEnd, s.accessRevokedAt),
  nextChargeAt: s.nextChargeAt,
  paidCount: s.paidCount,
  cancelAtPeriodEnd: s.cancelAtPeriodEnd,
  cancelledAt: s.cancelledAt,
  accessRevokedAt: s.accessRevokedAt ?? null,
  grant: s.grant ?? null,
  adminAction: s.adminAction ?? null,
  razorpayCustomerId: s.razorpayCustomerId,
  createdAt: s.createdAt,
});

export const listSubscriptions = async (query: { pageSize: number; cursor?: string | null; filter?: SubscriptionFilter; userId?: string }) => {
  let base: Query<SubscriptionDoc> = refs.subscriptions();
  if (query.userId) base = base.where('userId', '==', query.userId);
  switch (query.filter ?? 'all') {
    case 'active':
      base = base.where('status', '==', 'active');
      break;
    case 'trial':
      base = base.where('status', '==', 'authenticated');
      break;
    case 'expired':
      base = base.where('status', 'in', ['expired', 'completed']);
      break;
    case 'cancelled':
      base = base.where('status', '==', 'cancelled');
      break;
    case 'payment_failed':
      base = base.where('status', 'in', ['pending', 'halted']);
      break;
    case 'granted':
      base = base.where('source', '==', 'admin_grant');
      break;
    case 'checkout':
      base = base.where('status', '==', 'created');
      break;
  }
  const [page, total] = await Promise.all([
    runPage(base, { field: 'createdAt', direction: 'desc', instant: true, pageSize: query.pageSize, cursor: query.cursor }),
    query.cursor ? Promise.resolve(null) : base.count().get().then((s) => s.data().count),
  ]);
  const names = await userNames(page.items.map((s) => s.userId));
  return { items: page.items.map((s) => subscriptionRow(s.id, s, names.get(s.userId))), nextCursor: page.nextCursor, total };
};

// ── Transactions ─────────────────────────────────────────────────────────────

export const TRANSACTION_FILTERS = ['all', 'captured', 'failed', 'refunded'] as const;
export type TransactionFilter = (typeof TRANSACTION_FILTERS)[number];

export const transactionRow = (
  id: string,
  t: TransactionDoc,
  user?: { name: string | null; phone: string | null },
  planName?: string | null,
) => ({
  id,
  razorpayPaymentId: id,
  razorpayOrderId: t.razorpayOrderId,
  razorpayInvoiceId: t.razorpayInvoiceId,
  userId: t.userId,
  userName: user?.name ?? null,
  userPhone: user?.phone ?? null,
  subscriptionId: t.subscriptionId,
  planId: t.planId,
  planName: planName ?? null,
  amountInPaise: t.amountInPaise,
  refundedAmountInPaise: t.refundedAmountInPaise,
  feeInPaise: t.feeInPaise,
  currency: t.currency,
  status: t.status,
  kind: t.kind,
  method: t.method,
  errorCode: t.errorCode,
  errorDescription: t.errorDescription,
  paymentCreatedAt: t.paymentCreatedAt,
  capturedAt: t.capturedAt,
  invoiceNumber: t.invoiceNumber ?? null,
  /** Paid payments have a tax invoice (fully refunded ones too, for the admin). */
  invoiceable: isInvoiceable(t, true),
});

export const listTransactions = async (query: {
  pageSize: number;
  cursor?: string | null;
  filter?: TransactionFilter;
  from?: number;
  to?: number;
  userId?: string;
  subscriptionId?: string;
}) => {
  let base: Query<TransactionDoc> = refs.transactions();
  if (query.userId) base = base.where('userId', '==', query.userId);
  if (query.subscriptionId) base = base.where('subscriptionId', '==', query.subscriptionId);
  if (query.filter === 'captured') base = base.where('status', '==', 'captured');
  if (query.filter === 'failed') base = base.where('status', '==', 'failed');
  if (query.filter === 'refunded') base = base.where('status', 'in', ['refunded', 'partially_refunded']);
  if (query.from) base = base.where('paymentCreatedAt', '>=', ts(query.from));
  if (query.to) base = base.where('paymentCreatedAt', '<', ts(query.to));

  const [page, total] = await Promise.all([
    runPage(base, { field: 'paymentCreatedAt', direction: 'desc', instant: true, pageSize: query.pageSize, cursor: query.cursor }),
    query.cursor ? Promise.resolve(null) : base.count().get().then((s) => s.data().count),
  ]);
  const [names, plans] = await Promise.all([userNames(page.items.map((t) => t.userId)), planNames()]);
  return {
    items: page.items.map((t) => transactionRow(t.id, t, names.get(t.userId), plans.get(t.planId))),
    nextCursor: page.nextCursor,
    total,
  };
};

/** Plans are a handful of documents — read once per request for names. */
export const planNames = async () => {
  const snap = await refs.plans().select('name').get();
  return new Map(snap.docs.map((d) => [d.id, (d.get('name') as string) ?? null]));
};

// ── Audit log ────────────────────────────────────────────────────────────────

export const auditRow = (id: string, a: AuditLogDoc) => ({
  id,
  action: a.action,
  actor: a.actor ?? null,
  targetUserId: a.targetUserId ?? null,
  subscriptionId: a.subscriptionId ?? null,
  planId: a.planId ?? null,
  details: a.details ?? a.changes ?? {},
  createdAt: a.createdAt,
});

export const listAudit = async (query: { pageSize: number; cursor?: string | null; action?: AuditAction; targetUserId?: string }) => {
  let base: Query<AuditLogDoc> = refs.adminAuditLog();
  if (query.action) base = base.where('action', '==', query.action);
  if (query.targetUserId) base = base.where('targetUserId', '==', query.targetUserId);
  const page = await runPage(base, { field: 'createdAt', direction: 'desc', instant: true, pageSize: query.pageSize, cursor: query.cursor });
  return { items: page.items.map((a) => auditRow(a.id, a)), nextCursor: page.nextCursor };
};
