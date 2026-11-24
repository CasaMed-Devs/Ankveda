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
  entitlement: computeEntitlement(user.entitlement),
});

type RazorpaySubscriptionLike = {
  id: string;
  status: string;
  current_start?: number | null;
  current_end?: number | null;
  start_at?: number | null;
  charge_at?: number | null;
  ended_at?: number | null;
};

const sec = (value: number | null | undefined) => (value ? value * 1000 : null);

/** Fields of subscriptions/{id} derived from a Razorpay subscription entity. */
export const subscriptionStateFromRazorpay = (sub: RazorpaySubscriptionLike) => {
  const status = (sub.status as SubscriptionStatus) ?? 'created';
  // During a trial the subscription is "authenticated" and the first charge happens at start_at.
  const periodEnd = sec(sub.current_end) ?? (status === 'authenticated' ? sec(sub.start_at ?? sub.charge_at) : null) ?? sec(sub.ended_at);
  return {
    status,
    startAt: sec(sub.start_at),
    currentPeriodStart: sec(sub.current_start),
    currentPeriodEnd: periodEnd,
    endedAt: sec(sub.ended_at),
  };
};
