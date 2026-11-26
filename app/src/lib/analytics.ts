/**
 * Meta (Facebook) App Events — client-side only, like Hastrekha and Vireel. The SDK is the single source
 * of Meta events (no server-side Conversions API), so a payment is never counted twice.
 *
 *  - App Install / Activate App are automatic (autoLogAppEventsEnabled in the app.json plugin).
 *  - Everything here is best-effort: analytics must never break the app.
 *  - `react-native-fbsdk-next` is a native module (absent in Expo Go), so it is required lazily.
 *  - Never pass phone numbers, names or birth details to Meta.
 */
import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { api } from '@/lib/api';

type EventParams = Record<string, string | number>;

/** What we copy to our own server (see backend/src/routes/analytics.ts). */
type ServerEvent = 'CompleteRegistration' | 'Login' | 'ViewContent' | 'InitiatedCheckout' | 'Purchase';
type ServerParams = { value?: number; currency?: string; planId?: string; subscriptionId?: string; contentType?: string; method?: string };

/** Copy of every Meta event to our backend (admin dashboard + logs). Best-effort: a failure never reaches the user. */
const report = (event: ServerEvent, params?: ServerParams) => {
  if (__DEV__) console.log(`[Meta event] ${event}`, params ?? {});
  void api
    .trackEvent({ event, params, platform: Platform.OS, appVersion: Constants.expoConfig?.version, clientTime: Date.now() })
    .catch(() => undefined);
};

type Sdk = typeof import('react-native-fbsdk-next');

const sdk = (): Sdk | null => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- must stay lazy (native module may be absent)
    return require('react-native-fbsdk-next') as Sdk;
  } catch {
    return null;
  }
};

const safe = (name: string, fn: (s: Sdk) => void) => {
  try {
    const s = sdk();
    if (!s) return;
    fn(s);
  } catch (error) {
    if (__DEV__) console.warn(`[Meta event] ${name} failed`, error);
  }
};

export const analytics = {
  init() {
    safe('init', (s) => s.Settings.initializeSDK());
  },

  /** New account: OTP verified before the profile ("About you") is filled in. */
  logCompleteRegistration() {
    safe('CompleteRegistration', ({ AppEventsLogger: l }) =>
      l.logEvent(l.AppEvents.CompletedRegistration, { [l.AppEventParams.RegistrationMethod]: 'phone_otp' }),
    );
    report('CompleteRegistration', { method: 'phone_otp' });
  },

  /** Returning user signed in. */
  logLogin() {
    safe('Login', ({ AppEventsLogger: l }) => l.logEvent('fb_mobile_login', { method: 'phone_otp' }));
    report('Login', { method: 'phone_otp' });
  },

  logViewContent(contentType: 'paywall' | 'report', contentId?: string) {
    safe('ViewContent', ({ AppEventsLogger: l }) =>
      l.logEvent(l.AppEvents.ViewedContent, {
        [l.AppEventParams.ContentType]: contentType,
        ...(contentId ? { [l.AppEventParams.ContentID]: contentId } : {}),
      }),
    );
    report('ViewContent', { contentType, ...(contentId ? { planId: contentId } : {}) });
  },

  logInitiatedCheckout(params: { planId: string; amount: number; currency?: string }) {
    safe('InitiatedCheckout', ({ AppEventsLogger: l }) =>
      l.logEvent(l.AppEvents.InitiatedCheckout, params.amount, {
        [l.AppEventParams.ContentType]: 'subscription',
        [l.AppEventParams.ContentID]: params.planId,
        [l.AppEventParams.Currency]: params.currency ?? 'INR',
        [l.AppEventParams.NumItems]: 1,
      }),
    );
    report('InitiatedCheckout', { value: params.amount, currency: params.currency ?? 'INR', planId: params.planId, contentType: 'subscription' });
  },

  /** After the backend confirmed the payment. `amount` is what was charged today (trial amount, else first charge). */
  logPurchase(params: { amount: number; planId: string; subscriptionId: string; currency?: string }) {
    safe('Purchase', ({ AppEventsLogger: l }) =>
      l.logPurchase(params.amount, params.currency ?? 'INR', {
        [l.AppEventParams.ContentType]: 'subscription',
        [l.AppEventParams.ContentID]: params.planId,
        [l.AppEventParams.NumItems]: 1,
        [l.AppEventParams.OrderId]: params.subscriptionId,
      } satisfies EventParams),
    );
    report('Purchase', {
      value: params.amount,
      currency: params.currency ?? 'INR',
      planId: params.planId,
      subscriptionId: params.subscriptionId,
      contentType: 'subscription',
    });
  },
};
