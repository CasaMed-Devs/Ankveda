import { Router } from 'express';
import { z } from 'zod';

import { isProfileComplete, ProfileIncompleteError, usersRepo } from '../db/repositories/users';
import { uidOf } from '../lib/auth';
import { handle, HttpError, parseBody } from '../lib/http';
import { dobSchema, nameSchema } from '../lib/validation';
import { deleteOwnAccount } from '../services/accountDeletion';
import { getDaily, readDaily } from '../services/daily';
import { isPremiumUser, publicUser } from '../services/entitlement';
import { ARCHETYPES } from '../services/numerology';
import type { UserDoc } from '../types';

export const loadUser = async (userId: string) => {
  const user = await usersRepo.get(userId);
  if (!user) throw new HttpError(401, 'Your account was not found. Please sign in again.', 'unauthorized');
  return user;
};

/** Name + date of birth are collected right after login ("About you") and drive every reading. */
export const requireProfile = (user: UserDoc) => {
  if (!isProfileComplete(user)) {
    throw new HttpError(409, 'Please add your name and date of birth first.', 'profile_incomplete');
  }
  return user;
};

export const meRouter = Router();

meRouter.get(
  '/me',
  handle(async (req, res) => {
    const uid = uidOf(req);
    res.json({ user: publicUser(uid, await loadUser(uid)) });
  }),
);

meRouter.put(
  '/me',
  handle(async (req, res) => {
    const uid = uidOf(req);
    const patch = parseBody(
      z.object({
        fullName: nameSchema.optional(),
        dob: dobSchema.optional(),
        birthTime: z.string().regex(/^([01]d|2[0-3]):[0-5]d$/, 'Use HH:MM for the birth time.').optional(),
        birthPlace: z.string().trim().min(2, 'Enter your birth place.').max(80).optional(),
      }),
      req.body,
    );
    try {
      const user = await usersRepo.updateProfile(uid, patch);
      res.json({ user: publicUser(uid, user) });
    } catch (error) {
      if (error instanceof ProfileIncompleteError) throw new HttpError(400, error.message, 'validation');
      throw error;
    }
  }),
);

/**
 * "Delete account": the account disappears from the app (data kept in the database), any running
 * subscription is cancelled, and the same number signs in as a brand-new user afterwards.
 */
meRouter.delete(
  '/me',
  handle(async (req, res) => {
    res.json(await deleteOwnAccount(uidOf(req)));
  }),
);

/** Home birth-number card: the user's birth number + today's personal message. Premium only. */
meRouter.get(
  '/home',
  handle(async (req, res) => {
    const uid = uidOf(req);
    const user = requireProfile(await loadUser(uid));
    if (!isPremiumUser(user)) {
      res.json({ locked: true });
      return;
    }
    const number = user.profile.numbers.birth;
    // Read-only: Home never waits on the astrology / OpenAI calls. /daily generates (the app prefetches it).
    const daily = await readDaily(uid);
    res.json({
      locked: false,
      birthNumber: number,
      birthTitle: ARCHETYPES[number].title,
      birthMessage: daily?.message ?? null,
      dailyPending: !daily,
    });
  }),
);

/** Daily guidance. Premium only. */
meRouter.get(
  '/daily',
  handle(async (req, res) => {
    const uid = uidOf(req);
    const user = requireProfile(await loadUser(uid));
    if (!isPremiumUser(user)) {
      res.json({ locked: true });
      return;
    }
    res.json({ locked: false, daily: await getDaily(uid, user.profile) });
  }),
);
