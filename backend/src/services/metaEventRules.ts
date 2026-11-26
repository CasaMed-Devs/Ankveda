import { z } from 'zod';

import { SCHEMA_VERSION, META_EVENT_NAMES, type MetaEventDoc, type MetaEventName } from '../types';

export const META_EVENT_RETENTION_DAYS = 90;
const DAY_MS = 86_400_000;

const short = z.string().trim().max(80);

/** What the app may send. Strict: unknown parameters are rejected, so nothing personal can slip in. */
export const metaEventBodySchema = z.object({
  event: z.enum(META_EVENT_NAMES),
  params: z
    .object({
      value: z.number().finite().min(0).max(1_000_000).optional(),
      currency: z.string().trim().length(3).optional(),
      planId: short.optional(),
      subscriptionId: short.optional(),
      contentType: short.optional(),
      method: short.optional(),
    })
    .strict()
    .optional(),
  platform: short.optional(),
  appVersion: short.optional(),
  clientTime: z.number().int().positive().optional(),
});

export type MetaEventInput = z.infer<typeof metaEventBodySchema>;

/** Purchase is keyed by subscription id, so the same purchase reported twice is stored once. */
export const metaEventDocId = (input: Pick<MetaEventInput, 'event' | 'params'>): string | null =>
  input.event === 'Purchase' && input.params?.subscriptionId ? `Purchase_${input.params.subscriptionId}` : null;

export const buildMetaEventDoc = (userId: string, input: MetaEventInput, now = Date.now()): MetaEventDoc => ({
  event: input.event,
  userId,
  params: input.params ?? {},
  platform: input.platform ?? null,
  appVersion: input.appVersion ?? null,
  clientTime: input.clientTime ?? null,
  schemaVersion: SCHEMA_VERSION,
  createdAt: now,
  expireAt: now + META_EVENT_RETENTION_DAYS * DAY_MS,
});

export const metaEventRow = (id: string, e: MetaEventDoc) => ({
  id,
  event: e.event as MetaEventName,
  userId: e.userId,
  value: e.params.value ?? null,
  currency: e.params.currency ?? null,
  planId: e.params.planId ?? null,
  subscriptionId: e.params.subscriptionId ?? null,
  params: e.params,
  platform: e.platform,
  appVersion: e.appVersion,
  createdAt: e.createdAt,
});
