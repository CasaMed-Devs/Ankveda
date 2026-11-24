import { Router } from 'express';
import { z } from 'zod';

import { isProfileComplete, ProfileIncompleteError, usersRepo } from '../db/repositories/users';
import { uidOf } from '../lib/auth';
import { handle, HttpError, parseBody } from '../lib/http';
import { dobSchema, nameSchema } from '../lib/validation';
import { getDaily } from '../services/daily';
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
    const patch = parseBody(z.object({ fullName: nameSchema.optional(), dob: dobSchema.optional() }), req.body);
    try {
      const user = await usersRepo.updateProfile(uid, patch);
      res.json({ user: publicUser(uid, user) });
    } catch (error) {
      if (error instanceof ProfileIncompleteError) throw new HttpError(400, error.message, 'validation');
      throw error;
    }
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
    const daily = await getDaily(uid, user.profile);
    res.json({ locked: false, birthNumber: number, birthTitle: ARCHETYPES[number].title, birthMessage: daily.message });
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
