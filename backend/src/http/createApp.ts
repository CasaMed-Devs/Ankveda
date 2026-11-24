import express, { Router, type NextFunction, type Request, type Response } from 'express';

import { config } from '../config';
import { requireUser } from '../lib/auth';
import { errorHandler } from '../lib/http';
import { adminRouter } from '../routes/admin';
import { authRouter } from '../routes/auth';
import { chatRouter } from '../routes/chat';
import { meRouter } from '../routes/me';
import { plansRouter } from '../routes/plans';
import { reportsRouter } from '../routes/reports';
import { subscriptionsRouter, webhookRouter } from '../routes/subscriptions';

type RawBodyRequest = Request & { rawBody?: Buffer };

/**
 * JSON body parsing that keeps the exact raw bytes for Razorpay webhook signatures.
 *  - Firebase Cloud Functions pre-parses the body and provides req.rawBody → reuse it.
 *  - Vercel (with NODEJS_HELPERS=0) and local Node → parse here and capture rawBody.
 */
const jsonBody = (req: RawBodyRequest, res: Response, next: NextFunction) => {
  if (req.rawBody) return next();
  return express.json({
    limit: '100kb',
    verify: (request, _res, buf) => {
      (request as RawBodyRequest).rawBody = buf;
    },
  })(req, res, next);
};

/** CORS for browser callers (the admin page on Firebase Hosting). The mobile app doesn't need it. */
const cors = (req: Request, res: Response, next: NextFunction) => {
  const origin = req.header('origin');
  if (origin && config.corsOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, OPTIONS');
    res.setHeader('Access-Control-Max-Age', '600');
  }
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  next();
};

export const createApp = () => {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', true);
  app.use(cors);
  app.use(jsonBody);

  const api = Router();
  api.get('/health', (_req, res) => {
    res.json({ ok: true, environment: config.appEnv });
  });
  api.use('/auth', authRouter);
  api.use(webhookRouter);
  api.use(adminRouter);
  api.use(plansRouter);
  api.use(requireUser, meRouter, subscriptionsRouter, reportsRouter, chatRouter);

  // Works with and without an "/api" prefix (Vercel rewrite, Firebase Hosting rewrite, direct function URL).
  app.use('/api', api);
  app.use('/', api);

  app.use((_req, res) => {
    res.status(404).json({ error: 'Not found', code: 'not_found' });
  });
  app.use(errorHandler);
  return app;
};
