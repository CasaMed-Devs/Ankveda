/**
 * Paywall & pricing. The paywall shows the one featured plan (plans collection — kept as the source of
 * truth instead of a duplicate app_config document, so the app needs no change).
 *
 *  - Trial on/off, trial days and trial amount: edited IN PLACE. The trial is applied when a subscription
 *    is created (start_at delay + add-on), not stored in the Razorpay plan, so no Razorpay plan id is needed.
 *  - Monthly amount: Razorpay plans are immutable. A new amount needs a new Razorpay plan id, entered by the
 *    admin as-is (not checked against Razorpay — transactions flag priceMismatch if a charge differs from
 *    the locked price). A new featured plan document is written and the old one archived.
 *
 * Price lock (grandfathering): every Razorpay subscription stays bound to the plan it was bought on, so a
 * change here never touches existing subscribers — paying users AND users in a trial keep renewing at their
 * locked terms (subscriptions.lockedPriceInPaise / planSnapshot). Only new checkouts, including a user who
 * cancelled and buys again, get the new plan.
 */
import { db, refs } from '../../db/firestore';
import type { PlanWithId } from '../../db/repositories/billing';
import { HttpError } from '../../lib/http';
import { SCHEMA_VERSION, type AdminActor, type PlanDoc } from '../../types';
import { effectiveTerms } from '../billingRules';
import { createRazorpayPlan, razorpayConfigured } from '../razorpay';
import { audit } from './audit';

export type PriceChange =
  | { mode: 'unchanged' }
  | { mode: 'create'; priceInPaise: number }
  | { mode: 'existing'; priceInPaise: number; razorpayPlanId: string };

export type PricingInput = {
  /** Optimistic concurrency: the updatedAt the admin loaded (null when no plan exists yet). */
  expectedUpdatedAt: number | null;
  name: string;
  description: string | null;
  trialEnabled: boolean;
  trialDays: number;
  trialPriceInPaise: number;
  monthlyPlanEnabled: boolean;
  price: PriceChange;
};

/** The paywall plan, whether or not it is currently enabled. */
const currentFeatured = async (): Promise<PlanWithId | null> => {
  const snap = await refs.plans().where('featured', '==', true).limit(5).get();
  const docs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  return docs.sort((a, b) => Number(b.active) - Number(a.active) || b.updatedAt - a.updatedAt)[0] ?? null;
};

const planView = (p: PlanWithId) => ({
  id: p.id,
  name: p.name,
  description: p.description,
  priceInPaise: p.priceInPaise,
  currency: p.currency,
  period: p.period,
  interval: p.interval,
  trialEnabled: p.trialEnabled !== false && p.trialDays > 0,
  trialDays: p.trialDays,
  trialPriceInPaise: p.trialPriceInPaise,
  effective: effectiveTerms(p),
  monthlyPlanEnabled: p.active,
  featured: p.featured,
  razorpayPlanId: p.razorpayPlanId,
  archivedAt: p.archivedAt,
  createdAt: p.createdAt,
  updatedAt: p.updatedAt,
  updatedBy: p.updatedBy ?? null,
});

export const getPricing = async () => {
  const [featured, all] = await Promise.all([currentFeatured(), refs.plans().orderBy('createdAt', 'desc').limit(50).get()]);
  return {
    plan: featured ? planView(featured) : null,
    history: all.docs.map((d) => planView({ id: d.id, ...d.data() })),
    razorpayConfigured: razorpayConfigured(),
  };
};

const validate = (input: PricingInput) => {
  if (input.trialEnabled) {
    if (input.trialDays < 1 || input.trialDays > 90) throw new HttpError(400, 'Trial duration must be 1–90 days.', 'validation');
    if (input.trialPriceInPaise !== 0 && input.trialPriceInPaise < 100) {
      throw new HttpError(400, 'A paid trial must cost at least ₹1 (or ₹0 for a free trial).', 'validation');
    }
  }
  if (input.price.mode !== 'unchanged' && input.price.priceInPaise < 100) {
    throw new HttpError(400, 'The monthly amount must be at least ₹1.', 'validation');
  }
};

