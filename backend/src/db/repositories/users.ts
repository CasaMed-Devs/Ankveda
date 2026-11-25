import { birthNumber, lifePath, nameNumber } from '../../services/numerology';
import { SCHEMA_VERSION, type StoredEntitlement, type UserDoc, type UserProfile } from '../../types';
import { randomBytes } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';

import { uidForPhone } from '../../lib/auth';
import { db, refs } from '../firestore';

/** Name and date of birth must be saved together the first time. */
export class ProfileIncompleteError extends Error {
  constructor() {
    super('Please enter both your full name and date of birth.');
  }
}

export const profileKeyOf =(profile: Pick<UserProfile, 'fullName' | 'dob'>) => `${profile.fullName}|${profile.dob}`;

const withNumbers = (fullName: string, dob: string, birth: Pick<UserProfile, 'birthTime' | 'birthPlace'> = {}): UserProfile => ({
  fullName,
  dob,
  numbers: { birth: birthNumber(dob).value, lifePath: lifePath(dob).value, name: nameNumber(fullName).value },
  birthTime: birth.birthTime ?? null,
  birthPlace: birth.birthPlace ?? null,
});

/** Normalised name for admin prefix search ("Aarav  Sharma" → "aarav sharma"). */
export const searchName = (fullName: string) => fullName.trim().replace(/\s+/g, ' ').toLowerCase();

/** New accounts get a random id (no longer derived from the phone, so a number can have successive accounts). */
export const newUserId = () => `u_${randomBytes(12).toString('hex')}`;

export type LoginChoice = { kind: 'mapped' | 'legacy'; userId: string } | { kind: 'new' };

/** Pure decision for resolveOnLogin (unit-tested). */
export const chooseLoginAccount = (s: { mappedUserId: string | null; mappedExists: boolean; legacyId: string; legacyExists: boolean }): LoginChoice => {
  if (s.mappedUserId && s.mappedExists) return { kind: 'mapped', userId: s.mappedUserId };
  // A mapping may only point at a legacy-id account; never resurrect a deleted one (its doc is gone).
  if (s.legacyExists && (!s.mappedUserId || s.mappedUserId === s.legacyId)) return { kind: 'legacy', userId: s.legacyId };
  return { kind: 'new' };
};

export const usersRepo = {
  get: async (userId: string): Promise<UserDoc | null> => (await refs.user(userId).get()).data() ?? null,

  /**
   * Resolves (or creates) the account for a phone number at login — one transaction:
   *   1. phoneAccounts/{phone} → that account;
   *   2. else a legacy account keyed by the phone hash (accounts made before phoneAccounts existed) → adopt it;
   *   3. else a brand-new account with a random id.
   * A number whose account was deleted therefore always starts fresh (new id, no history, no subscription).
   * The phoneAccounts doc is read inside the transaction, so two concurrent first logins can't both create one.
   */
  resolveOnLogin: (phone: string) =>
    db.runTransaction(async (tx) => {
      const mappingRef = refs.phoneAccounts().doc(phone);
      const legacyId = uidForPhone(phone);
      const mapping = (await tx.get(mappingRef)).data();
      const [mapped, legacy] = await Promise.all([
        mapping ? tx.get(refs.user(mapping.userId)).then((s) => s.data()) : Promise.resolve(undefined),
        tx.get(refs.user(legacyId)).then((s) => s.data()),
      ]);
      const choice = chooseLoginAccount({ mappedUserId: mapping?.userId ?? null, mappedExists: !!mapped, legacyId, legacyExists: !!legacy });
      const now = Date.now();
      const userId = choice.kind === 'new' ? newUserId() : choice.userId;
      const existing = choice.kind === 'mapped' ? mapped : choice.kind === 'legacy' ? legacy : undefined;

      let user: UserDoc;
      if (existing) {
        user = { ...existing, lastLoginAt: now, updatedAt: now };
        tx.set(refs.user(userId), user);
      } else {
        user = {
          schemaVersion: SCHEMA_VERSION,
          phone,
          countryCode: '+91',
          profile: null,
          profileCompletedAt: null,
          entitlement: null,
          chat: null,
          lastLoginAt: now,
          createdAt: now,
          updatedAt: now,
        };
        tx.create(refs.user(userId), user);
      }
      if (choice.kind !== 'mapped') {
        tx.set(mappingRef, { userId, createdAt: mapping?.createdAt ?? now, updatedAt: now });
      }
      return { userId, user, created: !existing };
    }),

  /** Name / date of birth (+ birth time / place). Derived numbers are recomputed on every change. */
  updateProfile: (userId: string, patch: { fullName?: string; dob?: string; birthTime?: string; birthPlace?: string }) =>
    db.runTransaction(async (tx) => {
      const ref = refs.user(userId);
      const user = (await tx.get(ref)).data();
      if (!user) throw new Error(`User ${userId} not found`);
      const fullName = patch.fullName ?? user.profile?.fullName;
      const dob = patch.dob ?? user.profile?.dob;
      if (!fullName || !dob) throw new ProfileIncompleteError();
      const now = Date.now();
      const next: UserDoc = {
        ...user,
        profile: withNumbers(fullName, dob, {
          birthTime: patch.birthTime ?? user.profile?.birthTime,
          birthPlace: patch.birthPlace ?? user.profile?.birthPlace,
        }),
        nameLower: searchName(fullName),
        profileCompletedAt: user.profileCompletedAt ?? now,
        updatedAt: now,
      };
      tx.set(ref, next);
      return next;
    }),

  /** Saves extra details one astrologer asked for (merged with what was saved before). */
  saveChatContext: (userId: string, profileId: string, values: Record<string, string>) =>
    refs.user(userId).set({ chatContext: { [profileId]: values }, updatedAt: Date.now() } as Partial<UserDoc>, { merge: true }),

  /** Only called from billing.syncSubscription (single writer of the entitlement cache). */
  entitlementWrite: (entitlement: StoredEntitlement) => ({ entitlement, updatedAt: Date.now() }) as Partial<UserDoc>,

  /**
   * Links a newly created subscription to the user (checkout opened, or admin grant) — written in the
   * same transaction that creates subscriptions/{id}, so it is set even if the checkout is never paid.
   * Use with set(…, { merge: true }).
   */
  subscriptionLinkWrite: (subscriptionId: string) =>
    ({
      latestSubscriptionId: subscriptionId,
      subscriptionIds: FieldValue.arrayUnion(subscriptionId),
      updatedAt: Date.now(),
    }) as unknown as Partial<UserDoc>,

  list: async (limit: number) => {
    const snap = await refs.users().orderBy('createdAt', 'desc').limit(limit).get();
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  },
};

/** A complete profile is required before any reading (collected on the "About you" screen). */
export const isProfileComplete = (user: UserDoc): user is UserDoc & { profile: UserProfile } =>
  !!user.profile?.fullName && !!user.profile?.dob;
