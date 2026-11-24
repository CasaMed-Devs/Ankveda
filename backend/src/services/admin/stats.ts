/**
 * Dashboard statistics — precomputed by the backend, never incremented.
 *
 * Every figure is a Firestore count() / sum() aggregation over the source collections, so duplicate or
 * out-of-order Razorpay webhooks can never skew it (there are no counters to drift). Results are cached:
 *   adminStats/overview           — headline figures, recomputed when older than OVERVIEW_TTL_MS
 *   adminDailyStats/{YYYY-MM}     — one entry per IST day; a day is final once it is SETTLE_MS old
 *                                   (late webhooks and refunds land within that window), newer days are
 *                                   recomputed when older than DAY_TTL_MS. Rebuild on demand from Settings.
 * Aggregations bill one read per 1,000 index entries, so this stays cheap as the user base grows.
 *
 * Revenue = successful payments (captured / refunded / partially refunded) minus refunds. Admin grants
 * create no transactions, so they can never be counted as revenue.
 */
import { AggregateField, Timestamp, type Query } from 'firebase-admin/firestore';

import { db, refs } from '../../db/firestore';
import { DAY_MS } from '../../db/schema';
import { logger } from '../../lib/logger';
import type { AdminOverviewDoc, DailyStat, DailyStatsMonthDoc, SubscriptionStatus, TransactionStatus } from '../../types';
import { capPeriodEnd } from '../billingRules';
import { audit } from './audit';
import { dateKeysBetween, istDateKey, istDateStart, istDayStart, istMonthStart } from './time';

const OVERVIEW_TTL_MS = 5 * 60_000;
/** Must match services/entitlement.ts: a renewal retry ("pending") keeps access for 3 days. */
const PENDING_GRACE_MS = 3 * DAY_MS;
const DAY_TTL_MS = 10 * 60_000;
const SETTLE_MS = 3 * DAY_MS;
const MAX_RANGE_DAYS = 366;

export const REVENUE_STATUSES: TransactionStatus[] = ['captured', 'partially_refunded', 'refunded'];
const ALL_STATUSES: SubscriptionStatus[] = ['created', 'authenticated', 'active', 'pending', 'halted', 'cancelled', 'completed', 'expired'];
const PURCHASED_STATUSES = ALL_STATUSES.filter((s) => s !== 'created');

const ts = (ms: number) => Timestamp.fromMillis(ms);
const count = async (q: Query<unknown>) => (await q.count().get()).data().count;

const revenueOf = async (q: Query<unknown>) => {
  const snap = await q
    .aggregate({ n: AggregateField.count(), amount: AggregateField.sum('amountInPaise'), refunded: AggregateField.sum('refundedAmountInPaise') })
    .get();
  const d = snap.data();
  return { payments: d.n, netInPaise: (d.amount ?? 0) - (d.refunded ?? 0), refundedInPaise: d.refunded ?? 0 };
};

const successful = () => refs.transactions().where('status', 'in', REVENUE_STATUSES);
const usersBetween = (from: number, to: number) => count(refs.users().where('createdAt', '>=', ts(from)).where('createdAt', '<', ts(to)));
const revenueBetween = (from: number, to: number) =>
  revenueOf(successful().where('paymentCreatedAt', '>=', ts(from)).where('paymentCreatedAt', '<', ts(to)));

// ── Overview ─────────────────────────────────────────────────────────────────

