import { useState } from 'react';

import { appAlert } from '@/components/AppAlert';
import { toast } from '@/components/Toast';
import { analytics } from '@/lib/analytics';
import { api, ApiError } from '@/lib/api';
import { applyUser } from '@/lib/queries';
import type { CheckoutState, Plan, User } from '@/lib/types';
import { colors } from '@/theme/tokens';

type RazorpayModule = typeof import('react-native-razorpay').default;

// Loaded lazily: the native module is only present in a development/production build, not Expo Go.
const loadRazorpay = (): RazorpayModule | null => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- must stay lazy (native module may be absent)
    return (require('react-native-razorpay') as { default: RazorpayModule }).default;
  } catch {
    return null;
  }
};

// Razorpay Android: 0 = PAYMENT_CANCELED. Other codes (2 network, 3 invalid options…) are real errors.
const USER_CANCELLED_CODES = new Set([0]);

/** Delays between status polls (ms): ~60 s in total. The Razorpay webhook completes the purchase after that. */
const POLL_DELAYS_MS = [2000, 2000, 3000, 3000, 5000, 5000, 5000, 5000, 10000, 10000, 10000];
/** After a "cancelled" checkout only a quick check: UPI apps sometimes report cancel after paying. */
const CANCEL_CHECK_DELAYS_MS = [1500];

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Polls the backend (which fetches the checkout live from Razorpay) until it is confirmed or failed.
 * Network errors while polling are ignored: the next attempt, or the webhook, catches up.
 */
const pollCheckout = async (subscriptionId: string, paymentId: string | null, delays: number[]) => {
  let last: { state: CheckoutState; user: User } | null = null;
  for (const delay of delays) {
    await wait(delay);
    try {
      last = await api.subscriptionStatus(subscriptionId, paymentId);
      applyUser(last.user);
      if (last.state !== 'pending') return last;
    } catch {
      // keep polling
    }
  }
  return last;
};

/**
 * Starts a Razorpay auto-renewing subscription for the given plan.
 * Confirmation is polling-first: right after checkout the app asks the backend (verify, then status
 * polls); the Razorpay webhook is the fallback when the app stops polling or is closed.
 * Resolves to true when premium is active.
 */
export const useSubscribe = () => {
  const [busy, setBusy] = useState(false);

  const finish = (user: User | null | undefined, state: CheckoutState | null, purchase?: { plan: Plan; subscriptionId: string }) => {
    if (user) applyUser(user);
    if (user?.entitlement.active && state === 'confirmed') {
      // Meta Purchase: what was charged today (the trial amount, else the first charge).
      if (purchase) {
        const paise = purchase.plan.trialDays > 0 ? purchase.plan.trialPriceInPaise : purchase.plan.priceInPaise;
        analytics.logPurchase({ amount: paise / 100, planId: purchase.plan.id, subscriptionId: purchase.subscriptionId });
      }
      toast.success('Welcome to Ankveda Premium!');
      return true;
    }
    if (state === 'failed') {
      appAlert({ title: 'Payment not completed', message: 'Your payment did not go through. Please try again.' });
      return false;
    }
    if (state === 'pending') {
      appAlert({
        title: 'Confirming your payment',
        message: 'Your payment is being confirmed with the bank. Premium unlocks automatically within a few minutes — you can also tap Restore purchases.',
      });
    }
    return !!user?.entitlement.active;
  };

  const subscribe = async (plan: Plan): Promise<boolean> => {
    const Razorpay = loadRazorpay();
    if (!Razorpay) {
      appAlert({ title: 'Payments unavailable', message: 'Razorpay needs the Ankveda development build. It does not run inside Expo Go.' });
      return false;
    }

    setBusy(true);
    let subscriptionId: string | null = null;
    try {
      const session = await api.createSubscription(plan.id);
      subscriptionId = session.subscriptionId;
      analytics.logInitiatedCheckout({
        planId: plan.id,
        amount: (plan.trialDays > 0 ? plan.trialPriceInPaise : plan.priceInPaise) / 100,
      });
      const result = await Razorpay.open({
        key: session.keyId,
        subscription_id: session.subscriptionId,
        recurring: true,
        name: 'Ankveda',
        description: session.description,
        prefill: { contact: session.phone },
        theme: { color: colors.card },
      });
      const paymentId = result.razorpay_payment_id;
      const verifiedId = result.razorpay_subscription_id ?? session.subscriptionId;
      let outcome: { state: CheckoutState; user: User } | null = null;
      try {
        outcome = await api.verifySubscription({ paymentId, subscriptionId: verifiedId, signature: result.razorpay_signature });
        applyUser(outcome.user);
      } catch (error) {
        // A bad signature is final; anything else (network) → fall through to polling.
        if (error instanceof ApiError && error.status === 400) throw error;
      }
      if (!outcome || outcome.state === 'pending') {
        outcome = (await pollCheckout(verifiedId, paymentId, POLL_DELAYS_MS)) ?? outcome;
      }
      return finish(outcome?.user, outcome?.state ?? 'pending', { plan, subscriptionId: verifiedId });
    } catch (error) {
      if (error instanceof ApiError) {
        appAlert({ title: 'Subscription', message: error.message });
        return false;
      }
      const failure = error as { code?: number; description?: string };
      const cancelled = USER_CANCELLED_CODES.has(failure.code ?? -1);
      // Checkout reported an error or cancel, but the money may still have moved: ask before giving up.
      if (subscriptionId) {
        const outcome = await pollCheckout(subscriptionId, null, cancelled ? CANCEL_CHECK_DELAYS_MS : POLL_DELAYS_MS);
        if (outcome?.state === 'confirmed') return finish(outcome.user, 'confirmed', { plan, subscriptionId });
      }
      if (!cancelled) {
        appAlert({ title: 'Payment not completed', message: failure.description ?? 'Your payment did not go through. Please try again.' });
      }
      return false;
    } finally {
      setBusy(false);
    }
  };

  return { subscribe, busy };
};
