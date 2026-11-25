import {
  SCHEMA_VERSION,
  type PlanDoc,
  type PlanTerms,
  type SubscriptionDoc,
  type TransactionDoc,
} from '../../types';
import { checkoutTerms, effectiveTerms } from '../../services/billingRules';
import { db, refs } from '../firestore';
import { usersRepo } from './users';

export type PlanWithId = PlanDoc & { id: string };

export const plansRepo = {
  get: async (planId: string): Promise<PlanDoc | null> => (await refs.plans().doc(planId).get()).data() ?? null,

  /** The single plan shown on the paywall. */
  featured: async (): Promise<PlanWithId | null> => {
    const snap = await refs.plans().where('featured', '==', true).where('active', '==', true).limit(1).get();
    const doc = snap.docs[0];
    return doc ? { id: doc.id, ...doc.data() } : null;
  },

  list: async (): Promise<PlanWithId[]> => {
    const snap = await refs.plans().orderBy('createdAt', 'desc').get();
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  },

  /** Creates a plan; when featured, un-features the others in the same transaction. Audited. */
  create: (plan: Omit<PlanDoc, 'schemaVersion' | 'createdAt' | 'updatedAt' | 'archivedAt' | 'currency'>) =>
    db.runTransaction(async (tx) => {
      const now = Date.now();
      const ref = refs.plans().doc();
      const featured = plan.featured ? await tx.get(refs.plans().where('featured', '==', true)) : null;
      const doc: PlanDoc = { ...plan, currency: 'INR', archivedAt: null, schemaVersion: SCHEMA_VERSION, createdAt: now, updatedAt: now };
      featured?.docs.forEach((d) => tx.set(d.ref, { featured: false, updatedAt: now }, { merge: true }));
      tx.create(ref, doc);
      tx.create(refs.adminAuditLog().doc(), { action: 'plan.create', planId: ref.id, changes: { ...plan }, createdAt: now });
      return { id: ref.id, ...doc };
    }),

  /** Display / visibility changes only — price and duration are immutable (Razorpay plans). Audited. */
  update: (planId: string, patch: { name?: string; featured?: boolean; active?: boolean }) =>
    db.runTransaction(async (tx) => {
      const ref = refs.plans().doc(planId);
      const featured = patch.featured ? await tx.get(refs.plans().where('featured', '==', true)) : null;
      const current = (await tx.get(ref)).data();
      if (!current) return null;
      const now = Date.now();
      const next: PlanDoc = {
        ...current,
        ...patch,
        // Deactivating archives the plan; it is never deleted because subscriptions reference it.
        archivedAt: patch.active === false ? now : patch.active === true ? null : current.archivedAt,
        updatedAt: now,
      };
      featured?.docs.filter((d) => d.id !== planId).forEach((d) => tx.set(d.ref, { featured: false, updatedAt: now }, { merge: true }));
      tx.set(ref, next);
      tx.create(refs.adminAuditLog().doc(), { action: 'plan.update', planId, changes: patch, createdAt: now });
      return { id: planId, ...next };
    }),
};

/** Terms a new subscriber gets (trial switched off = no trial). */
export const termsOf = (plan: PlanDoc): PlanTerms => effectiveTerms(plan);

export const subscriptionsRepo = {
  get: async (subscriptionId: string): Promise<SubscriptionDoc | null> =>
    (await refs.subscriptions().doc(subscriptionId).get()).data() ?? null,

  /**
   * Created when checkout starts, keyed by the Razorpay subscription id.
   * Verifies both foreign keys (user, plan) exist, and links the subscription to the user
   * (users.latestSubscriptionId / subscriptionIds) — all in one transaction, so the link exists
   * even when the checkout is closed without paying.
   * `withTrial: false` stores the terms without the trial (trial already used), so the first payment
   * is classified and invoiced as the monthly charge.
   */
  createPending: (args: {
    subscriptionId: string;
    userId: string;
    planId: string;
    totalCount: number;
    startAt: number | null;
    withTrial: boolean;
  }) =>
    db.runTransaction(async (tx) => {
      const userRef = refs.user(args.userId);
      const [user, plan] = await Promise.all([tx.get(userRef), tx.get(refs.plans().doc(args.planId))]);
      if (!user.exists) throw new Error(`User ${args.userId} not found`);
      const planDoc = plan.data();
      if (!planDoc) throw new Error(`Plan ${args.planId} not found`);
      const now = Date.now();
      const doc: SubscriptionDoc = {
        schemaVersion: SCHEMA_VERSION,
        userId: args.userId,
        planId: args.planId,
        planSnapshot: checkoutTerms(termsOf(planDoc), args.withTrial),
        razorpayPlanId: planDoc.razorpayPlanId,
        razorpayCustomerId: null,
        status: 'created',
        startAt: args.startAt,
        currentPeriodStart: null,
        currentPeriodEnd: null,
        nextChargeAt: args.startAt,
        paidCount: 0,
        totalCount: args.totalCount,
        subscriptionActivatedAt: null,
        cancelAtPeriodEnd: false,
        cancelledAt: null,
        endedAt: null,
        lastEvent: null,
        createdAt: now,
        updatedAt: now,
      };
      tx.create(refs.subscriptions().doc(args.subscriptionId), doc);
      tx.create(refs.subscriptionEvents(args.subscriptionId).doc(), {
        event: 'checkout.created',
        fromStatus: null,
        toStatus: 'created',
        razorpayEventId: null,
        receivedAt: now,
      });
      tx.set(userRef, usersRepo.subscriptionLinkWrite(args.subscriptionId), { merge: true });
      return doc;
    }),

  /** Status history, newest first. */
  events: async (subscriptionId: string, limit = 50) => {
    const snap = await refs.subscriptionEvents(subscriptionId).orderBy('receivedAt', 'desc').limit(limit).get();
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  },

  listByUser: async (userId: string, limit: number) => {
    const snap = await refs.subscriptions().where('userId', '==', userId).orderBy('createdAt', 'desc').limit(limit).get();
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  },

  list: async (limit: number) => {
    const snap = await refs.subscriptions().orderBy('createdAt', 'desc').limit(limit).get();
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  },
};

export type TransactionWithId = TransactionDoc & { id: string };

export const transactionsRepo = {
  get: async (paymentId: string): Promise<TransactionDoc | null> => (await refs.transactions().doc(paymentId).get()).data() ?? null,

  list: async (limit: number): Promise<TransactionWithId[]> => {
    const snap = await refs.transactions().orderBy('paymentCreatedAt', 'desc').limit(limit).get();
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  },

  listByUser: async (userId: string, limit: number): Promise<TransactionWithId[]> => {
    const snap = await refs.transactions().where('userId', '==', userId).orderBy('paymentCreatedAt', 'desc').limit(limit).get();
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  },

  listBySubscription: async (subscriptionId: string, limit: number): Promise<TransactionWithId[]> => {
    const snap = await refs.transactions().where('subscriptionId', '==', subscriptionId).orderBy('paymentCreatedAt', 'desc').limit(limit).get();
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  },
};
