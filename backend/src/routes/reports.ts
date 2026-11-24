import { Router } from 'express';
import { z } from 'zod';

import { isStale, reportsRepo } from '../db/repositories/reports';
import { startReport } from '../jobs/reportRunner';
import { uidOf } from '../lib/auth';
import { handle, HttpError, parseBody } from '../lib/http';
import { dobSchema, nameSchema } from '../lib/validation';
import { isPremiumUser } from '../services/entitlement';
import { REPORT_TYPES, type ReportDoc, type ReportInput, type ReportType } from '../types';
import { loadUser, requireProfile } from './me';

const MAX_REPORTS_PER_DAY = 30;

const phone = z.string().regex(/^\d{10}$/, 'Enter 10 digits, without the country code.');
const carNumber = z
  .string()
  .transform((v) => v.toUpperCase().replace(/[^A-Z0-9]/g, ''))
  .pipe(z.string().min(4, 'Enter the vehicle number, e.g. MH12AB1234.').max(12));

/** Required fields per report type (mirrors app/src/lib/report-types.ts). */
const INPUT_SCHEMAS: Record<ReportType, z.ZodType<ReportInput>> = {
  name: z.object({ fullName: nameSchema, dob: dobSchema }),
  phone: z.object({ phone, dob: dobSchema }),
  birthdate: z.object({ dob: dobSchema }),
  compatibility: z.object({ fullName: nameSchema, dob: dobSchema, partnerName: nameSchema, partnerDob: dobSchema }),
  career: z.object({ fullName: nameSchema, dob: dobSchema, careerFocus: z.string().trim().max(120).optional() }),
  future: z.object({ dob: dobSchema, period: z.enum(['3m', '6m', '12m']).default('12m') }),
  car: z.object({ carNumber, dob: dobSchema }),
};

/** API shape (unchanged contract). A report stuck in processing is shown as failed so the app offers a retry. */
const toPublic = (id: string, r: ReportDoc) => {
  const status = isStale(r) ? 'failed' : r.status;
  return {
    id,
    type: r.type,
    status,
    stage: status === 'failed' ? 'received' : r.stage,
    input: r.input,
    content: status === 'complete' ? (r.content ?? undefined) : undefined,
    saved: r.saved,
    createdAt: r.createdAt,
    error: status === 'failed' ? (r.error ?? 'We could not finish your report. Please try again.') : undefined,
  };
};

const loadOwnReport = async (userId: string, reportId: string) => {
  const report = await reportsRepo.get(userId, reportId);
  if (!report) throw new HttpError(404, 'Report not found.', 'not_found');
  return report;
};

export const reportsRouter = Router();

/** Creates a report. Premium users start generating immediately; others get a locked preview. */
reportsRouter.post(
  '/reports',
  handle(async (req, res) => {
    const uid = uidOf(req);
    const { type, input: rawInput } = parseBody(
      z.object({ type: z.enum(REPORT_TYPES), input: z.record(z.string(), z.unknown()) }),
      req.body,
    );
    const input = parseBody(INPUT_SCHEMAS[type], rawInput);

    if ((await reportsRepo.countSince(uid, Date.now() - 86_400_000)) >= MAX_REPORTS_PER_DAY) {
      throw new HttpError(429, 'You have created many reports today. Please try again tomorrow.', 'rate_limited');
    }

    const user = requireProfile(await loadUser(uid));
    const premium = isPremiumUser(user);
    const report = await reportsRepo.create(uid, {
      type,
      input,
      profileSnapshot: { fullName: user.profile.fullName, dob: user.profile.dob },
      status: premium ? 'processing' : 'locked',
    });
    if (premium) startReport(uid, report.id);
    res.status(201).json({ report: toPublic(report.id, report) });
  }),
);

reportsRouter.get(
  '/reports',
  handle(async (req, res) => {
    const reports = await reportsRepo.list(uidOf(req), 50);
    res.json({ reports: reports.map((r) => toPublic(r.id, r)) });
  }),
);

reportsRouter.get(
  '/reports/:id',
  handle(async (req, res) => {
    const id = String(req.params.id);
    res.json({ report: toPublic(id, await loadOwnReport(uidOf(req), id)) });
  }),
);

/** Starts (or retries) generation. Premium only. */
reportsRouter.post(
  '/reports/:id/generate',
  handle(async (req, res) => {
    const uid = uidOf(req);
    const id = String(req.params.id);
    const existing = await loadOwnReport(uid, id);
    if (existing.status === 'complete') {
      res.json({ report: toPublic(id, existing) });
      return;
    }
    if (!isPremiumUser(await loadUser(uid))) {
      throw new HttpError(402, 'Unlock Ankveda Premium to read this report.', 'premium_required');
    }
    const queued = await reportsRepo.queue(uid, id);
    if (!queued) throw new HttpError(404, 'Report not found.', 'not_found');
    if (queued.status === 'processing' && queued.stage === 'received') startReport(uid, id);
    res.json({ report: toPublic(id, queued) });
  }),
);

reportsRouter.post(
  '/reports/:id/save',
  handle(async (req, res) => {
    const uid = uidOf(req);
    const id = String(req.params.id);
    const { saved } = parseBody(z.object({ saved: z.boolean() }), req.body);
    const report = await loadOwnReport(uid, id);
    await reportsRepo.patch(uid, id, { saved });
    res.json({ report: toPublic(id, { ...report, saved }) });
  }),
);
