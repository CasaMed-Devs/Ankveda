import { refs } from '../../db/firestore';
import { subscriptionsRepo, transactionsRepo } from '../../db/repositories/billing';
import { HttpError } from '../../lib/http';
import { getDeletionJob } from './deletion';
import { auditRow, planNames, subscriptionRow, transactionRow, userRow } from './lists';

/** Everything the user drawer shows, in a handful of bounded reads. */
export const getUserDetail = async (userId: string) => {
  const user = (await refs.user(userId).get()).data();
  if (!user) {
    const job = await getDeletionJob(userId);
    if (job) {
      const status = job.status === 'completed' ? 'was permanently deleted' : `deletion ${job.status} (${job.lastError ?? 'in progress'})`;
      throw new HttpError(404, `This user ${status}.`, 'user_deleted');
    }
    throw new HttpError(404, 'User not found.', 'not_found');
  }

  const [subscriptions, transactions, auditSnap, reportCount, plans, deletion] = await Promise.all([
    subscriptionsRepo.listByUser(userId, 20),
    transactionsRepo.listByUser(userId, 50),
    refs.adminAuditLog().where('targetUserId', '==', userId).orderBy('createdAt', 'desc').limit(20).get(),
    refs.reports(userId).count().get().then((s) => s.data().count),
    planNames(),
    getDeletionJob(userId),
  ]);

  const current = user.entitlement?.subscriptionId ? subscriptions.find((s) => s.id === user.entitlement?.subscriptionId) : undefined;
  const events = current ? await subscriptionsRepo.events(current.id, 30) : [];
  const identity = { name: user.profile?.fullName ?? null, phone: user.phone };

  return {
    user: {
      ...userRow(userId, user, current),
      countryCode: user.countryCode,
      profileCompletedAt: user.profileCompletedAt,
      numbers: user.profile?.numbers ?? null,
      updatedAt: user.updatedAt,
      reportCount,
    },
    currentSubscription: current ? { ...subscriptionRow(current.id, current, identity), events } : null,
    subscriptions: subscriptions.map((s) => subscriptionRow(s.id, s, identity)),
    transactions: transactions.map((t) => transactionRow(t.id, t, identity, plans.get(t.planId))),
    audit: auditSnap.docs.map((d) => auditRow(d.id, d.data())),
    deletion: deletion && deletion.status !== 'completed' ? { status: deletion.status, lastError: deletion.lastError, steps: deletion.steps } : null,
  };
};
