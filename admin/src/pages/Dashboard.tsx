import {
  ArrowRight,
  CircleCheck,
  CreditCard,
  Hourglass,
  IndianRupee,
  RefreshCw,
  ShoppingBag,
  Sparkles,
  UserPlus,
  Users,
  UserX,
} from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router';

import { BarList, rollup, SERIES, TimeChart, type Grain } from '@/components/charts/Charts';
import { PageIntro, useOpenUser, UserCell } from '@/components/layout/Page';
import { AccessBadge, SubStatusBadge, TxStatusBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { ErrorState, Skeleton } from '@/components/ui/Feedback';
import { DateRangeFilter, rangeFor, Segmented, type DateRange } from '@/components/ui/Form';
import { useToast } from '@/components/ui/Overlay';
import { StatCard } from '@/components/ui/StatCard';
import { errorMessage } from '@/lib/api';
import { addDays, date, daysBetween, number, pctChange, relative, rupees } from '@/lib/format';
import { useActivity, useOverview, useRefreshOverview, useSeries } from '@/lib/queries';
import type { DayStat } from '@/lib/types';

const sum = (days: DayStat[], key: keyof Omit<DayStat, 'date'>) => days.reduce((s, d) => s + d[key], 0);
export const defaultGrain = (days: number): Grain => (days <= 31 ? 'day' : days <= 120 ? 'week' : 'month');

/** Fetches the range and, when it fits, the previous equal-length range in ONE request. */
export const useRangeSeries = (range: DateRange) => {
  const length = daysBetween(range.from, range.to);
  const compare = length <= 183;
  const fetchFrom = compare ? addDays(range.from, -length) : range.from;
  const series = useSeries(fetchFrom, range.to);
  const all = series.data ?? [];
  const current = all.filter((d) => d.date >= range.from);
  const previous = compare ? all.filter((d) => d.date < range.from) : null;
  return { ...series, current, previous, length };
};

const RangeDelta = ({ label, value, prev, format = number }: { label: string; value: number; prev: number | null; format?: (n: number) => string }) => {
  const change = prev === null ? undefined : pctChange(value, prev);
  return (
    <div className="min-w-0">
      <p className="text-[12px] font-medium text-ink-3">{label}</p>
      <p className="mt-0.5 flex flex-wrap items-baseline gap-x-2 text-lg font-semibold text-ink tabular">
        {format(value)}
        {change !== undefined && (
          <span className={change === null ? 'text-[12px] font-medium text-ink-3' : change >= 0 ? 'text-[12px] font-semibold text-emerald-700 dark:text-emerald-400' : 'text-[12px] font-semibold text-red-700 dark:text-red-400'}>
            {change === null ? 'no prior data' : `${change >= 0 ? '▲' : '▼'} ${Math.abs(change).toFixed(1)}%`}
          </span>
        )}
      </p>
    </div>
  );
};

const ActivityList = ({ title, to, loading, children, empty }: { title: string; to: string; loading: boolean; children: ReactNode[]; empty: string }) => (
  <Card className="flex flex-col">
    <CardHeader
      title={title}
      actions={
        <Link to={to} className="inline-flex items-center gap-1 text-[12px] font-semibold text-link hover:underline">
          View all <ArrowRight className="size-3.5" />
        </Link>
      }
    />
    <ul className="flex-1 px-2 pb-2">
      {loading
        ? Array.from({ length: 4 }, (_, i) => (
            <li key={i} className="flex items-center gap-3 px-3 py-2.5">
              <Skeleton className="size-8 rounded-full" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3.5 w-1/2" />
                <Skeleton className="h-3 w-1/3" />
              </div>
            </li>
          ))
        : children.length
          ? children
          : [
              <li key="empty" className="px-3 py-6 text-center text-[13px] text-ink-3">
                {empty}
              </li>,
            ]}
    </ul>
  </Card>
);

const Row = ({ onClick, left, right }: { onClick: () => void; left: ReactNode; right: ReactNode }) => (
  <li>
    <button type="button" onClick={onClick} className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-surface-2">
      <div className="min-w-0 flex-1">{left}</div>
      <div className="shrink-0 text-right">{right}</div>
    </button>
  </li>
);

export const DashboardPage = () => {
  const overview = useOverview();
  const refresh = useRefreshOverview();
  const activity = useActivity();
  const toast = useToast();
  const openUser = useOpenUser();
  const [range, setRange] = useState<DateRange>(() => rangeFor('30d'));
  const series = useRangeSeries(range);
  const [growthGrain, setGrowthGrain] = useState<Grain | null>(null);
  const [revenueGrain, setRevenueGrain] = useState<Grain | null>(null);
  const autoGrain = defaultGrain(series.length);

  const o = overview.data;
  const loading = overview.isLoading;
  const growth = useMemo(() => rollup(series.current, growthGrain ?? autoGrain), [series.current, growthGrain, autoGrain]);
  const revenue = useMemo(
    () => rollup(series.current, revenueGrain ?? autoGrain).map((d) => ({ ...d, revenue: d.revenueInPaise / 100 })),
    [series.current, revenueGrain, autoGrain],
  );
  const subs = useMemo(() => rollup(series.current, autoGrain), [series.current, autoGrain]);
  const prev = series.previous;

  const doRefresh = () =>
    refresh.mutate(undefined, {
      onSuccess: () => toast.success('Dashboard refreshed', 'Figures were recomputed from Firestore.'),
      onError: (e) => toast.error('Refresh failed', errorMessage(e)),
    });

  if (overview.error && !o) return <ErrorState error={overview.error} onRetry={() => void overview.refetch()} />;

  const activeSubscribers = o ? o.access.paid + o.access.granted + o.access.cancelling : 0;
  const totalBefore = o ? o.users.total - o.users.thisMonth : 0;

  return (
    <>
      <PageIntro
        description={
          o ? (
            <>
              Live figures aggregated from Firestore · computed {relative(o.computedAt)}
              {o.cached ? ' (cached)' : ''}
            </>
          ) : (
            'Loading figures…'
          )
        }
        actions={
          <Button size="sm" icon={RefreshCw} onClick={doRefresh} loading={refresh.isPending}>
            Refresh
          </Button>
        }
      />

      <section aria-label="Key figures" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={Users}
          label="Total registered users"
          loading={loading}
          value={number(o?.users.total)}
          change={o ? pctChange(o.users.total, totalBefore) : undefined}
          changeLabel="growth this month"
        />
        <StatCard
          icon={CircleCheck}
          accent="green"
          label="Active subscribers"
          loading={loading}
          value={number(activeSubscribers)}
          caption={o && `${number(o.access.paid)} paid · ${number(o.access.granted)} complimentary · ${number(o.access.cancelling)} cancelling`}
        />
        <StatCard icon={Sparkles} accent="blue" label="Free trial users" loading={loading} value={number(o?.access.trial)} caption="in a Razorpay trial now" />
        <StatCard icon={UserX} accent="red" label="Expired subscribers" loading={loading} value={number(o?.access.expired)} caption="subscribed before, no access now" />
        <StatCard
          icon={ShoppingBag}
          accent="violet"
          label="Subscription purchases"
          loading={loading}
          value={number(o?.subscriptions.purchases)}
          change={series.data && prev ? pctChange(sum(series.current, 'newSubscriptions'), sum(prev, 'newSubscriptions')) : undefined}
          changeLabel={series.data ? `${number(sum(series.current, 'newSubscriptions'))} in range` : undefined}
        />
        <StatCard
          icon={IndianRupee}
          accent="gold"
          label="Total revenue"
          loading={loading}
          value={rupees(o?.revenue.totalInPaise, { compact: true })}
          change={o ? pctChange(o.revenue.thisMonthInPaise, o.revenue.lastMonthInPaise) : undefined}
          changeLabel="this month vs last"
        />
        <StatCard
          icon={UserPlus}
          label="New users today"
          loading={loading}
          value={number(o?.users.today)}
          change={o ? pctChange(o.users.today, o.users.yesterday) : undefined}
          changeLabel="vs yesterday"
        />
        <StatCard
          icon={CreditCard}
          label="New users this month"
          loading={loading}
          value={number(o?.users.thisMonth)}
          change={o ? pctChange(o.users.thisMonth, o.users.lastMonth) : undefined}
          changeLabel="vs last month"
        />
      </section>

      <Card className="mt-6">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3.5">
          <div>
            <h2 className="text-[15px] font-semibold">Performance</h2>
            <p className="text-[12px] text-ink-3">
              {date(Date.parse(`${range.from}T00:00:00+05:30`))} – {date(Date.parse(`${range.to}T00:00:00+05:30`))} (IST){prev ? ' · compared with the previous period' : ''}
            </p>
          </div>
          <DateRangeFilter value={range} onChange={setRange} />
        </div>
        <div className="grid grid-cols-2 gap-4 px-5 py-4 md:grid-cols-4">
          {series.isLoading ? (
            Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-12" />)
          ) : (
            <>
              <RangeDelta label="New users" value={sum(series.current, 'registrations')} prev={prev ? sum(prev, 'registrations') : null} />
              <RangeDelta label="Revenue (net)" value={sum(series.current, 'revenueInPaise')} prev={prev ? sum(prev, 'revenueInPaise') : null} format={(n) => rupees(n)} />
              <RangeDelta label="Subscriptions started" value={sum(series.current, 'newSubscriptions')} prev={prev ? sum(prev, 'newSubscriptions') : null} />
              <RangeDelta label="Failed payments" value={sum(series.current, 'failedPayments')} prev={prev ? sum(prev, 'failedPayments') : null} />
            </>
          )}
        </div>
        {series.error && <ErrorState error={series.error} onRetry={() => void series.refetch()} className="py-6" />}
      </Card>

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader
            title="User growth"
            description="New registrations"
            actions={
              <Segmented
                size="sm"
                label="User growth interval"
                value={growthGrain ?? autoGrain}
                onChange={setGrowthGrain}
                options={[
                  { value: 'day', label: 'Daily' },
                  { value: 'week', label: 'Weekly' },
                  { value: 'month', label: 'Monthly' },
                ]}
              />
            }
          />
          <div className="px-3 pb-4">
            {series.isLoading ? <Skeleton className="mx-2 h-[260px]" /> : <TimeChart kind="area" data={growth} series={[{ key: 'registrations', name: 'New users', color: SERIES[0]! }]} />}
          </div>
        </Card>
        <Card>
          <CardHeader
            title="Revenue"
            description={o ? `Net of refunds · ${rupees(o.revenue.totalInPaise)} collected all-time` : 'Net of refunds'}
            actions={
              <Segmented
                size="sm"
                label="Revenue interval"
                value={revenueGrain ?? autoGrain}
                onChange={setRevenueGrain}
                options={[
                  { value: 'day', label: 'Daily' },
                  { value: 'week', label: 'Weekly' },
                  { value: 'month', label: 'Monthly' },
                ]}
              />
            }
          />
          <div className="px-3 pb-4">
            {series.isLoading ? (
              <Skeleton className="mx-2 h-[260px]" />
            ) : (
              <TimeChart
                data={revenue}
                series={[{ key: 'revenue', name: 'Revenue', color: SERIES[0]!, format: (v) => rupees(v * 100) }]}
                yFormat={(v) => `₹${new Intl.NumberFormat('en-IN', { notation: 'compact' }).format(v)}`}
              />
            )}
          </div>
        </Card>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Subscription analytics" description="Subscriptions started in the range — paid checkouts vs complimentary grants" />
          <div className="px-3 pb-4">
            {series.isLoading ? (
              <Skeleton className="mx-2 h-[240px]" />
            ) : (
              <TimeChart
                stacked
                height={240}
                data={subs}
                series={[
                  { key: 'newSubscriptions', name: 'Purchased (Razorpay)', color: SERIES[0]! },
                  { key: 'grants', name: 'Granted by admin', color: SERIES[1]! },
                ]}
              />
            )}
          </div>
        </Card>
        <Card>
          <CardHeader title="Subscription status" description="Every user, by access right now" />
          <div className="px-5 pb-5">
            {loading || !o ? (
              <Skeleton className="h-48" />
            ) : (
              <BarList
                items={[
                  { label: 'Active (paid)', value: o.access.paid, color: SERIES[0] },
                  { label: 'Free trial', value: o.access.trial, color: SERIES[1] },
                  { label: 'Complimentary', value: o.access.granted, color: SERIES[2] },
                  { label: 'Cancelled — access until period end', value: o.access.cancelling, color: SERIES[3] },
                  { label: 'Expired', value: o.access.expired, color: SERIES[4] },
                ]}
              />
            )}
          </div>
        </Card>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader title="Subscription distribution" description="Users with access, by type" />
          <div className="px-5 pb-5">
            {loading || !o ? (
              <Skeleton className="h-32" />
            ) : (
              <BarList
                items={[
                  { label: 'Free trial', value: o.access.trial, color: SERIES[1] },
                  { label: 'Paid subscription', value: o.access.paid + o.access.cancelling, color: SERIES[0] },
                  { label: 'Complimentary (admin grant)', value: o.access.granted, color: SERIES[2] },
                ]}
                emptyText="No one has access yet"
              />
            )}
          </div>
        </Card>
        <Card>
          <CardHeader title="By plan" description="Users with access on each plan (incl. trial)" />
          <div className="px-5 pb-5">
            {loading || !o ? (
              <Skeleton className="h-32" />
            ) : (
              <BarList
                items={[...o.plans]
                  .sort((a, b) => b.subscribers - a.subscribers)
                  .slice(0, 4)
                  .map((p, i) => ({ label: p.name, value: p.subscribers, color: SERIES[i] }))
                  .concat(
                    o.plans.length > 4
                      ? [{ label: 'Other plans', value: [...o.plans].sort((a, b) => b.subscribers - a.subscribers).slice(4).reduce((s, p) => s + p.subscribers, 0), color: 'var(--color-ink-3)' }]
                      : [],
                  )}
                emptyText="No subscribers on any plan yet"
              />
            )}
          </div>
        </Card>
        <Card>
          <CardHeader title="Payments" description="Successful Razorpay payments only — grants are never revenue" />
          <div className="grid grid-cols-2 gap-4 px-5 pb-5">
            {loading || !o ? (
              <Skeleton className="col-span-2 h-32" />
            ) : (
              <>
                <RangeDelta label="Today" value={o.revenue.todayInPaise} prev={o.revenue.yesterdayInPaise} format={(n) => rupees(n)} />
                <RangeDelta label="This month" value={o.revenue.thisMonthInPaise} prev={o.revenue.lastMonthInPaise} format={(n) => rupees(n)} />
                <RangeDelta label="Successful payments" value={o.revenue.successfulPayments} prev={null} />
                <RangeDelta label="Failed (7 days)" value={o.revenue.failedPayments7d} prev={null} />
              </>
            )}
          </div>
        </Card>
      </div>

      <section aria-label="Recent activity" className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-2 2xl:grid-cols-4">
        <ActivityList title="Recently registered" to="/users" loading={activity.isLoading} empty="No users yet">
          {(activity.data?.recentUsers ?? []).map((u) => (
            <Row key={u.id} onClick={() => openUser(u.id)} left={<UserCell name={u.name} phone={u.phone} />} right={<span className="text-[12px] text-ink-3">{relative(u.createdAt)}</span>} />
          ))}
        </ActivityList>
        <ActivityList title="Recent purchases" to="/subscriptions" loading={activity.isLoading} empty="No purchases yet">
          {(activity.data?.recentPurchases ?? []).map((s) => (
            <Row
              key={s.id}
              onClick={() => openUser(s.userId)}
              left={<UserCell name={s.userName} phone={s.userPhone} sub={s.planName} />}
              right={
                <div className="flex flex-col items-end gap-1">
                  <SubStatusBadge status={s.status} />
                  <span className="text-[11px] text-ink-3">{relative(s.createdAt)}</span>
                </div>
              }
            />
          ))}
        </ActivityList>
        <ActivityList title="Recently expired" to="/users?status=expired" loading={activity.isLoading} empty="No expired subscriptions">
          {(activity.data?.recentlyExpired ?? []).map((u) => (
            <Row
              key={u.id}
              onClick={() => openUser(u.id)}
              left={<UserCell name={u.name} phone={u.phone} sub={u.entitlement?.planName ?? undefined} />}
              right={
                <div className="flex flex-col items-end gap-1">
                  <AccessBadge access={u.access} />
                  <span className="text-[11px] text-ink-3">
                    <Hourglass className="mr-0.5 inline size-3" aria-hidden />
                    {relative(u.entitlement?.currentPeriodEnd)}
                  </span>
                </div>
              }
            />
          ))}
        </ActivityList>
        <ActivityList title="Latest payments" to="/payments" loading={activity.isLoading} empty="No payments yet">
          {(activity.data?.latestPayments ?? []).map((t) => (
            <Row
              key={t.id}
              onClick={() => openUser(t.userId)}
              left={<UserCell name={t.userName} phone={t.userPhone} sub={relative(t.paymentCreatedAt)} />}
              right={
                <div className="flex flex-col items-end gap-1">
                  <span className="text-[13px] font-semibold text-ink tabular">{rupees(t.amountInPaise)}</span>
                  <TxStatusBadge status={t.status} />
                </div>
              }
            />
          ))}
        </ActivityList>
      </section>
    </>
  );
};
