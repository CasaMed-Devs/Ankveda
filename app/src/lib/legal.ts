import { router } from 'expo-router';

import { LEGAL_URLS } from '@/lib/config';

export type LegalDoc = 'privacy' | 'terms' | 'payment-cancellation' | 'delete-account';

type LegalDocInfo = { title: string; subtitle: string; url: string };

/** The hosted legal pages, in the order they are listed on Profile. */
export const LEGAL_DOCS: Record<LegalDoc, LegalDocInfo> = {
  privacy: { title: 'Privacy policy', subtitle: 'How we collect and protect your data', url: LEGAL_URLS.privacy },
  terms: { title: 'Terms & conditions', subtitle: 'The rules for using Ankveda', url: LEGAL_URLS.terms },
  'payment-cancellation': {
    title: 'Payment & cancellation',
    subtitle: 'Billing, trial, cancellation and refunds',
    url: LEGAL_URLS.paymentCancellation,
  },
  'delete-account': {
    title: 'Account deletion',
    subtitle: 'How account and data deletion works',
    url: LEGAL_URLS.deleteAccount,
  },
};

export const LEGAL_DOC_KEYS = Object.keys(LEGAL_DOCS) as LegalDoc[];

export const isLegalDoc = (value: unknown): value is LegalDoc =>
  typeof value === 'string' && Object.prototype.hasOwnProperty.call(LEGAL_DOCS, value);

/** Opens a legal page in the in-app WebView screen. Works signed in and signed out. */
export const openLegal = (doc: LegalDoc) => router.push({ pathname: '/legal/[doc]', params: { doc } });
