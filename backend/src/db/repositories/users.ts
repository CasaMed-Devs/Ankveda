import { birthNumber, lifePath, nameNumber } from '../../services/numerology';
import { SCHEMA_VERSION, type StoredEntitlement, type UserDoc, type UserProfile } from '../../types';
import { db, refs } from '../firestore';

/** Name and date of birth must be saved together the first time. */
export class ProfileIncompleteError extends Error {
  constructor() {
    super('Please enter both your full name and date of birth.');
  }
}

export const profileKeyOf =(profile: Pick<UserProfile, 'fullName' | 'dob'>) => `${profile.fullName}|${profile.dob}`;

const withNumbers = (fullName: string, dob: string): UserProfile => ({
  fullName,
  dob,
  numbers: { birth: birthNumber(dob).value, lifePath: lifePath(dob).value, name: nameNumber(fullName).value },
});

export const usersRepo = {
  get: async (userId: string): Promise<UserDoc | null> => (await refs.user(userId).get()).data() ?? null,

  /** Creates the user on first login (phone is the natural key), otherwise stamps lastLoginAt. */
  upsertOnLogin: (userId: string, phone: string) =>
    db.runTransaction(async (tx) => {
      const ref = refs.user(userId);
      const existing = (await tx.get(ref)).data();
      const now = Date.now();
      if (existing) {
        const next: UserDoc = { ...existing, lastLoginAt: now, updatedAt: now };
        tx.set(ref, next);
        return next;
      }
      const created: UserDoc = {
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
      tx.create(ref, created);
      return created;
    }),

  /** Name / date of birth. Derived numbers are recomputed on every change. */
  updateProfile: (userId: string, patch: { fullName?: string; dob?: string }) =>
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
        profile: withNumbers(fullName, dob),
        profileCompletedAt: user.profileCompletedAt ?? now,
        updatedAt: now,
      };
      tx.set(ref, next);
      return next;
    }),

  setChatSession: (userId: string, astroSessionId: string, profileKey: string) =>
    refs.user(userId).set({ chat: { astroSessionId, profileKey }, updatedAt: Date.now() } as Partial<UserDoc>, { merge: true }),

  /** Only called from billing.syncSubscription (single writer of the entitlement cache). */
  entitlementWrite: (entitlement: StoredEntitlement) => ({ entitlement, updatedAt: Date.now() }) as Partial<UserDoc>,

  list: async (limit: number) => {
    const snap = await refs.users().orderBy('createdAt', 'desc').limit(limit).get();
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  },
};

/** A complete profile is required before any reading (collected on the "About you" screen). */
export const isProfileComplete = (user: UserDoc): user is UserDoc & { profile: UserProfile } =>
  !!user.profile?.fullName && !!user.profile?.dob;
