import { Ban, CreditCard, UserRound } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';

import { DescList, PageIntro, useOpenUser, UserCell } from '@/components/layout/Page';
import { PaymentStatusBadge, SourceBadge, SubStatusBadge, SUB_STATUS, TxStatusBadge } from '@/components/ui/Badge';
import { Button, IconButton } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { DataTable, Pagination, type Column } from '@/components/ui/DataTable';
import { CopyText, ErrorState, Skeleton } from '@/components/ui/Feedback';
import { Segmented } from '@/components/ui/Form';
import { Drawer } from '@/components/ui/Overlay';
import { date, dateTime, number, periodLabel, rupees } from '@/lib/format';
import { fetchSubscriptions, useOverview, usePagedList, useSubscriptionDetail } from '@/lib/queries';
import type { SubscriptionRow } from '@/lib/types';
import { ExpireModal } from './users/UserActions';

const FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'trial', label: 'Trial' },
  { value: 'expired', label: 'Expired' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'payment_failed', label: 'Payment failed' },
  { value: 'granted', label: 'Manually granted' },
  { value: 'checkout', label: 'Checkout started' },
];

const TYPE = { complimentary: 'Complimentary', trial: 'Trial', paid: 'Paid' } as const;

const toAction = (s: SubscriptionRow) => ({
  id: s.id,
  source: s.source,
  status: s.status,
  planName: s.planName,
  expiresAt: s.expiresAt,
  cancelAtPeriodEnd: s.cancelAtPeriodEnd,
  nextChargeAt: s.nextChargeAt,
  amountInPaise: s.amountInPaise,
});

