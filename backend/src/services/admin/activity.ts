import { Timestamp } from 'firebase-admin/firestore';

import { refs } from '../../db/firestore';
import { DAY_MS } from '../../db/schema';
import { planNames, subscriptionRow, transactionRow, userNames, userRow } from './lists';

const LIMIT = 6;

/**
 * Dashboard "Recent activity" + top-bar notifications. Each list is a small limited query; names are
 * joined with one batched read. About 40 document reads per call — no listeners, no full scans.
 */
export const getActivity = async () => {
  const now = Date.now();
  const [users, purchases, expired, payments, failed, troubled, deletions, plans] = await Promise.all([
    refs.users().orderBy('createdAt', 'desc').limit(LIMIT).get(),
    // Over-fetch a little: grants are filtered out of purchases, and users still inside the
    // payment-retry grace window (period ended, access continues) out of "recently expired".
    refs.subscriptions()
      .where('status', 'in', ['authenticated', 'active', 'pending', 'halted', 'cancelled', 'completed'])
      .orderBy('createdAt', 'desc')
      .limit(LIMIT * 3)
      .get(),
    refs.users().where('entitlement.currentPeriodEnd', '<=', Timestamp.fromMillis(now)).orderBy('entitlement.currentPeriodEnd', 'desc').limit(LIMIT * 3).get(),
    refs.transactions().orderBy('paymentCreatedAt', 'desc').limit(LIMIT).get(),
    refs.transactions()
      .where('status', '==', 'failed')
      .where('paymentCreatedAt', '>=', Timestamp.fromMillis(now - 7 * DAY_MS))
      .orderBy('paymentCreatedAt', 'desc')
      .limit(10)
      .get(),
    refs.subscriptions().where('status', 'in', ['pending', 'halted']).orderBy('createdAt', 'desc').limit(10).get(),
    refs.userDeletions().where('status', '==', 'failed').limit(10).get(),
    planNames(),
  ]);

  const purchaseDocs = purchases.docs.filter((d) => d.data().source !== 'admin_grant').slice(0, LIMIT);
  const expiredRows = expired.docs.map((d) => userRow(d.id, d.data())).filter((u) => u.access === 'expired').slice(0, LIMIT);
  const names = await userNames([
    ...purchaseDocs.map((d) => d.data().userId),
    ...payments.docs.map((d) => d.data().userId),
    ...failed.docs.map((d) => d.data().userId),
    ...troubled.docs.map((d) => d.data().userId),
  ]);

  return {
    recentUsers: users.docs.map((d) => userRow(d.id, d.data())),
    recentPurchases: purchaseDocs.map((d) => subscriptionRow(d.id, d.data(), names.get(d.data().userId))),
    recentlyExpired: expiredRows,
    latestPayments: payments.docs.map((d) => transactionRow(d.id, d.data(), names.get(d.data().userId), plans.get(d.data().planId))),
    notifications: [
      ...failed.docs.map((d) => {
        const t = d.data();
        const who = names.get(t.userId)?.name ?? names.get(t.userId)?.phone ?? t.userId;
        return {
          id: `pay:${d.id}`,
          kind: 'payment_failed' as const,
          title: `Payment failed · ₹${(t.amountInPaise / 100).toLocaleString('en-IN')}`,
          body: `${who}${t.errorDescription ? ` — ${t.errorDescription}` : ''}`,
          at: t.paymentCreatedAt,
          userId: t.userId,
        };
      }),
      ...troubled.docs.map((d) => {
        const s = d.data();
        const who = names.get(s.userId)?.name ?? names.get(s.userId)?.phone ?? s.userId;
        return {
          id: `sub:${d.id}`,
          kind: 'subscription_at_risk' as const,
          title: s.status === 'halted' ? 'Subscription halted' : 'Renewal payment retrying',
          body: `${who} · ${s.planSnapshot.name}`,
          at: s.updatedAt,
          userId: s.userId,
        };
      }),
      ...deletions.docs.map((d) => ({
        id: `del:${d.id}`,
        kind: 'deletion_failed' as const,
        title: 'User deletion stopped',
        body: d.data().lastError ?? 'Retry from the user page to resume.',
        at: d.data().updatedAt,
        userId: d.id,
      })),
    ].sort((a, b) => b.at - a.at),
  };
};
