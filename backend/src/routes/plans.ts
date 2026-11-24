import { Router } from 'express';

import { plansRepo, termsOf } from '../db/repositories/billing';
import { handle } from '../lib/http';
import type { PlanDoc, PublicPlan } from '../types';

export const toPublicPlan = (id: string, plan: PlanDoc): PublicPlan => ({ id, ...termsOf(plan) });

export const plansRouter = Router();

/** The one plan shown on the paywall — chosen in the admin page ("featured"). */
plansRouter.get(
  '/plans/featured',
  handle(async (_req, res) => {
    const plan = await plansRepo.featured();
    res.json({ plan: plan ? toPublicPlan(plan.id, plan) : null });
  }),
);
