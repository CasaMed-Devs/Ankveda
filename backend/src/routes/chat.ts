import { Router } from 'express';
import { z } from 'zod';

import { usersRepo } from '../db/repositories/users';
import { uidOf } from '../lib/auth';
import { handle, HttpError, parseBody } from '../lib/http';
import { dobSchema } from '../lib/validation';
import {
  chatContextFor,
  findAstrologer,
  listAstrologers,
  missingInputs,
  toChatMessage,
  toSummary,
} from '../services/astrologerChat';
import { isPremiumUser } from '../services/entitlement';
import { personaApi, sessionIdFor } from '../services/personaApi';
import { loadUser, requireProfile } from './me';

/**
 * Chat with astrologers (Persona API). Persona API stores the history; we never copy it.
 * Everyone can browse astrologers and read greetings; reading history and sending are Premium only.
 */
export const chatRouter = Router();

// Chat history changes with every message: never let the phone's HTTP cache or a proxy reuse a response.
chatRouter.use(['/astrologers', '/chat'], (_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

chatRouter.get(
  '/astrologers',
  handle(async (_req, res) => {
    res.json({ astrologers: await listAstrologers() });
  }),
);

/** The user's chats, most recent first (for "Continue" on the list). */
chatRouter.get(
  '/chat/conversations',
  handle(async (req, res) => {
    const uid = uidOf(req);
    if (!isPremiumUser(await loadUser(uid))) {
      res.json({ conversations: [] });
      return;
    }
    const conversations = await personaApi.listConversations(uid);
    res.json({ conversations: conversations.filter((c) => c.message_count > 0).map(toSummary) });
  }),
);

chatRouter.get(
  '/chat/:astrologerId/messages',
  handle(async (req, res) => {
    const uid = uidOf(req);
    const astrologerId = String(req.params.astrologerId);
    const before = req.query.before !== undefined ? Number(req.query.before) : undefined;
    const user = requireProfile(await loadUser(uid));
    const astrologer = await findAstrologer(astrologerId);
    if (!isPremiumUser(user)) {
      res.json({ locked: true, missing: [], messages: [], nextCursor: null, hasMore: false });
      return;
    }
    const page = await personaApi.messages(sessionIdFor(uid, astrologerId), {
      limit: 50,
      before: Number.isFinite(before) ? before : undefined,
    });
    res.json({
      locked: false,
      missing: missingInputs(astrologer, chatContextFor(user, astrologerId)),
      messages: page.messages.map(toChatMessage),
      nextCursor: page.next_cursor,
      hasMore: page.has_more,
    });
  }),
);

/**
 * Saves details an astrologer asked for. Birth time / place go on the profile (reused by every
 * astrologer); the rest (partner's details, …) is kept for this astrologer only.
 */
chatRouter.put(
  '/chat/:astrologerId/context',
  handle(async (req, res) => {
    const uid = uidOf(req);
    const astrologerId = String(req.params.astrologerId);
    const { values } = parseBody(z.object({ values: z.record(z.string(), z.string().trim().max(120)) }), req.body);
    const astrologer = await findAstrologer(astrologerId);
    const allowed = new Map(astrologer.requiredInputs.map((input) => [input.key, input]));

    const extras: Record<string, string> = {};
    const profilePatch: { birthTime?: string; birthPlace?: string } = {};
    for (const [key, raw] of Object.entries(values)) {
      const input = allowed.get(key);
      const value = raw.trim();
      if (!input || !value || key === 'name' || key === 'dob') continue;
      if (key.endsWith('tob') && !TIME.test(value)) throw new HttpError(400, `${input.label}: use HH:MM, e.g. 14:35.`, 'validation');
      if (key.endsWith('dob') && !dobSchema.safeParse(value).success) {
        throw new HttpError(400, `${input.label}: use YYYY-MM-DD, e.g. 1993-11-02.`, 'validation');
      }
      if (key === 'tob') profilePatch.birthTime = value;
      else if (key === 'pob') profilePatch.birthPlace = value;
      else extras[key] = value;
    }

    if (profilePatch.birthTime || profilePatch.birthPlace) await usersRepo.updateProfile(uid, profilePatch);
    if (Object.keys(extras).length) await usersRepo.saveChatContext(uid, astrologerId, extras);

    const user = requireProfile(await loadUser(uid));
    res.json({ missing: missingInputs(astrologer, chatContextFor(user, astrologerId)) });
  }),
);

/** Premium only, no daily limit (product decision). Replies take 3–8 s. */
chatRouter.post(
  '/chat/:astrologerId',
  handle(async (req, res) => {
    const uid = uidOf(req);
    const astrologerId = String(req.params.astrologerId);
    const { text } = parseBody(z.object({ text: z.string().trim().min(1, 'Type a question.').max(1000) }), req.body);
    const user = requireProfile(await loadUser(uid));
    if (!isPremiumUser(user)) throw new HttpError(402, 'Chat is part of Ankveda Premium.', 'premium_required');

    const astrologer = await findAstrologer(astrologerId);
    const context = chatContextFor(user, astrologerId);
    if (missingInputs(astrologer, context).length) {
      throw new HttpError(400, 'Please add your birth details first.', 'missing_context');
    }

    const result = await personaApi.chat({
      sessionId: sessionIdFor(uid, astrologerId),
      profileId: astrologerId,
      userId: uid,
      message: text,
      context,
    });
    res.json({
      messages: [toChatMessage(result.message), toChatMessage({ ...result.reply, role: 'assistant' })],
    });
  }),
);