const SubscriptionDrawer = ({ id, onClose, onExpire }: { id: string | null; onClose: () => void; onExpire: (s: SubscriptionRow) => void }) => {
  const detail = useSubscriptionDetail(id);
  const openUser = useOpenUser();
  const s = detail.data?.subscription;
  return (
    <Drawer open={!!id} onClose={onClose} title="Subscription" width="max-w-xl">
      {detail.isLoading ? (
        <div className="space-y-4 p-5">
          <Skeleton className="h-40" />
          <Skeleton className="h-60" />
        </div>
      ) : !s ? (
        <ErrorState error={detail.error ?? 'Not found'} onRetry={() => void detail.refetch()} />
      ) : (
        <div className="flex flex-col gap-4 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <UserCell name={s.userName} phone={s.userPhone} />
            <div className="flex gap-2">
              <Button
                size="sm"
                icon={UserRound}
                onClick={() => {
                  onClose();
                  openUser(s.userId);
                }}
              >
                User profile
              </Button>
              <Button size="sm" icon={Ban} onClick={() => onExpire(s)} disabled={s.status === 'expired' || s.status === 'completed'}>
                Expire
              </Button>
            </div>
          </div>
          <Card className="p-5">
            <DescList
              items={[
                { label: 'Plan', value: `${s.planName} · ${s.source === 'admin_grant' ? '₹0' : `${rupees(s.amountInPaise)} / ${periodLabel(s.period, s.interval)}`}` },
                { label: 'Status', value: <SubStatusBadge status={s.status} /> },
                { label: 'Source', value: <SourceBadge source={s.source} /> },
                { label: 'Payment', value: <PaymentStatusBadge status={s.paymentStatus} /> },
                { label: 'Started', value: dateTime(s.startAt) },
                { label: 'Access until', value: dateTime(s.expiresAt) },
                { label: 'Next charge', value: dateTime(s.nextChargeAt) },
                { label: 'Paid cycles', value: String(s.paidCount) },
                { label: s.source === 'admin_grant' ? 'Grant ID' : 'Razorpay subscription ID', value: <CopyText value={s.id} truncate={false} /> },
                { label: 'Razorpay plan ID', value: <CopyText value={s.razorpayPlanId} truncate={false} /> },
              ]}
            />
            {s.grant && (
              <p className="mt-4 rounded-lg bg-violet-50 dark:bg-violet-500/10 px-3 py-2 text-[12px] text-violet-900 dark:text-violet-300">
                Granted by {s.grant.grantedBy.email} on {dateTime(s.grant.grantedAt)}
                {s.grant.notes ? ` — “${s.grant.notes}”` : ''}
              </p>
            )}
            {s.adminAction && (
              <p className="mt-2 rounded-lg bg-amber-50 dark:bg-amber-500/10 px-3 py-2 text-[12px] text-amber-900 dark:text-amber-300">
                {s.adminAction.type === 'expire_now' ? 'Access ended' : 'Renewal cancelled'} by {s.adminAction.by.email} on {dateTime(s.adminAction.performedAt)}
                {s.adminAction.notes ? ` — “${s.adminAction.notes}”` : ''}
              </p>
            )}
          </Card>
          <Card className="p-5">
            <h3 className="mb-3 text-[13px] font-semibold tracking-wide text-ink-3 uppercase">Payment history</h3>
            {detail.data!.transactions.length === 0 ? (
              <p className="text-[13px] text-ink-3">{s.source === 'admin_grant' ? 'Complimentary — no payments.' : 'No payments recorded.'}</p>
            ) : (
              <ul className="divide-y divide-line">
                {detail.data!.transactions.map((t) => (
                  <li key={t.id} className="flex items-center justify-between gap-3 py-2.5">
                    <div>
                      <p className="font-semibold tabular">{rupees(t.amountInPaise)}</p>
                      <p className="text-[12px] text-ink-3">{dateTime(t.paymentCreatedAt)}</p>
                    </div>
                    <TxStatusBadge status={t.status} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card className="p-5">
            <h3 className="mb-3 text-[13px] font-semibold tracking-wide text-ink-3 uppercase">Status history</h3>
            <ol className="relative ml-2 border-l border-line">
              {detail.data!.events.map((e) => (
                <li key={e.id} className="mb-3 ml-4 last:mb-0">
                  <span className="absolute -left-[5px] mt-1.5 size-2.5 rounded-full border-2 border-surface bg-series-1" aria-hidden />
                  <p className="text-[13px] font-semibold">
                    {e.fromStatus ? `${SUB_STATUS[e.fromStatus].label} → ` : ''}
                    {SUB_STATUS[e.toStatus].label}
                  </p>
                  <p className="text-[12px] text-ink-3">
                    <code>{e.event}</code> · {dateTime(e.receivedAt)}
                  </p>
                </li>
              ))}
            </ol>
          </Card>
        </div>
      )}
    </Drawer>
  );
};

export const SubscriptionsPage = () => {
  const [params, setParams] = useSearchParams();
  const filter = params.get('filter') ?? 'all';
  const filters = useMemo(() => ({ filter }), [filter]);
  const list = usePagedList('subscriptions', filters, fetchSubscriptions);
  const overview = useOverview();
  const openUser = useOpenUser();
  const [detailId, setDetailId] = useState<string | null>(null);
  const [expiring, setExpiring] = useState<SubscriptionRow | null>(null);
  const by = overview.data?.subscriptions.byStatus ?? {};

  const columns: Column<SubscriptionRow>[] = [
    { key: 'user', header: 'User', cell: (s) => <UserCell name={s.userName} phone={s.userPhone} />, className: 'min-w-48' },
    { key: 'id', header: 'Subscription ID', cell: (s) => <CopyText value={s.id} className="max-w-36" />, hideBelow: 'xl' },
    {
      key: 'plan',
      header: 'Plan',
      cell: (s) => (
        <div>
          <p className="font-medium text-ink">{s.planName}</p>
          {s.razorpayPlanId && <p className="font-mono text-[11px] text-ink-3">{s.razorpayPlanId}</p>}
        </div>
      ),
      hideBelow: 'sm',
    },
    { key: 'type', header: 'Type', cell: (s) => (s.source === 'admin_grant' ? <SourceBadge source="admin_grant" /> : <span>{TYPE[s.type]}</span>), hideBelow: 'lg' },
    { key: 'amount', header: 'Amount', align: 'right', cell: (s) => (s.source === 'admin_grant' ? '₹0' : rupees(s.amountInPaise)), hideBelow: 'md' },
    { key: 'start', header: 'Start', cell: (s) => <span className="whitespace-nowrap tabular">{date(s.startAt ?? s.createdAt)}</span>, hideBelow: 'lg' },
    { key: 'expiry', header: 'Expiry', cell: (s) => <span className="whitespace-nowrap tabular">{date(s.expiresAt)}</span>, hideBelow: 'md' },
    { key: 'status', header: 'Status', cell: (s) => <SubStatusBadge status={s.status} /> },
    { key: 'payment', header: 'Payment', cell: (s) => <PaymentStatusBadge status={s.paymentStatus} />, hideBelow: 'xl' },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      align: 'right',
      hideBelow: 'sm',
      cell: (s) => (
        <div className="flex justify-end gap-0.5" onClick={(e) => e.stopPropagation()}>
          <IconButton icon={UserRound} label="Open user profile" onClick={() => openUser(s.userId)} />
          <IconButton icon={Ban} label="Expire subscription" disabled={s.status === 'expired' || s.status === 'completed'} onClick={() => setExpiring(s)} />
        </div>
      ),
    },
  ];

  const tile = (label: string, value: number | undefined) => (
    <Card className="px-4 py-3">
      <p className="text-[12px] font-medium text-ink-3">{label}</p>
      {overview.isLoading ? <Skeleton className="mt-1 h-6 w-12" /> : <p className="text-xl font-semibold tabular">{number(value ?? 0)}</p>}
    </Card>
  );

  return (
    <>
      <PageIntro description="Every subscription — Razorpay checkouts and manual grants. Manual grants are never shown as paid." />
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-5">
        {tile('Active', by.active)}
        {tile('In trial', by.authenticated)}
        {tile('Payment issues', (by.pending ?? 0) + (by.halted ?? 0))}
        {tile('Cancelled', by.cancelled)}
        {tile('Manual grants', overview.data?.subscriptions.grants)}
      </div>
      <Card>
        <div className="border-b border-line p-4">
          <Segmented
            label="Subscription filter"
            value={filter}
            onChange={(v) =>
              setParams((p) => {
                if (v === 'all') p.delete('filter');
                else p.set('filter', v);
                return p;
              })
            }
            options={FILTERS}
          />
        </div>
        <DataTable
          columns={columns}
          rows={list.items}
          rowKey={(s) => s.id}
          loading={list.isLoading}
          fetching={list.isFetching}
          error={list.error}
          onRetry={() => void list.refetch()}
          onRowClick={(s) => setDetailId(s.id)}
          rowLabel={(s) => `Open subscription ${s.id}`}
          empty={{ icon: CreditCard, title: 'No subscriptions match this filter' }}
        />
        <Pagination
          page={list.page}
          pageSize={list.pageSize}
          total={list.total}
          count={list.items.length}
          hasNext={list.hasNext}
          hasPrev={list.hasPrev}
          onNext={list.next}
          onPrev={list.prev}
          onPageSize={list.setPageSize}
          busy={list.isFetching}
        />
      </Card>
      <SubscriptionDrawer id={detailId} onClose={() => setDetailId(null)} onExpire={(s) => setExpiring(s)} />
      {expiring && (
        <ExpireModal
          user={{ id: expiring.userId, name: expiring.userName, phone: expiring.userPhone ?? '', access: 'paid' }}
          subscription={toAction(expiring)}
          open
          onClose={() => setExpiring(null)}
        />
      )}
    </>
  );
};
