import { Ban, Gift, Receipt, Trash } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { InvoiceActions } from '@/components/InvoiceActions';
import { DescList } from '@/components/layout/Page';
import { AccessBadge, Badge, SourceBadge, SubStatusBadge, SUB_STATUS, TxStatusBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Avatar, CopyText, EmptyState, ErrorState, InlineAlert, Skeleton } from '@/components/ui/Feedback';
import { Segmented } from '@/components/ui/Form';
import { Drawer } from '@/components/ui/Overlay';
import { auditLabel, AuditDetails } from '@/pages/ActivityPage';
import { date, dateTime, phone, relative, rupees } from '@/lib/format';
import { useUserDetail } from '@/lib/queries';
import type { SubscriptionRow, UserDetail } from '@/lib/types';
import { useUserActions } from './UserActions';

const Section = ({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) => (
  <Card className="p-5">
    <div className="mb-4 flex items-center justify-between gap-2">
      <h3 className="text-[13px] font-semibold tracking-wide text-ink-3 uppercase">{title}</h3>
      {action}
    </div>
    {children}
  </Card>
);

const KIND = { trial: 'Trial charge', mandate_auth: 'Autopay setup', first_charge: 'First charge', renewal: 'Renewal' } as const;

/** Trial and paid-period dates from what Razorpay reported (never guessed). */
const subscriptionFacts = (s: SubscriptionRow) => {
  const hadTrial = s.source === 'razorpay' && s.trialDays > 0;
  return [
    { label: 'Plan', value: s.planName },
    { label: 'Status', value: <SubStatusBadge status={s.status} /> },
    { label: 'Type', value: <SourceBadge source={s.source} /> },
    { label: 'Price', value: s.source === 'admin_grant' ? 'Complimentary · ₹0' : `${rupees(s.amountInPaise)} / ${s.period.replace('ly', '')}` },
    ...(hadTrial
      ? [
          { label: 'Trial start', value: dateTime(s.startAt) },
          { label: 'Trial expiry', value: s.status === 'authenticated' ? dateTime(s.expiresAt) : `${s.trialDays}-day trial · ${rupees(s.trialPriceInPaise)}` },
        ]
      : []),
    { label: 'Current period start', value: dateTime(s.currentPeriodStart ?? s.startAt) },
    { label: 'Access until', value: s.expiresAt ? `${dateTime(s.expiresAt)} (${relative(s.expiresAt)})` : '—' },
    ...(s.source === 'razorpay'
      ? [
          { label: 'Next charge', value: s.nextChargeAt ? `${dateTime(s.nextChargeAt)}${s.cancelAtPeriodEnd ? ' · cancelled' : ''}` : s.cancelAtPeriodEnd ? 'None — renewal cancelled' : '—' },
          { label: 'Paid cycles', value: String(s.paidCount) },
          { label: 'Razorpay subscription ID', value: <CopyText value={s.id} truncate={false} /> },
          { label: 'Razorpay plan ID', value: <CopyText value={s.razorpayPlanId} truncate={false} /> },
          { label: 'Razorpay customer ID', value: <CopyText value={s.razorpayCustomerId} truncate={false} /> },
        ]
      : [{ label: 'Grant ID', value: <CopyText value={s.id} truncate={false} /> }]),
  ];
};

const Provenance = ({ s }: { s: SubscriptionRow }) => (
  <>
    {s.grant && (
      <div className="mt-4 rounded-xl border border-violet-200 dark:border-violet-500/25 bg-violet-50 dark:bg-violet-500/10 px-4 py-3 text-[13px] text-violet-900 dark:text-violet-300">
        <p>
          <strong>Manually granted</strong> by {s.grant.grantedBy.email ?? s.grant.grantedBy.uid} on {dateTime(s.grant.grantedAt)}. No payment was taken.
        </p>
        {s.grant.notes && <p className="mt-1 text-violet-800 dark:text-violet-300">“{s.grant.notes}”</p>}
      </div>
    )}
    {s.adminAction && (
      <div className="mt-3 rounded-xl border border-amber-200 dark:border-amber-500/25 bg-amber-50 dark:bg-amber-500/10 px-4 py-3 text-[13px] text-amber-900 dark:text-amber-300">
        <p>
          <strong>{s.adminAction.type === 'expire_now' ? 'Access ended by admin' : 'Renewal cancelled by admin'}</strong> — {s.adminAction.by.email ?? s.adminAction.by.uid},{' '}
          {dateTime(s.adminAction.performedAt)}
        </p>
        {s.adminAction.notes && <p className="mt-1">“{s.adminAction.notes}”</p>}
      </div>
    )}
  </>
);

const OverviewTab = ({ d, onExpire }: { d: UserDetail; onExpire: () => void }) => {
  const u = d.user;
  const s = d.currentSubscription;
  return (
    <div className="flex flex-col gap-4">
      {d.user.deletedByUser && (
        <InlineAlert tone="warning">
          <p className="font-semibold">Deleted by the user on {dateTime(d.user.deletedByUser.at)}.</p>
          <p>
            The account is gone from the app and its data is kept here
            {d.user.deletedByUser.billingCancelled ? ` (${d.user.deletedByUser.billingCancelled} subscription cancelled at deletion)` : ''}. If this number
            signs in again it gets a brand-new account.
          </p>
        </InlineAlert>
      )}
      {d.deletion && (
        <InlineAlert tone="danger">
          A deletion of this user stopped: {d.deletion.lastError ?? 'unknown error'}. Use “Delete user” to resume it.
        </InlineAlert>
      )}
      <Section title="Personal information">
        <DescList
          items={[
            { label: 'Full name', value: u.name ?? <span className="text-ink-3 italic">Not set yet</span> },
            { label: 'Phone', value: phone(u.phone) },
            { label: 'Email', value: <span className="text-ink-3">Not collected (phone sign-in)</span> },
            { label: 'Date of birth', value: u.dob ? date(Date.parse(`${u.dob}T00:00:00+05:30`)) : '—' },
            { label: 'User ID', value: <CopyText value={u.id} truncate={false} /> },
            { label: 'Account created', value: dateTime(u.createdAt) },
            { label: 'Last login', value: u.lastLoginAt ? `${dateTime(u.lastLoginAt)} (${relative(u.lastLoginAt)})` : '—' },
            { label: 'Reports', value: `${u.reportCount} report${u.reportCount === 1 ? '' : 's'}` },
            ...(u.numbers ? [{ label: 'Numbers (birth · life path · name)', value: `${u.numbers.birth} · ${u.numbers.lifePath} · ${u.numbers.name}` }] : []),
          ]}
        />
      </Section>
      <Section
        title="Subscription"
        action={
          s && (
            <Button size="sm" variant="ghost" icon={Ban} onClick={onExpire}>
              Expire
            </Button>
          )
        }
      >
        {s ? (
          <>
            <DescList items={subscriptionFacts(s)} />
            <Provenance s={s} />
          </>
        ) : (
          <p className="text-[13px] text-ink-3">This user has never subscribed.</p>
        )}
      </Section>
    </div>
  );
};

const PaymentsTab = ({ d }: { d: UserDetail }) =>
  d.transactions.length === 0 ? (
    <Card>
      <EmptyState icon={Receipt} title="No payments" body={d.currentSubscription?.source === 'admin_grant' ? 'Complimentary access — nothing was charged, so there is no invoice.' : undefined} />
    </Card>
  ) : (
    <Card className="divide-y divide-line">
      {d.transactions.map((t) => (
        <div key={t.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
          <div className="min-w-0">
            <p className="font-semibold text-ink tabular">
              {rupees(t.amountInPaise)}
              {t.refundedAmountInPaise > 0 && <span className="ml-2 text-[12px] font-medium text-ink-3">({rupees(t.refundedAmountInPaise)} refunded)</span>}
            </p>
            <p className="text-[12px] text-ink-3">
              {KIND[t.kind]} · {dateTime(t.paymentCreatedAt)}
              {t.method ? ` · ${t.method}` : ''}
              {t.confirmedVia ? ` · via ${t.confirmedVia}` : ''}
            </p>
            {t.errorDescription && <p className="text-[12px] text-red-700 dark:text-red-400">{t.errorDescription}</p>}
            <CopyText value={t.razorpayPaymentId} className="mt-0.5" />
          </div>
          <div className="flex flex-col items-end gap-1.5">
            <TxStatusBadge status={t.status} />
            <InvoiceActions tx={t} compact />
          </div>
        </div>
      ))}
    </Card>
  );

const HistoryTab = ({ d }: { d: UserDetail }) => (
  <div className="flex flex-col gap-4">
    {d.currentSubscription?.events.length ? (
      <Section title="Current subscription — status history">
        <ol className="relative ml-2 border-l border-line">
          {d.currentSubscription.events.map((e) => (
            <li key={e.id} className="mb-4 ml-4 last:mb-0">
              <span className="absolute -left-[5px] mt-1.5 size-2.5 rounded-full border-2 border-surface bg-series-1" aria-hidden />
              <p className="text-[13px] font-semibold text-ink">
                {e.fromStatus ? `${SUB_STATUS[e.fromStatus].label} → ` : ''}
                {SUB_STATUS[e.toStatus].label}
              </p>
              <p className="text-[12px] text-ink-3">
                <code>{e.event}</code> · {dateTime(e.receivedAt)}
              </p>
            </li>
          ))}
        </ol>
      </Section>
    ) : null}
    <Section title={`All subscriptions (${d.subscriptions.length})`}>
      {d.subscriptions.length === 0 ? (
        <p className="text-[13px] text-ink-3">None.</p>
      ) : (
        <ul className="divide-y divide-line">
          {d.subscriptions.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-3 first:pt-0 last:pb-0">
              <div className="min-w-0">
                <p className="font-semibold text-ink">{s.planName}</p>
                <p className="text-[12px] text-ink-3">
                  {date(s.createdAt)} → {date(s.expiresAt)} · <CopyText value={s.id} />
                </p>
              </div>
              <div className="flex gap-1.5">
                <SourceBadge source={s.source} />
                <SubStatusBadge status={s.status} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Section>
  </div>
);

const AuditTab = ({ d }: { d: UserDetail }) =>
  d.audit.length === 0 ? (
    <Card>
      <EmptyState title="No admin actions on this user" />
    </Card>
  ) : (
    <Card className="divide-y divide-line">
      {d.audit.map((a) => (
        <div key={a.id} className="px-5 py-3.5">
          <p className="text-[13px] font-semibold text-ink">{auditLabel(a.action)}</p>
          <p className="text-[12px] text-ink-3">
            {a.actor?.email ?? 'Legacy admin'} · {dateTime(a.createdAt)}
          </p>
          <AuditDetails row={a} />
        </div>
      ))}
    </Card>
  );

export const UserDrawer = ({ userId, onClose }: { userId: string | null; onClose: () => void }) => {
  const detail = useUserDetail(userId);
  const [tab, setTab] = useState<'overview' | 'payments' | 'history' | 'audit'>('overview');
  const actions = useUserActions();
  const d = detail.data;
  const u = d?.user;
  const sub = d?.currentSubscription;
  const actionSub = sub
    ? { id: sub.id, source: sub.source, status: sub.status, planName: sub.planName, expiresAt: sub.expiresAt, cancelAtPeriodEnd: sub.cancelAtPeriodEnd, nextChargeAt: sub.nextChargeAt, amountInPaise: sub.amountInPaise }
    : null;

  return (
    <>
      <Drawer
        open={!!userId}
        onClose={onClose}
        title="User details"
        header={
          u ? (
            <div className="flex items-center gap-3">
              <Avatar name={u.name} className="size-12 text-sm" />
              <div className="min-w-0">
                <h2 className="truncate text-base font-semibold text-ink">{u.name ?? 'Name not set'}</h2>
                <p className="flex flex-wrap items-center gap-2 text-[13px] text-ink-3">
                  {phone(u.phone)} {u.deleted ? <Badge tone="danger">Deleted account</Badge> : <AccessBadge access={u.access} />}
                </p>
              </div>
            </div>
          ) : (
            <h2 className="text-base font-semibold">User details</h2>
          )
        }
      >
        {detail.isLoading ? (
          <div className="flex flex-col gap-4 p-5">
            <Skeleton className="h-10 w-72" />
            <Skeleton className="h-56" />
            <Skeleton className="h-64" />
          </div>
        ) : detail.error || !d || !u ? (
          <ErrorState error={detail.error ?? 'User not found'} onRetry={() => void detail.refetch()} />
        ) : (
          <div className="flex flex-col gap-4 p-5">
            <div className="flex flex-wrap gap-2">
              {!d.user.deletedByUser && (
                <>
                  <Button size="sm" variant="primary" icon={Gift} onClick={() => actions.open('grant', u)}>
                    Grant subscription
                  </Button>
                  <Button size="sm" icon={Ban} disabled={!sub} onClick={() => actions.open('expire', u, actionSub)}>
                    Expire subscription
                  </Button>
                </>
              )}
              <Button size="sm" variant="dangerGhost" icon={Trash} onClick={() => actions.open('delete', u)} className="sm:ml-auto">
                {d.user.deletedByUser ? 'Delete permanently' : 'Delete user'}
              </Button>
            </div>
            <Segmented
              label="User sections"
              value={tab}
              onChange={setTab}
              options={[
                { value: 'overview', label: 'Overview' },
                { value: 'payments', label: `Payments & invoices (${d.transactions.length})` },
                { value: 'history', label: 'History' },
                { value: 'audit', label: 'Admin actions' },
              ]}
            />
            {tab === 'overview' && <OverviewTab d={d} onExpire={() => actions.open('expire', u, actionSub)} />}
            {tab === 'payments' && <PaymentsTab d={d} />}
            {tab === 'history' && <HistoryTab d={d} />}
            {tab === 'audit' && <AuditTab d={d} />}
          </div>
        )}
      </Drawer>
      {actions.modals(onClose)}
    </>
  );
};
