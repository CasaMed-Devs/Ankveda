// API contract shared with backend/src/types.ts — keep both in sync.

export type ReportType = 'name' | 'phone' | 'birthdate' | 'compatibility' | 'career' | 'future' | 'car';
export type ReportStatus = 'locked' | 'processing' | 'complete' | 'failed';
export type ReportStage = 'received' | 'numbers' | 'writing' | 'done';

export type ReportInput = {
  fullName?: string;
  dob?: string;
  phone?: string;
  partnerName?: string;
  partnerDob?: string;
  careerFocus?: string;
  period?: '3m' | '6m' | '12m';
  carNumber?: string;
};

export type ReportNumber = { label: string; value: string };
export type ReportSection = { eyebrow?: string; title: string; body: string };

export type ReportContent = {
  headline: string;
  traits: string;
  primary: { label: string; value: string; calculation: string };
  numbers: ReportNumber[];
  sections: ReportSection[];
  basis: string;
};

export type Report = {
  id: string;
  type: ReportType;
  status: ReportStatus;
  stage: ReportStage;
  input: ReportInput;
  content?: ReportContent;
  saved: boolean;
  createdAt: number;
  error?: string;
};

export type Entitlement = {
  active: boolean;
  status: 'none' | 'created' | 'authenticated' | 'active' | 'pending' | 'halted' | 'cancelled' | 'completed' | 'expired';
  planId?: string;
  planName?: string;
  subscriptionId?: string;
  currentPeriodEnd?: number;
  cancelAtPeriodEnd?: boolean;
};

export type User = {
  id: string;
  phone: string;
  fullName?: string;
  dob?: string;
  entitlement: Entitlement;
};

export type PlanPeriod = 'daily' | 'weekly' | 'monthly' | 'yearly';

export type Plan = {
  id: string;
  name: string;
  priceInPaise: number;
  period: PlanPeriod;
  interval: number;
  trialDays: number;
  trialPriceInPaise: number;
};

export type HomeSummary = {
  locked: boolean;
  birthNumber?: number;
  birthTitle?: string;
  birthMessage?: string;
};

export type Daily = {
  date: string;
  luckyNumber: string;
  luckyTime: string;
  theme: string;
  title: string;
  message: string;
};

export type ChatMessage = {
  id: string;
  role: 'user' | 'astrologer';
  text: string;
  createdAt: number;
};

export type CheckoutSession = {
  keyId: string;
  subscriptionId: string;
  planName: string;
  description: string;
  phone: string;
};

/**
 * GST tax invoice for one trial or subscription payment — mirrors backend/src/services/invoice.ts
 * (kept in sync by hand). Money in rupees; instants as ISO strings. Computed by the backend.
 */
export type Invoice = {
  id: string;
  invoiceNumber: string;
  type: 'trial' | 'monthly';
  description: string;
  status: 'paid';
  paymentId: string;
  subscriptionId: string | null;
  paymentMethod: string | null;
  paidAt: string;
  periodStart: string;
  periodEnd: string;
  currency: string;
  amount: number;
  taxableValue: number;
  cgst: number;
  sgst: number;
  halfGstRatePercent: number;
  customer: { name: string | null; phoneNumber: string };
  appName: string;
  sac: { code: string; description: string };
  seller: {
    brandName: string;
    legalName: string;
    addressLines: readonly string[];
    gstin: string;
    state: string;
    stateCode: string;
    supportEmail: string;
  };
};
