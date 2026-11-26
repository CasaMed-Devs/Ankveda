/**
 * Admin dashboard API. Every route requires a Firebase Auth ID token with the `admin` custom claim
 * (lib/auth.ts → requireAdmin). The dashboard never reads Firestore directly — rules deny all clients.
 */
import { FieldPath } from 'firebase-admin/firestore';
import { Router } from 'express';
import { z } from 'zod';

import { config } from '../config';
import { db, refs } from '../db/firestore';
import { plansRepo, subscriptionsRepo, transactionsRepo } from '../db/repositories/billing';
import { searchName } from '../db/repositories/users';
import { DAY_MS } from '../db/schema';
import { actorOf, requireAdmin } from '../lib/auth';
import { handle, HttpError, parseBody } from '../lib/http';
import { getActivity } from '../services/admin/activity';
import { audit } from '../services/admin/audit';
import { deleteUser } from '../services/admin/deletion';
import {
  listAudit,
  listSubscriptions,
  listTransactions,
  listUsers,
  subscriptionRow,
  SUBSCRIPTION_FILTERS,
  TRANSACTION_FILTERS,
  transactionRow,
  USER_STATUS_FILTERS,
  userNames,
} from '../services/admin/lists';
import { pageSizeOf } from '../services/admin/paging';
import { getPricing, updatePricing } from '../services/admin/pricing';
import { getOverview, getSeries, rebuildSeries } from '../services/admin/stats';
import { adminExpire, grantSubscription } from '../services/admin/subscriptionActions';
import { istDateStart, isDateKey } from '../services/admin/time';
import { getUserDetail } from '../services/admin/userDetail';
import { listMetaEvents, metaEventSummary } from '../services/metaEvents';
import { getInvoice, listInvoices } from '../services/invoice';
import { buildInvoiceHtml } from '../services/invoiceHtml';
import { razorpayConfigured } from '../services/razorpay';
import { META_EVENT_NAMES, type AuditAction } from '../types';

export const adminRouter = Router();

adminRouter.use('/admin', requireAdmin);

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const oneOf = <T extends string>(values: readonly T[], v: unknown): T | undefined =>
  typeof v === 'string' && (values as readonly string[]).includes(v) ? (v as T) : undefined;
/** IST calendar day "YYYY-MM-DD" → start (from) / exclusive end (to) instants. */
const dayStart = (v: unknown) => (isDateKey(v) ? istDateStart(v) : undefined);
const dayEnd = (v: unknown) => (isDateKey(v) ? istDateStart(v) + DAY_MS : undefined);

// ── Session & system ─────────────────────────────────────────────────────────

/** Called by the dashboard right after sign-in: records the login once per Firebase sign-in. */
adminRouter.post(
  '/admin/session',
  handle(async (req, res) => {
    const admin = req.admin!;
    const loginId = `login_${admin.uid}_${admin.authTime}`;
    await refs
      .adminAuditLog()
      .doc(loginId)
      .create({ action: 'admin.login', actor: { uid: admin.uid, email: admin.email }, details: { ip: req.ip ?? null }, createdAt: Date.now() })
      .catch((e: { code?: number }) => {
        if (e.code !== 6) throw e; // ALREADY_EXISTS → this sign-in was already recorded
      });
    res.json({ admin: { uid: admin.uid, email: admin.email }, environment: config.appEnv });
  }),
);

adminRouter.get(
  '/admin/system',
  handle(async (_req, res) => {
    res.json({
      environment: config.appEnv,
      firestoreDatabaseId: config.firestoreDatabaseId,
      razorpayConfigured: razorpayConfigured(),
      razorpayWebhookConfigured: !!config.razorpayWebhookSecret,
      razorpayKeyMode: config.razorpay?.keyId.startsWith('rzp_live') ? 'live' : config.razorpay ? 'test' : null,
      reportRunner: config.reportRunner,
    });
  }),
);

// ── Statistics ───────────────────────────────────────────────────────────────

