import { Timestamp, type Query } from 'firebase-admin/firestore';

import { refs } from '../db/firestore';
import { DAY_MS } from '../db/schema';
import { logger } from '../lib/logger';
import { META_EVENT_NAMES, type MetaEventDoc, type MetaEventName } from '../types';
import { runPage } from './admin/paging';
import { buildMetaEventDoc, metaEventDocId, metaEventRow, type MetaEventInput } from './metaEventRules';

/**
 * Stores one event the app logged to Meta and writes a log line. Purchase is keyed by subscription id, so
 * a retried report is ignored. Never throws for a duplicate.
 */
export const recordMetaEvent = async (userId: string, input: MetaEventInput) => {
  const doc = buildMetaEventDoc(userId, input);
  const subscriptionId = input.params?.subscriptionId;
  const docId = metaEventDocId(input);
  const ref = docId ? refs.metaEvents().doc(docId) : refs.metaEvents().doc();
  try {
    await ref.create(doc);
  } catch (error) {
    if ((error as { code?: number }).code === 6) {
      logger.info('meta_event_duplicate', { event: input.event, userId, subscriptionId });
      return { duplicate: true };
    }
    throw error;
  }
  logger.info('meta_event', { event: input.event, userId, ...doc.params, platform: doc.platform, appVersion: doc.appVersion });
  return { duplicate: false };
};

export const listMetaEvents = async (query: { pageSize: number; cursor?: string | null; event?: MetaEventName; userId?: string }) => {
  let base: Query<MetaEventDoc> = refs.metaEvents();
  if (query.event) base = base.where('event', '==', query.event);
  if (query.userId) base = base.where('userId', '==', query.userId);
  const page = await runPage(base, { field: 'createdAt', direction: 'desc', instant: true, pageSize: query.pageSize, cursor: query.cursor });
  return { items: page.items.map((e) => metaEventRow(e.id, e)), nextCursor: page.nextCursor };
};

/** Count of each event over the last 24 hours, 7 days and 30 days (count() aggregations, not scans). */
export const metaEventSummary = async () => {
  const now = Date.now();
  const windows = { last24h: 1, last7d: 7, last30d: 30 } as const;
  const rows = await Promise.all(
    META_EVENT_NAMES.map(async (event) => {
      const counts = await Promise.all(
        Object.values(windows).map(async (days) => {
          const q = refs.metaEvents().where('event', '==', event).where('createdAt', '>=', Timestamp.fromMillis(now - days * DAY_MS));
          return (await q.count().get()).data().count;
        }),
      );
      return { event, last24h: counts[0]!, last7d: counts[1]!, last30d: counts[2]! };
    }),
  );
  return { events: rows, note: 'App Install and Activate App are sent by the Meta SDK directly and are only visible in Meta Events Manager.' };
};
