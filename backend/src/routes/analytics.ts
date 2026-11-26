import { Router } from 'express';

import { uidOf } from '../lib/auth';
import { handle, parseBody } from '../lib/http';
import { metaEventBodySchema } from '../services/metaEventRules';
import { recordMetaEvent } from '../services/metaEvents';

export const analyticsRouter = Router();

/** The app reports each Meta event it logs, so events can be checked in the admin dashboard and server logs. */
analyticsRouter.post(
  '/analytics/events',
  handle(async (req, res) => {
    const body = parseBody(metaEventBodySchema, req.body);
    const result = await recordMetaEvent(uidOf(req), body);
    res.json({ ok: true, ...result });
  }),
);