adminRouter.get(
  '/admin/stats/overview',
  handle(async (req, res) => {
    res.json(await getOverview(req.query.refresh === '1'));
  }),
);

const rangeSchema = z
  .object({ from: z.string().refine(isDateKey, 'Invalid start date'), to: z.string().refine(isDateKey, 'Invalid end date') })
  .refine((r) => r.from <= r.to, { message: 'The start date must be before the end date.' })
  .refine((r) => (istDateStart(r.to) - istDateStart(r.from)) / DAY_MS < 366, { message: 'Choose a range of at most 366 days.' });

adminRouter.get(
  '/admin/stats/series',
  handle(async (req, res) => {
    const { from, to } = parseBody(rangeSchema, req.query);
    res.json({ days: await getSeries(from, to) });
  }),
);

adminRouter.post(
  '/admin/stats/rebuild',
  handle(async (req, res) => {
    const { from, to } = parseBody(rangeSchema, req.body);
    res.json({ days: await rebuildSeries(from, to, actorOf(req)) });
  }),
);

adminRouter.get(
  '/admin/activity',
  handle(async (_req, res) => {
    res.json(await getActivity());
  }),
);

// ── Users ────────────────────────────────────────────────────────────────────

adminRouter.get(
  '/admin/users',
  handle(async (req, res) => {
    const q = req.query;
    res.json(
      await listUsers({
        pageSize: pageSizeOf(q.pageSize),
        cursor: str(q.cursor),
        status: oneOf(USER_STATUS_FILTERS, q.status),
        planId: str(q.planId),
        from: dayStart(q.from),
        to: dayEnd(q.to),
        q: str(q.q),
      }),
    );
  }),
);

adminRouter.get(
  '/admin/users/:id',
  handle(async (req, res) => {
    res.json(await getUserDetail(String(req.params.id)));
  }),
);

const grantSchema = z
  .object({
    planId: z.string().min(1, 'Choose a plan.'),
    startDate: z.string().refine(isDateKey, 'Invalid start date').optional(),
    durationDays: z.number().int().min(1).max(3650).optional(),
    expiryDate: z.string().refine(isDateKey, 'Invalid expiry date').optional(),
    notes: z.string().trim().max(500).optional(),
  })
  .refine((g) => g.durationDays || g.expiryDate, { message: 'Choose a duration or an expiry date.' });

adminRouter.post(
  '/admin/users/:id/grant',
  handle(async (req, res) => {
    const input = parseBody(grantSchema, req.body);
    const today = istDateStart(new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10));
    if (input.startDate && istDateStart(input.startDate) > today) {
      throw new HttpError(400, 'The start date cannot be in the future — a grant gives access immediately.', 'validation');
    }
    // A start date of "today" means now; earlier dates are backdated to the start of that IST day.
    const startAt = input.startDate && istDateStart(input.startDate) < today ? istDateStart(input.startDate) : Date.now();
    const subscription = await grantSubscription(
      String(req.params.id),
      {
        planId: input.planId,
        startAt,
        durationDays: input.durationDays,
        // Expiry date is inclusive: access lasts until the end of that IST day.
        endAt: input.expiryDate ? istDateStart(input.expiryDate) + DAY_MS : undefined,
        notes: input.notes ?? null,
      },
      actorOf(req),
    );
    res.status(201).json({ subscription: subscriptionRow(subscription.id, subscription) });
  }),
);

/**
 * Permanent deletion. `confirm` must repeat the user id (typed confirmation in the dashboard). It is read
 * from the body or the query string — some proxies drop DELETE bodies. `force` deletes even when Razorpay
 * billing can't be confirmed stopped.
 */