const computeOverview = async (): Promise<AdminOverviewDoc> => {
  const now = Date.now();
  const today = istDayStart(now);
  const yesterday = today - DAY_MS;
  const month = istMonthStart(now);
  const lastMonth = istMonthStart(now, -1);
  const nowTs = ts(now);
  const ent = (q: Query<unknown>) => q.where('entitlement.currentPeriodEnd', '>', nowTs);
  // Payment retry within the grace window: period ended, access continues (computeEntitlement).
  const inGrace = (q: Query<unknown>) =>
    q.where('entitlement.status', '==', 'pending').where('entitlement.currentPeriodEnd', '>', ts(now - PENDING_GRACE_MS)).where('entitlement.currentPeriodEnd', '<=', nowTs);

  const plansSnap = await refs.plans().get();
  const [
    usersTotal,
    usersToday,
    usersYesterday,
    usersMonth,
    usersLastMonth,
    trial,
    activeAll,
    pendingGrace,
    grantedActive,
    cancelling,
    lapsed,
    free,
    grantsTotal,
    byStatusList,
    revenueTotal,
    revenueToday,
    revenueYesterday,
    revenueMonth,
    revenueLastMonth,
    failed7d,
    planCounts,
  ] = await Promise.all([
    count(refs.users()),
    count(refs.users().where('createdAt', '>=', ts(today))),
    usersBetween(yesterday, today),
    count(refs.users().where('createdAt', '>=', ts(month))),
    usersBetween(lastMonth, month),
    count(ent(refs.users().where('entitlement.status', '==', 'authenticated'))),
    count(ent(refs.users().where('entitlement.status', 'in', ['active', 'pending']))),
    count(inGrace(refs.users())),
    count(ent(refs.users().where('entitlement.source', '==', 'admin_grant').where('entitlement.status', '==', 'active'))),
    count(ent(refs.users().where('entitlement.status', '==', 'cancelled'))),
    count(refs.users().where('entitlement.currentPeriodEnd', '<=', nowTs)),
    count(refs.users().where('entitlement', '==', null)),
    count(refs.subscriptions().where('source', '==', 'admin_grant')),
    Promise.all(ALL_STATUSES.map(async (s) => [s, await count(refs.subscriptions().where('status', '==', s))] as const)),
    revenueOf(successful()),
    revenueOf(successful().where('paymentCreatedAt', '>=', ts(today))),
    revenueBetween(yesterday, today),
    revenueOf(successful().where('paymentCreatedAt', '>=', ts(month))),
    revenueBetween(lastMonth, month),
    count(refs.transactions().where('status', '==', 'failed').where('paymentCreatedAt', '>=', ts(now - 7 * DAY_MS))),
    Promise.all(
      plansSnap.docs.map(async (p) => ({
        planId: p.id,
        name: p.data().name,
        subscribers:
          (await count(ent(refs.users().where('entitlement.planId', '==', p.id)))) +
          (await count(inGrace(refs.users().where('entitlement.planId', '==', p.id)))),
      })),
    ),
  ]);

  const byStatus = Object.fromEntries(byStatusList) as Partial<Record<SubscriptionStatus, number>>;
  const purchasedAll = PURCHASED_STATUSES.reduce((sum, s) => sum + (byStatus[s] ?? 0), 0);
  return {
    computedAt: now,
    users: { total: usersTotal, today: usersToday, yesterday: usersYesterday, thisMonth: usersMonth, lastMonth: usersLastMonth },
    access: {
      trial,
      paid: Math.max(0, activeAll + pendingGrace - grantedActive),
      granted: grantedActive,
      cancelling,
      expired: Math.max(0, lapsed - pendingGrace),
      free,
    },
    // Grants are created with a non-"created" status, so they are subtracted from purchases.
    subscriptions: { purchases: Math.max(0, purchasedAll - grantsTotal), grants: grantsTotal, byStatus },
    revenue: {
      totalInPaise: revenueTotal.netInPaise,
      successfulPayments: revenueTotal.payments,
      todayInPaise: revenueToday.netInPaise,
      yesterdayInPaise: revenueYesterday.netInPaise,
      thisMonthInPaise: revenueMonth.netInPaise,
      lastMonthInPaise: revenueLastMonth.netInPaise,
      failedPayments7d: failed7d,
      refundedInPaise: revenueTotal.refundedInPaise,
    },
    plans: planCounts.filter((p) => p.subscribers > 0 || plansSnap.docs.find((d) => d.id === p.planId)?.data().featured),
  };
};

/**
 * Complimentary grants have no Razorpay webhooks to end them. Flip lapsed ones to "expired" so status
 * filters and charts stay truthful (access itself already ended — computeEntitlement checks the date).
 */
export const sweepLapsedGrants = async () => {
  const now = Date.now();
  const snap = await refs.subscriptions()
    .where('source', '==', 'admin_grant')
    .where('status', '==', 'active')
    .where('currentPeriodEnd', '<=', ts(now))
    .limit(100)
    .get();
  for (const doc of snap.docs) {
    await db.runTransaction(async (tx) => {
      const sub = (await tx.get(doc.ref)).data();
      if (!sub || sub.status !== 'active') return;
      const userRef = refs.user(sub.userId);
      const user = (await tx.get(userRef)).data();
      tx.set(doc.ref, { ...sub, status: 'expired', endedAt: sub.currentPeriodEnd, lastEvent: { name: 'grant.lapsed', receivedAt: now }, updatedAt: now });
      tx.create(refs.subscriptionEvents(doc.id).doc(), { event: 'grant.lapsed', fromStatus: 'active', toStatus: 'expired', razorpayEventId: null, receivedAt: now });
      if (user?.entitlement?.subscriptionId === doc.id) {
        tx.set(userRef, { entitlement: { ...user.entitlement, status: 'expired', currentPeriodEnd: capPeriodEnd(sub.currentPeriodEnd, now) }, updatedAt: now }, { merge: true });
      }
    });
  }
  return snap.size;
};

