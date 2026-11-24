import { Router } from 'express';
import { z } from 'zod';

import { chatRepo } from '../db/repositories/content';
import { uidOf } from '../lib/auth';
import { handle, HttpError, parseBody } from '../lib/http';
import { astrologerReply } from '../services/chatProvider';
import { isPremiumUser } from '../services/entitlement';
import { loadUser, requireProfile } from './me';

export const chatRouter = Router();

chatRouter.get(
  '/chat/history',
  handle(async (req, res) => {
    const uid = uidOf(req);
    if (!isPremiumUser(await loadUser(uid))) {
      res.json({ locked: true, messages: [] });
      return;
    }
    res.json({ locked: false, messages: await chatRepo.recent(uid, 100) });
  }),
);

/** Premium only, no daily limit (product decision). */
chatRouter.post(
  '/chat',
  handle(async (req, res) => {
    const uid = uidOf(req);
    const { text } = parseBody(z.object({ text: z.string().trim().min(1, 'Type a question.').max(500) }), req.body);
    const user = requireProfile(await loadUser(uid));
    if (!isPremiumUser(user)) throw new HttpError(402, 'Chat is part of Ankveda Premium.', 'premium_required');

    const history = await chatRepo.recent(uid, 20);
    const reply = await astrologerReply(uid, user, history, text);
    res.json({ messages: await chatRepo.appendExchange(uid, text, reply.text, reply.provider) });
  }),
);