adminRouter.delete(
  '/admin/users/:id',
  handle(async (req, res) => {
    const id = String(req.params.id);
    const body = req.body && typeof req.body === 'object' && Object.keys(req.body).length ? req.body : req.query;
    const { confirm, force } = parseBody(
      z.object({ confirm: z.string(), force: z.union([z.boolean(), z.enum(['true', 'false'])]).optional() }),
      body,
    );
    if (confirm !== id) throw new HttpError(400, 'Confirmation does not match the user id.', 'validation');
    const job = await deleteUser(id, actorOf(req), { force: force === true || force === 'true' });
    res.json({
      deletion: { status: job.status, deleted: job.deleted, completedAt: job.completedAt, billingNotStopped: job.billingNotStopped ?? [] },
    });
  }),
);

// ── Subscriptions ────────────────────────────────────────────────────────────

adminRouter.get(
  '/admin/subscriptions',
  handle(async (req, res) => {
    const q = req.query;
    res.json(
      await listSubscriptions({
        pageSize: pageSizeOf(q.pageSize),
        cursor: str(q.cursor),
        filter: oneOf(SUBSCRIPTION_FILTERS, q.filter),
        userId: str(q.userId),
      }),
    );
  }),
);

/** One subscription with its full status history and every transaction (joined by the subscription id). */
adminRouter.get(
  '/admin/subscriptions/:id',
  handle(async (req, res) => {
    const id = String(req.params.id);
    const subscription = await subscriptionsRepo.get(id);
    if (!subscription) throw new HttpError(404, 'Subscription not found', 'not_found');
    const [events, transactions, names] = await Promise.all([
      subscriptionsRepo.events(id),
      transactionsRepo.listBySubscription(id, 100),
      userNames([subscription.userId]),
    ]);
    const user = names.get(subscription.userId);
    res.json({
      subscription: subscriptionRow(id, subscription, user),
      events,
      transactions: transactions.map((t) => transactionRow(t.id, t, user, subscription.planSnapshot.name)),
    });
  }),
);

adminRouter.post(
  '/admin/subscriptions/:id/expire',
  handle(async (req, res) => {
    const { mode, notes } = parseBody(
      z.object({ mode: z.enum(['cancel_renewal', 'expire_now']), notes: z.string().trim().max(500).optional() }),
      req.body,
    );
    const id = String(req.params.id);
    const sub = await adminExpire(id, mode, notes ?? null, actorOf(req));
    res.json({ subscription: sub ? subscriptionRow(id, sub) : null });
  }),
);

// ── Invoices ─────────────────────────────────────────────────────────────────

/** Every invoice of a user, including fully refunded payments (flagged). Grants never have one. */
adminRouter.get(
  '/admin/users/:id/invoices',
  handle(async (req, res) => {
    res.json({ invoices: await listInvoices(String(req.params.id), { includeRefunded: true }) });
  }),
);

/** The printable tax invoice — the identical HTML document the app renders to PDF. */
adminRouter.get(
  '/admin/invoices/:paymentId',
  handle(async (req, res) => {
    const invoice = await getInvoice(String(req.params.paymentId));
    if (!invoice) throw new HttpError(404, 'No invoice exists for this payment (not paid, or a complimentary grant).', 'not_found');
    res.set('Content-Type', 'text/html; charset=utf-8').set('Cache-Control', 'no-store').send(buildInvoiceHtml(invoice));
  }),
);

// ── Payments ─────────────────────────────────────────────────────────────────

adminRouter.get(
  '/admin/transactions',
  handle(async (req, res) => {
    const q = req.query;
    res.json(
      await listTransactions({
        pageSize: pageSizeOf(q.pageSize),
        cursor: str(q.cursor),
        filter: oneOf(TRANSACTION_FILTERS, q.filter),
        from: dayStart(q.from),
        to: dayEnd(q.to),
        userId: str(q.userId),
        subscriptionId: str(q.subscriptionId),
      }),
    );
  }),
);

// ── Plans & pricing ──────────────────────────────────────────────────────────

adminRouter.get(
  '/admin/plans',
  handle(async (_req, res) => {
    const plans = await plansRepo.list();
    res.json({
      plans: plans.map((p) => ({ id: p.id, name: p.name, priceInPaise: p.priceInPaise, period: p.period, interval: p.interval, active: p.active, featured: p.featured })),
      razorpayConfigured: razorpayConfigured(),
    });
  }),
);