export const getOverview = async (refresh: boolean) => {
  const ref = refs.adminStats().doc('overview');
  const cached = (await ref.get()).data();
  if (cached && !refresh && Date.now() - cached.computedAt < OVERVIEW_TTL_MS) return { ...cached, cached: true };
  try {
    await sweepLapsedGrants();
  } catch (error) {
    logger.warn('Grant sweep failed (overview continues)', { error });
  }
  const fresh = await computeOverview();
  await ref.set(fresh);
  return { ...fresh, cached: false };
};

// ── Daily series ─────────────────────────────────────────────────────────────

const computeDay = async (key: string): Promise<DailyStat> => {
  const from = istDateStart(key);
  const to = from + DAY_MS;
  const inRange = <T>(q: Query<T>, field: string) => q.where(field, '>=', ts(from)).where(field, '<', ts(to));
  const [registrations, revenue, failedPayments, subscriptionsStarted, grants] = await Promise.all([
    count(inRange(refs.users(), 'createdAt')),
    revenueOf(inRange(successful(), 'paymentCreatedAt')),
    count(inRange(refs.transactions().where('status', '==', 'failed'), 'paymentCreatedAt')),
    count(inRange(refs.subscriptions().where('status', 'in', PURCHASED_STATUSES), 'createdAt')),
    count(inRange(refs.subscriptions().where('source', '==', 'admin_grant'), 'createdAt')),
  ]);
  return {
    registrations,
    revenueInPaise: revenue.netInPaise,
    payments: revenue.payments,
    failedPayments,
    newSubscriptions: Math.max(0, subscriptionsStarted - grants),
    grants,
  };
};

/** Runs tasks with bounded concurrency (a long first range must not open hundreds of RPCs at once). */
const pool = async <T>(items: T[], limit: number, fn: (item: T) => Promise<void>) => {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) await fn(items[next++] as T);
    }),
  );
};

export const getSeries = async (from: string, to: string, opts: { force?: boolean } = {}) => {
  const now = Date.now();
  const todayKey = istDateKey(now);
  const end = to > todayKey ? todayKey : to;
  const keys = dateKeysBetween(from, end);
  if (keys.length === 0) return [];
  if (keys.length > MAX_RANGE_DAYS) throw new Error(`Choose a range of at most ${MAX_RANGE_DAYS} days.`);

  const months = [...new Set(keys.map((k) => k.slice(0, 7)))];
  const monthRefs = months.map((m) => refs.adminDailyStats().doc(m));
  const monthDocs = new Map((await db.getAll(...monthRefs)).map((s) => [s.id, (s.data() as DailyStatsMonthDoc | undefined) ?? null]));

  const result = new Map<string, DailyStat>();
  const stale: string[] = [];
  for (const key of keys) {
    const cached = monthDocs.get(key.slice(0, 7))?.days?.[key.slice(8)];
    const dayEnd = istDateStart(key) + DAY_MS;
    const settled = cached && cached.computedAt >= dayEnd + SETTLE_MS;
    const fresh = cached && now - cached.computedAt < DAY_TTL_MS;
    if (cached && !opts.force && (settled || fresh)) result.set(key, cached);
    else stale.push(key);
  }

  if (stale.length) {
    const computed = new Map<string, DailyStat & { computedAt: number }>();
    await pool(stale, 12, async (key) => {
      computed.set(key, { ...(await computeDay(key)), computedAt: Date.now() });
    });
    // Merge into the month documents (one write per month touched).
    const byMonth = new Map<string, Record<string, DailyStat & { computedAt: number }>>();
    for (const [key, value] of computed) {
      result.set(key, value);
      const m = byMonth.get(key.slice(0, 7)) ?? {};
      m[key.slice(8)] = value;
      byMonth.set(key.slice(0, 7), m);
    }
    const batch = db.batch();
    for (const [month, days] of byMonth) {
      batch.set(refs.adminDailyStats().doc(month), { days, updatedAt: Date.now() } as DailyStatsMonthDoc, { merge: true });
    }
    await batch.commit();
  }

  return keys.map((date) => {
    const d = result.get(date);
    return {
      date,
      registrations: d?.registrations ?? 0,
      revenueInPaise: d?.revenueInPaise ?? 0,
      payments: d?.payments ?? 0,
      failedPayments: d?.failedPayments ?? 0,
      newSubscriptions: d?.newSubscriptions ?? 0,
      grants: d?.grants ?? 0,
    };
  });
};

export const rebuildSeries = async (from: string, to: string, actor: Parameters<typeof audit.write>[0]['actor']) => {
  const days = await getSeries(from, to, { force: true });
  await refs.adminStats().doc('overview').delete();
  await audit.write({ action: 'maintenance.run', actor, details: { task: 'stats.rebuild', from, to, days: days.length } });
  return days.length;
};
