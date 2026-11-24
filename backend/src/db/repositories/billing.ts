import {
  SCHEMA_VERSION,
  type PaymentDoc,
  type PlanDoc,
  type PlanTerms,
  type SubscriptionDoc,
} from '../../types';
import { db, refs } from '../firestore';

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

export const termsOf = (plan: PlanDoc): PlanTerms => ({
  name: plan.name,
  priceInPaise: plan.priceInPaise,
  period: plan.period,
  interval: plan.interval,
  trialDays: plan.trialDays,
  trialPriceInPaise: plan.trialPriceInPaise,
});

export const subscriptionsRepo = {
  get: async (subscriptionId: string): Promise<SubscriptionDoc | null> =>
    (await refs.subscriptions().doc(subscriptionId).get()).data() ?? null,

  /** Created when checkout starts; verifies both foreign keys exist first. */
  createPending: (subscriptionId: string, userId: string, planId: string) =>
    db.runTransaction(async (tx) => {
      const [user, plan] = await Promise.all([tx.get(refs.user(userId)), tx.get(refs.plans().doc(planId))]);
      if (!user.exists) throw new Error(`User ${userId} not found`);
      const planDoc = plan.data();
      if (!planDoc) throw new Error(`Plan ${planId} not found`);
      const now = Date.now();
      const doc: SubscriptionDoc = {
        schemaVersion: SCHEMA_VERSION,
        userId,
        planId,
        planSnapshot: termsOf(planDoc),
        status: 'created',
        startAt: null,
        currentPeriodStart: null,
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
        cancelledAt: null,
        endedAt: null,
        lastEvent: null,
        createdAt: now,
        updatedAt: now,
      };
      tx.create(refs.subscriptions().doc(subscriptionId), doc);
      return doc;
    }),

  listByUser: async (userId: string, limit: number) => {
    const snap = await refs.subscriptions().where('userId', '==', userId).orderBy('createdAt', 'desc').limit(limit).get();
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  },

  list: async (limit: number) => {
    const snap = await refs.subscriptions().orderBy('createdAt', 'desc').limit(limit).get();
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  },
};

export const paymentsRepo = {
  /** Idempotent: keyed by the Razorpay payment id, so webhook retries never duplicate a payment. */
  upsert: (paymentId: string, payment: Omit<PaymentDoc, 'schemaVersion' | 'createdAt' | 'updatedAt'>) =>
    db.runTransaction(async (tx) => {
      const ref = refs.payments().doc(paymentId);
      const existing = (await tx.get(ref)).data();
      const now = Date.now();
      tx.set(ref, { ...payment, schemaVersion: SCHEMA_VERSION, createdAt: existing?.createdAt ?? now, updatedAt: now });
    }),

  list: async (limit: number) => {
    const snap = await refs.payments().orderBy('paidAt', 'desc').limit(limit).get();
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  },
};