adminRouter.get(
  '/admin/pricing',
  handle(async (_req, res) => {
    res.json(await getPricing());
  }),
);

const pricingSchema = z.object({
  expectedUpdatedAt: z.number().nullable(),
  name: z.string().trim().min(2, 'Plan name is too short.').max(60),
  description: z.string().trim().max(200).nullable(),
  trialEnabled: z.boolean(),
  trialDays: z.number().int().min(0).max(90),
  trialPriceInPaise: z.number().int().min(0).max(10_000_000),
  monthlyPlanEnabled: z.boolean(),
  price: z.discriminatedUnion('mode', [
    z.object({ mode: z.literal('unchanged') }),
    z.object({ mode: z.literal('create'), priceInPaise: z.number().int().min(100).max(10_000_000) }),
    z.object({ mode: z.literal('existing'), priceInPaise: z.number().int().min(100).max(10_000_000), razorpayPlanId: z.string().min(5) }),
  ]),
});

adminRouter.put(
  '/admin/pricing',
  handle(async (req, res) => {
    const input = parseBody(pricingSchema, req.body);
    const planId = await updatePricing({ ...input, description: input.description || null }, actorOf(req));
    res.json({ planId, ...(await getPricing()) });
  }),
);

// ── Audit log ────────────────────────────────────────────────────────────────

const AUDIT_ACTIONS: AuditAction[] = [
  'account.self_delete',
  'admin.login',
  'plan.create',
  'plan.update',
  'pricing.update',
  'subscription.grant',
  'subscription.expire',
  'subscription.cancel_renewal',
  'user.delete',
  'maintenance.run',
];

adminRouter.get(
  '/admin/audit',
  handle(async (req, res) => {
    const q = req.query;
    res.json(
      await listAudit({
        pageSize: pageSizeOf(q.pageSize),
        cursor: str(q.cursor),
        action: oneOf(AUDIT_ACTIONS, q.action),
        targetUserId: str(q.targetUserId),
      }),
    );
  }),
);

// ── Meta events (copies of what the app logged to Meta) ──────────────────────

adminRouter.get(
  '/admin/meta-events',
  handle(async (req, res) => {
    const q = req.query;
    res.json(
      await listMetaEvents({
        pageSize: pageSizeOf(q.pageSize),
        cursor: str(q.cursor),
        event: oneOf(META_EVENT_NAMES, q.event),
        userId: str(q.userId),
      }),
    );
  }),
);

adminRouter.get(
  '/admin/meta-events/summary',
  handle(async (_req, res) => {
    res.json(await metaEventSummary());
  }),
);

// ── Maintenance ──────────────────────────────────────────────────────────────

/** Fills users.nameLower (name search) for accounts created before search existed. Pages of 300. */
adminRouter.post(
  '/admin/maintenance/backfill-search',
  handle(async (req, res) => {
    let scanned = 0;
    let updated = 0;
    let last: string | null = null;
    for (;;) {
      let q = refs.users().orderBy(FieldPath.documentId()).limit(300);
      if (last) q = q.startAfter(last);
      const snap = await q.get();
      if (snap.empty) break;
      const batch = db.batch();
      for (const d of snap.docs) {
        const u = d.data();
        const wanted = u.profile?.fullName ? searchName(u.profile.fullName) : null;
        if ((u.nameLower ?? null) !== wanted) {
          batch.set(d.ref, { nameLower: wanted }, { merge: true });
          updated++;
        }
      }
      await batch.commit();
      scanned += snap.size;
      last = snap.docs[snap.docs.length - 1]!.id;
    }
    await audit.write({ action: 'maintenance.run', actor: actorOf(req), details: { task: 'search.backfill', scanned, updated } });
    res.json({ scanned, updated });
  }),
);