export const updatePricing = async (input: PricingInput, actor: AdminActor) => {
  validate(input);
  const current = await currentFeatured();
  if ((current?.updatedAt ?? null) !== input.expectedUpdatedAt) {
    throw new HttpError(409, 'Pricing was changed by someone else since you opened this page. Reload to see the latest values.', 'conflict');
  }
  if (!current && input.price.mode === 'unchanged') {
    throw new HttpError(400, 'There is no paywall plan yet — set the monthly amount and a Razorpay plan to create one.', 'validation');
  }
  const priceChanging = input.price.mode !== 'unchanged';
  if (input.price.mode === 'create' && current && input.price.priceInPaise === current.priceInPaise) {
    throw new HttpError(400, 'The monthly amount is unchanged — no new Razorpay plan is needed.', 'validation');
  }

  // 1. Razorpay (outside the transaction — it is an external call).
  let razorpayPlanId = current?.razorpayPlanId ?? '';
  let priceInPaise = current?.priceInPaise ?? 0;
  const period = current?.period ?? 'monthly';
  const interval = current?.interval ?? 1;
  if (input.price.mode === 'create') {
    if (!razorpayConfigured()) throw new HttpError(503, 'Razorpay keys are not configured on the server — a new plan cannot be created.', 'payments_unconfigured');
    razorpayPlanId = await createRazorpayPlan({ name: input.name, description: input.description, priceInPaise: input.price.priceInPaise, period, interval });
    priceInPaise = input.price.priceInPaise;
  } else if (input.price.mode === 'existing') {
    const id = input.price.razorpayPlanId.trim();
    if (!/^plan_[A-Za-z0-9]+$/.test(id)) throw new HttpError(400, 'Enter a Razorpay plan id like plan_XXXXXXXX.', 'validation');
    // The plan id changes only together with the price, and a new price always needs a new plan.
    // The id is stored as the admin entered it (not looked up in Razorpay).
    if (current && input.price.priceInPaise === current.priceInPaise) {
      throw new HttpError(400, 'The monthly amount is unchanged — the Razorpay plan can only be replaced when the price changes.', 'validation');
    }
    if (current && id === current.razorpayPlanId) {
      throw new HttpError(400, 'A new price needs a new Razorpay plan ID — this is the current plan.', 'validation');
    }
    razorpayPlanId = id;
    priceInPaise = input.price.priceInPaise;
  }

  // 2. Firestore, atomically with the audit entry.
  const now = Date.now();
  return db.runTransaction(async (tx) => {
    const fresh = current ? (await tx.get(refs.plans().doc(current.id))).data() : null;
    if (current && fresh?.updatedAt !== current.updatedAt) {
      throw new HttpError(409, 'Pricing changed while saving. Reload and try again.', 'conflict');
    }
    const fields = {
      name: input.name,
      description: input.description,
      trialEnabled: input.trialEnabled,
      // Keep the configured values when the trial is switched off (effectiveTerms() returns 0 then).
      trialDays: input.trialEnabled ? input.trialDays : (current?.trialDays ?? 0),
      trialPriceInPaise: input.trialEnabled ? input.trialPriceInPaise : (current?.trialPriceInPaise ?? 0),
      active: input.monthlyPlanEnabled,
      archivedAt: input.monthlyPlanEnabled ? null : now,
      updatedBy: actor,
      updatedAt: now,
    };

    let planId: string;
    if (priceChanging || !current) {
      const ref = refs.plans().doc();
      const doc: PlanDoc = {
        ...fields,
        priceInPaise,
        period,
        interval,
        currency: 'INR',
        featured: true,
        razorpayPlanId,
        schemaVersion: SCHEMA_VERSION,
        createdAt: now,
      };
      tx.create(ref, doc);
      if (current && fresh) {
        // Archived, never deleted: existing subscriptions still reference it.
        tx.set(refs.plans().doc(current.id), { ...fresh, featured: false, active: false, archivedAt: now, updatedBy: actor, updatedAt: now });
      }
      planId = ref.id;
    } else {
      tx.set(refs.plans().doc(current.id), { ...(fresh as PlanDoc), ...fields });
      planId = current.id;
    }

    const before = current ? planView(current) : null;
    audit.inTx(
      tx,
      {
        action: 'pricing.update',
        actor,
        planId,
        details: {
          priceMode: input.price.mode,
          previousPlanId: current?.id ?? null,
          before: before && {
            priceInPaise: before.priceInPaise,
            razorpayPlanId: before.razorpayPlanId,
            trialEnabled: before.trialEnabled,
            trialDays: before.trialDays,
            trialPriceInPaise: before.trialPriceInPaise,
            monthlyPlanEnabled: before.monthlyPlanEnabled,
            name: before.name,
            description: before.description,
          },
          after: {
            priceInPaise,
            razorpayPlanId,
            trialEnabled: input.trialEnabled,
            trialDays: fields.trialDays,
            trialPriceInPaise: fields.trialPriceInPaise,
            monthlyPlanEnabled: input.monthlyPlanEnabled,
            name: input.name,
            description: input.description,
          },
        },
      },
      now,
    );
    return planId;
  });
};
