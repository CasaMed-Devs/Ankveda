import { CalendarDays, IndianRupee, Receipt, TrendingUp, Wallet } from 'lucide-react';
import { useMemo } from 'react';
import { useSearchParams } from 'react-router';

import { InvoiceActions } from '@/components/InvoiceActions';
import { PageIntro, useOpenUser, UserCell } from '@/components/layout/Page';
import { TxStatusBadge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { DataTable, Pagination, type Column } from '@/components/ui/DataTable';
import { CopyText } from '@/components/ui/Feedback';
import { Input, Segmented } from '@/components/ui/Form';
import { StatCard } from '@/components/ui/StatCard';
import { dateTime, istKey, number, pctChange, rupees } from '@/lib/format';
import { fetchTransactions, useOverview, usePagedList } from '@/lib/queries';
import type { TransactionRow } from '@/lib/types';

const KIND = { trial: 'Trial', first_charge: 'First charge', renewal: 'Renewal' } as const;

export const PaymentsPage = () => {
  const [params, setParams] = useSearchParams();
  const filters = useMemo(
    () => ({ filter: params.get('filter') ?? 'all', from: params.get('from') ?? undefined, to: params.get('to') ?? undefined }),
    [params],
  );
  const set = (key: string, value: string) =>
    setParams((p) => {
      if (value && value !== 'all') p.set(key, value);
      else p.delete(key);
      return p;
    });
  const list = usePagedList('transactions', filters, fetchTransactions);
  const overview = useOverview();
  const openUser = useOpenUser();
  const r = overview.data?.revenue;

  const columns: Column<TransactionRow>[] = [
    {
      key: 'id',
      header: 'Transaction / Payment ID',
      cell: (t) => (
        <div className="min-w-0">
          <CopyText value={t.razorpayPaymentId} className="max-w-44" />
          <p className="text-[11px] text-ink-3">{KIND[t.kind]}</p>
        </div>
      ),
    },
    {
      key: 'user',
      header: 'User',
      cell: (t) => (
        <button type="button" className="text-left" onClick={(e) => (e.stopPropagation(), openUser(t.userId))}>
          <UserCell name={t.userName} phone={t.userPhone} />
        </button>
      ),
      className: 'min-w-48',
    },
    { key: 'order', header: 'Order ID', cell: (t) => <CopyText value={t.razorpayOrderId} className="max-w-36" />, hideBelow: 'xl' },
    { key: 'plan', header: 'Plan', cell: (t) => t.planName ?? '—', hideBelow: 'lg' },
    {
      key: 'amount',
      header: 'Amount',
      align: 'right',
      cell: (t) => (
        <div>
          <p className="font-semibold text-ink">{rupees(t.amountInPaise)}</p>
          {t.refundedAmountInPaise > 0 && <p className="text-[11px] text-ink-3">−{rupees(t.refundedAmountInPaise)} refunded</p>}
        </div>
      ),
    },
    { key: 'currency', header: 'Currency', cell: (t) => t.currency, hideBelow: 'xl' },
    { key: 'invoice', header: 'Invoice', cell: (t) => <InvoiceActions tx={t} />, hideBelow: 'lg' },
    { key: 'date', header: 'Date', cell: (t) => <span className="whitespace-nowrap tabular">{dateTime(t.paymentCreatedAt)}</span>, hideBelow: 'md' },
    {
      key: 'status',
      header: 'Status',
      cell: (t) => (
        <div className="flex flex-col items-start gap-1">
          <TxStatusBadge status={t.status} />
          {t.errorDescription && <span className="max-w-48 truncate text-[11px] text-red-700 dark:text-red-400" title={t.errorDescription}>{t.errorDescription}</span>}
        </div>
      ),
    },
  ];

  return (
    <>
      <PageIntro description="Every Razorpay payment for Ankveda subscriptions — trial charges, first charges, renewals, failures and refunds. Revenue counts successful payments only, net of refunds; manual grants are never revenue." />
      <section className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={Wallet} accent="gold" label="Total successful payments" loading={overview.isLoading} value={rupees(r?.totalInPaise)} caption={r && `${number(r.successfulPayments)} payments · ${rupees(r.refundedInPaise)} refunded`} />
        <StatCard
          icon={CalendarDays}
          label="Revenue this month"
          loading={overview.isLoading}
          value={rupees(r?.thisMonthInPaise)}
          change={r ? pctChange(r.thisMonthInPaise, r.lastMonthInPaise) : undefined}
          changeLabel="vs last month"
        />
        <StatCard
          icon={IndianRupee}
          accent="green"
          label="Today's revenue"
          loading={overview.isLoading}
          value={rupees(r?.todayInPaise)}
          change={r ? pctChange(r.todayInPaise, r.yesterdayInPaise) : undefined}
          changeLabel="vs yesterday"
        />
        <StatCard
          icon={TrendingUp}
          accent="blue"
          label="Average transaction value"
          loading={overview.isLoading}
          value={r && r.successfulPayments ? rupees(Math.round(r.totalInPaise / r.successfulPayments)) : '—'}
          caption={r && `${number(r.failedPayments7d)} failed in the last 7 days`}
        />
      </section>
      <Card>
        <div className="flex flex-col gap-3 border-b border-line p-4 lg:flex-row lg:items-center lg:justify-between">
          <Segmented
            label="Payment status"
            value={filters.filter}
            onChange={(v) => set('filter', v)}
            options={[
              { value: 'all', label: 'All' },
              { value: 'captured', label: 'Successful' },
              { value: 'failed', label: 'Failed' },
              { value: 'refunded', label: 'Refunded' },
            ]}
          />
          <div className="flex flex-wrap items-center gap-1.5">
            <Input type="date" aria-label="From date" max={istKey()} value={filters.from ?? ''} onChange={(e) => set('from', e.target.value)} className="h-10 w-[150px]" />
            <span className="text-ink-3">–</span>
            <Input type="date" aria-label="To date" max={istKey()} value={filters.to ?? ''} onChange={(e) => set('to', e.target.value)} className="h-10 w-[150px]" />
            {(filters.from || filters.to) && (
              <button
                type="button"
                className="h-10 rounded-lg px-3 text-[13px] font-semibold text-link hover:bg-sky-50 dark:hover:bg-sky-500/10"
                onClick={() =>
                  setParams((p) => {
                    p.delete('from');
                    p.delete('to');
                    return p;
                  })
                }
              >
                Clear dates
              </button>
            )}
          </div>
        </div>
        <DataTable
          columns={columns}
          rows={list.items}
          rowKey={(t) => t.id}
          loading={list.isLoading}
          fetching={list.isFetching}
          error={list.error}
          onRetry={() => void list.refetch()}
          onRowClick={(t) => openUser(t.userId)}
          rowLabel={(t) => `Payment ${t.razorpayPaymentId}`}
          empty={{ icon: Receipt, title: 'No payments match these filters' }}
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
    </>
  );
};
