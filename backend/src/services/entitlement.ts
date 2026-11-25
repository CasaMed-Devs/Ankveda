import type { Entitlement, StoredEntitlement, SubscriptionStatus, UserDoc } from '../types';

// Statuses that grant access while the paid period lasts.
const ACCESS_STATUSES: SubscriptionStatus[] = ['authenticated', 'active', 'pending'];
// A payment retry ("pending") keeps access for a short grace window.
const GRACE_MS = 3 * 86_400_000;

export const computeEntitlement = (stored: StoredEntitlement | null | undefined, now = Date.now()): Entitlement => {
  if (!stored) return { active: false, status: 'none' };
  const end = stored.currentPeriodEnd ?? 0;
  const withinPeriod = end + (stored.status === 'pending' ? GRACE_MS : 0) > now;
  const active =
    (ACCESS_STATUSES.includes(stored.status) && (withinPeriod || !stored.currentPeriodEnd)) ||
    // Cancelled at cycle end: keep access until the period is over.
    (stored.status === 'cancelled' && withinPeriod);
  return {
    active,
    status: stored.status,
    planId: stored.planId ?? undefined,
    planName: stored.planName ?? undefined,
    subscriptionId: stored.subscriptionId ?? undefined,
    currentPeriodEnd: stored.currentPeriodEnd ?? undefined,
    cancelAtPeriodEnd: stored.cancelAtPeriodEnd,
  };
};

export const isPremiumUser = (user: UserDoc) => computeEntitlement(user.entitlement).active;

/** Shape returned to the app (unchanged API contract). */
export const publicUser = (userId: string, user: UserDoc) => ({
  id: userId,
  phone: user.phone,
  fullName: user.profile?.fullName || undefined,
  dob: user.profile?.dob || undefined,
  birthTime: user.profile?.birthTime || undefined,
  birthPlace: user.profile?.birthPlace || undefined,
  entitlement: computeEntitlement(user.entitlement),
  /** False once this account has used the trial — the paywall then shows the plan without it. */
  trialEligible: !user.trialUsedAt,
});
