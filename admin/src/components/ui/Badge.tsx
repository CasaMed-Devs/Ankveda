import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';
import type { AccessBucket, SubscriptionRow, SubscriptionStatus, TransactionStatus } from '@/lib/types';

export type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'violet' | 'gold';

const TONES: Record<Tone, { box: string; dot: string }> = {
  neutral: { box: 'bg-surface-3 text-ink-2 ring-line-strong', dot: 'bg-slate-400' },
  success: { box: 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-800 dark:text-emerald-300 ring-emerald-200 dark:ring-emerald-500/25', dot: 'bg-emerald-500' },
  warning: { box: 'bg-amber-50 dark:bg-amber-500/10 text-amber-800 dark:text-amber-300 ring-amber-200 dark:ring-amber-500/25', dot: 'bg-amber-500' },
  danger: { box: 'bg-red-50 dark:bg-red-500/10 text-red-800 dark:text-red-300 ring-red-200 dark:ring-red-500/25', dot: 'bg-red-500' },
  info: { box: 'bg-sky-50 dark:bg-sky-500/10 text-sky-800 dark:text-sky-300 ring-sky-200 dark:ring-sky-500/25', dot: 'bg-sky-500' },
  violet: { box: 'bg-violet-50 dark:bg-violet-500/10 text-violet-800 dark:text-violet-300 ring-violet-200 dark:ring-violet-500/25', dot: 'bg-violet-500' },
  gold: { box: 'bg-gold-100 dark:bg-gold-300/10 text-gold-700 dark:text-gold-300 ring-gold-300/60 dark:ring-gold-300/25', dot: 'bg-gold-400' },
};

/** Status is always text + tone (never colour alone). */
export const Badge = ({ tone = 'neutral', children, className, dot = true }: { tone?: Tone; children: ReactNode; className?: string; dot?: boolean }) => (
  <span
    className={cn(
      'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap ring-1 ring-inset',
      TONES[tone].box,
      className,
    )}
  >
    {dot && <span className={cn('size-1.5 rounded-full', TONES[tone].dot)} aria-hidden />}
    {children}
  </span>
);

export const ACCESS: Record<AccessBucket, { label: string; tone: Tone; help: string }> = {
  free: { label: 'Free', tone: 'neutral', help: 'Never subscribed' },
  trial: { label: 'Trial', tone: 'info', help: 'In a Razorpay trial' },
  paid: { label: 'Active', tone: 'success', help: 'Paying subscriber' },
  granted: { label: 'Complimentary', tone: 'violet', help: 'Access granted by an admin' },
  cancelling: { label: 'Cancelling', tone: 'warning', help: 'Cancelled — access until the period ends' },
  expired: { label: 'Expired', tone: 'danger', help: 'No access now' },
};
export const AccessBadge = ({ access }: { access: AccessBucket }) => <Badge tone={ACCESS[access].tone}>{ACCESS[access].label}</Badge>;

export const SUB_STATUS: Record<SubscriptionStatus, { label: string; tone: Tone }> = {
  none: { label: 'None', tone: 'neutral' },
  created: { label: 'Checkout started', tone: 'neutral' },
  authenticated: { label: 'Trial', tone: 'info' },
  active: { label: 'Active', tone: 'success' },
  pending: { label: 'Payment retry', tone: 'warning' },
  halted: { label: 'Halted', tone: 'danger' },
  cancelled: { label: 'Cancelled', tone: 'warning' },
  completed: { label: 'Completed', tone: 'neutral' },
  expired: { label: 'Expired', tone: 'danger' },
};
export const SubStatusBadge = ({ status }: { status: SubscriptionStatus }) => <Badge tone={SUB_STATUS[status].tone}>{SUB_STATUS[status].label}</Badge>;

export const TX_STATUS: Record<TransactionStatus, { label: string; tone: Tone }> = {
  created: { label: 'Created', tone: 'neutral' },
  authorized: { label: 'Authorized', tone: 'info' },
  captured: { label: 'Successful', tone: 'success' },
  failed: { label: 'Failed', tone: 'danger' },
  refunded: { label: 'Refunded', tone: 'neutral' },
  partially_refunded: { label: 'Part refunded', tone: 'warning' },
};
export const TxStatusBadge = ({ status }: { status: TransactionStatus }) => <Badge tone={TX_STATUS[status].tone}>{TX_STATUS[status].label}</Badge>;

const PAYMENT: Record<SubscriptionRow['paymentStatus'], { label: string; tone: Tone }> = {
  complimentary: { label: 'Not charged', tone: 'violet' },
  checkout_pending: { label: 'Not paid', tone: 'neutral' },
  failed: { label: 'Payment failed', tone: 'danger' },
  paid: { label: 'Paid', tone: 'success' },
  trial_paid: { label: 'Trial paid', tone: 'info' },
  none: { label: '—', tone: 'neutral' },
};
export const PaymentStatusBadge = ({ status }: { status: SubscriptionRow['paymentStatus'] }) => (
  <Badge tone={PAYMENT[status].tone} dot={false}>
    {PAYMENT[status].label}
  </Badge>
);

export const SourceBadge = ({ source }: { source: 'razorpay' | 'admin_grant' }) =>
  source === 'admin_grant' ? (
    <Badge tone="violet" dot={false}>
      Manual grant
    </Badge>
  ) : (
    <Badge tone="neutral" dot={false}>
      Razorpay
    </Badge>
  );
