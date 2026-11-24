import { Router } from 'express';
import { z } from 'zod';

import { config } from '../config';
import { paymentsRepo, plansRepo, subscriptionsRepo } from '../db/repositories/billing';
import { usersRepo } from '../db/repositories/users';
import { requireAdmin, safeEqual, signAdminToken } from '../lib/auth';
import { handle, HttpError, parseBody } from '../lib/http';
import { computeEntitlement } from '../services/entitlement';
import { createRazorpayPlan, razorpayConfigured } from '../services/razorpay';

export const adminRouter = Router();

adminRouter.post(
  '/admin/login',
  handle(async (req, res) => {
    const { password } = parseBody(z.object({ password: z.string().min(1) }), req.body);
    const expected = config.adminPassword;
    if (!expected) throw new HttpError(503, 'ADMIN_PASSWORD is not configured on the server.', 'admin_unconfigured');
    if (!safeEqual(password, expected)) throw new HttpError(401, 'Wrong password.', 'unauthorized');
    res.json({ token: signAdminToken(), environment: config.appEnv });
  }),
);

adminRouter.use('/admin', requireAdmin);

adminRouter.get(
  '/admin/plans',
  handle(async (_req, res) => {
    res.json({ plans: await plansRepo.list(), razorpayConfigured: razorpayConfigured(), environment: config.appEnv });
  }),
);

const planSchema = z
  .object({
    name: z.string().trim().min(2).max(60),
    description: z.string().trim().max(200).optional(),
    priceInPaise: z.number().int().min(100, 'Price must be at least ₹1.'),
    period: z.enum(['daily', 'weekly', 'monthly', 'yearly']),
    interval: z.number().int().min(1).max(12),
    trialDays: z.number().int().min(0).max(90),
    trialPriceInPaise: z.number().int().min(0),
    featured: z.boolean(),
    active: z.boolean(),
  })
  .refine((p) => p.period !== 'daily' || p.interval >= 7, { message: 'Razorpay daily plans need an interval of at least 7.' })
  .refine((p) => p.trialDays > 0 || p.trialPriceInPaise === 0, { message: 'Set trial days to use a trial price.' });

/**
 * Creates a plan in Razorpay, then Firestore. Razorpay plans are immutable, so a price or
 * duration change = create a new plan, feature it, and deactivate (archive) the old one.
 */
adminRouter.post(
  '/admin/plans',
  handle(async (req, res) => {
    const input = parseBody(planSchema, req.body);
    const description = input.description || null;
    const razorpayPlanId = await createRazorpayPlan({ ...input, description });
    const plan = await plansRepo.create({ ...input, description, razorpayPlanId });
    res.status(201).json({ plan });
  }),
);

/** Only display/visibility fields are editable. */
adminRouter.patch(
  '/admin/plans/:id',
  handle(async (req, res) => {
    const patch = parseBody(
      z.object({ name: z.string().trim().min(2).max(60).optional(), featured: z.boolean().optional(), active: z.boolean().optional() }),
      req.body,
    );
    const plan = await plansRepo.update(String(req.params.id), patch);
    if (!plan) throw new HttpError(404, 'Plan not found', 'not_found');
    res.json({ plan });
  }),
);

adminRouter.get(
  '/admin/users',
  handle(async (_req, res) => {
    const users = await usersRepo.list(200);
    res.json({
      users: users.map((u) => {
        const ent = computeEntitlement(u.entitlement);
        return {
          id: u.id,
          phone: u.phone,
          fullName: u.profile?.fullName,
          dob: u.profile?.dob,
          premium: ent.active,
          status: ent.status,
          createdAt: u.createdAt,
        };
      }),
    });
  }),
);

adminRouter.get(
  '/admin/subscriptions',
  handle(async (_req, res) => {
    const subscriptions = await subscriptionsRepo.list(200);
    res.json({
      subscriptions: subscriptions.map((s) => ({
        id: s.id,
        userId: s.userId,
        planId: s.planId,
        planName: s.planSnapshot.name,
        status: s.status,
        currentPeriodEnd: s.currentPeriodEnd,
        cancelAtPeriodEnd: s.cancelAtPeriodEnd,
        createdAt: s.createdAt,
      })),
    });
  }),
);

adminRouter.get(
  '/admin/payments',
  handle(async (_req, res) => {
    res.json({ payments: await paymentsRepo.list(200) });
  }),
);
