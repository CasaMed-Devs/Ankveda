import { useState } from 'react';

import { appAlert } from '@/components/AppAlert';
import { toast } from '@/components/Toast';
import { api, ApiError } from '@/lib/api';
import { applyUser } from '@/lib/queries';
import type { Plan } from '@/lib/types';
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

/**
 * Starts a Razorpay auto-renewing subscription for the given plan.
 * Resolves to true when the subscription is verified and premium is active.
 */
export const useSubscribe = () => {
  const [busy, setBusy] = useState(false);

  const subscribe = async (plan: Plan): Promise<boolean> => {
    const Razorpay = loadRazorpay();
    if (!Razorpay) {
      appAlert({ title: 'Payments unavailable', message: 'Razorpay needs the Ankveda development build. It does not run inside Expo Go.' });
      return false;
    }

    setBusy(true);
    try {
      const session = await api.createSubscription(plan.id);
      const result = await Razorpay.open({
        key: session.keyId,
        subscription_id: session.subscriptionId,
        recurring: true,
        name: 'Ankveda',
        description: session.description,
        prefill: { contact: session.phone },
        theme: { color: colors.card },
      });
      const { user } = await api.verifySubscription({
        paymentId: result.razorpay_payment_id,
        subscriptionId: result.razorpay_subscription_id ?? session.subscriptionId,
        signature: result.razorpay_signature,
      });
      applyUser(user);
      if (user.entitlement.active) toast.success('Welcome to Ankveda Premium!');
      return user.entitlement.active;
    } catch (error) {
      if (error instanceof ApiError) {
        appAlert({ title: 'Subscription', message: error.message });
      } else {
        const failure = error as { code?: number; description?: string };
        if (!USER_CANCELLED_CODES.has(failure.code ?? -1)) {
          appAlert({ title: 'Payment not completed', message: failure.description ?? 'Your payment did not go through. Please try again.' });
        }
      }
      return false;
    } finally {
      setBusy(false);
    }
  };

  return { subscribe, busy };
};
