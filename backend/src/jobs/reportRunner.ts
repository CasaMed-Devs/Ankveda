import { waitUntil } from '@vercel/functions';

import { config } from '../config';
import { reportsRepo } from '../db/repositories/reports';
import { logger } from '../lib/logger';
import { generateReportContent } from '../services/reportGenerator';

/**
 * Generates one report. Safe to call from several places at once (Vercel inline runner,
 * Firebase trigger, retries): only the caller that wins the claim lock does the work.
 */
export const processReport = async (userId: string, reportId: string) => {
  const report = await reportsRepo.claim(userId, reportId);
  if (!report) return;

  try {
    const { content, generator } = await generateReportContent(report, async (stage) => {
      await reportsRepo.patch(userId, reportId, { stage });
    });
    const now = Date.now();
    await reportsRepo.patch(userId, reportId, {
      status: 'complete',
      stage: 'done',
      content,
      generator,
      error: null,
      lockedUntil: null,
      completedAt: now,
    });
  } catch (error) {
    logger.error('Report generation failed', { userId, reportId, error });
    await reportsRepo.patch(userId, reportId, {
      status: 'failed',
      stage: 'received',
      error: 'We could not finish your report. Please try again.',
      lockedUntil: null,
    });
  }
};

/**
 * Starts generation after a report enters "processing".
 *  - inline (Vercel): runs in the background after the response via waitUntil.
 *  - trigger (Firebase): nothing to do here — the Firestore trigger in src/firebase.ts picks it up.
 */
export const startReport = (userId: string, reportId: string) => {
  if (config.reportRunner !== 'inline') return;
  waitUntil(processReport(userId, reportId));
};
