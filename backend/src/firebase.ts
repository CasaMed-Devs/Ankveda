/**
 * Firebase Cloud Functions entry (production).
 * Region must match the Firestore location (asia-south2 / Delhi) for the trigger.
 */
import { onDocumentWritten } from 'firebase-functions/firestore';
import { onRequest } from 'firebase-functions/https';
import { setGlobalOptions } from 'firebase-functions/options';
import { defineSecret } from 'firebase-functions/params';

import { createApp } from './http/createApp';
import { processReport } from './jobs/reportRunner';
import type { ReportDoc } from './types';

setGlobalOptions({ region: 'asia-south2', maxInstances: 20 });

// Set with `firebase functions:secrets:set NAME` (or backend/.secret.local for the emulator).
const secrets = {
  jwt: defineSecret('JWT_SECRET'),
  adminPassword: defineSecret('ADMIN_PASSWORD'),
  openaiKey: defineSecret('OPENAI_API_KEY'),
  astrologyKey: defineSecret('ASTROLOGY_API_KEY'),
  voicensmsKey: defineSecret('VOICENSMS_API_KEY'),
  razorpayKeyId: defineSecret('RAZORPAY_KEY_ID'),
  razorpayKeySecret: defineSecret('RAZORPAY_KEY_SECRET'),
  razorpayWebhookSecret: defineSecret('RAZORPAY_WEBHOOK_SECRET'),
};

const app = createApp();

/** REST API used by the mobile app and the admin page. */
export const api = onRequest({ secrets: Object.values(secrets), timeoutSeconds: 60, memory: '512MiB' }, app);

/**
 * Generates a report when it enters "processing" (created by a premium user, unlocked or retried).
 * processReport() claims a lock, so a report is never generated twice even if the Vercel staging
 * runner sees it too (shared database).
 */
export const generateReport = onDocumentWritten(
  {
    document: 'users/{userId}/reports/{reportId}',
    secrets: [secrets.openaiKey, secrets.astrologyKey],
    timeoutSeconds: 300,
    memory: '512MiB',
    retry: false,
  },
  async (event) => {
    const after = event.data?.after.data() as Partial<ReportDoc> | undefined;
    if (!after || after.status !== 'processing' || after.stage !== 'received') return;
    await processReport(event.params.userId, event.params.reportId);
  },
);
