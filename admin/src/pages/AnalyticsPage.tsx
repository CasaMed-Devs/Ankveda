import { useMemo, useState } from 'react';

import { rollup, SERIES, TimeChart, type Grain } from '@/components/charts/Charts';
import { PageIntro } from '@/components/layout/Page';
import { Card, CardHeader } from '@/components/ui/Card';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { ErrorState, Skeleton } from '@/components/ui/Feedback';
import { DateRangeFilter, rangeFor, Segmented, type DateRange } from '@/components/ui/Form';
import { number, pctChange, rupees } from '@/lib/format';
import type { DayStat } from '@/lib/types';
import { defaultGrain, useRangeSeries } from './Dashboard';

const compactRupees = (v: number) => `₹${new Intl.NumberFormat('en-IN', { notation: 'compact' }).format(v)}`;

type Bucket = DayStat & { label: string };

export const AnalyticsPage = () => {
  const [range, setRange] = useState<DateRange>(() => rangeFor('90d'));
  const series = useRangeSeries(range);
  const [grainChoice, setGrain] = useState<Grain | null>(null);
  const grain = grainChoice ?? defaultGrain(series.length);
  const data = useMemo(() => rollup(series.current, grain).map((d) => ({ ...d, revenue: d.revenueInPaise / 100 })), [series.current, grain]);
  const [view, setView] = useState<'charts' | 'table'>('charts');

  const totals = useMemo(() => {
    const t = (rows: DayStat[]) => ({
      registrations: rows.reduce((s, d) => s + d.registrations, 0),
      revenue: rows.reduce((s, d) => s + d.revenueInPaise, 0),
      payments: rows.reduce((s, d) => s + d.payments, 0),
      failed: rows.reduce((s, d) => s + d.failedPayments, 0),
      subs: rows.reduce((s, d) => s + d.newSubscriptions, 0),
      grants: rows.reduce((s, d) => s + d.grants, 0),
    });
    return { now: t(series.current), prev: series.previous ? t(series.previous) : null };
  }, [series.current, series.previous]);

  const successRate = totals.now.payments + totals.now.failed > 0 ? (totals.now.payments / (totals.now.payments + totals.now.failed)) * 100 : null;
  const columns: Column<Bucket>[] = [
    { key: 'label', header: grain === 'day' ? 'Day' : grain === 'week' ? 'Week' : 'Month', cell: (d) => <span className="font-medium text-ink">{d.label}</span> },
    { key: 'reg', header: 'New users', align: 'right', cell: (d) => number(d.registrations) },
    { key: 'subs', header: 'Subscriptions', align: 'right', cell: (d) => number(d.newSubscriptions) },
    { key: 'grants', header: 'Grants', align: 'right', cell: (d) => number(d.grants) },
    { key: 'pay', header: 'Payments', align: 'right', cell: (d) => number(d.payments) },
    { key: 'fail', header: 'Failed', align: 'right', cell: (d) => number(d.failedPayments) },
    { key: 'rev', header: 'Revenue', align: 'right', cell: (d) => rupees(d.revenueInPaise) },
  ];

  const kpi = (label: string, value: string, now: number, prev: number | undefined) => {
    const change = prev === undefined ? undefined : pctChange(now, prev);
    return (
      <div>
        <p className="text-[12px] font-medium text-ink-3">{label}</p>
        <p className="text-xl font-semibold text-ink tabular">{value}</p>
        {change !== undefined && (
          <p className="text-[12px] text-ink-3">{change === null ? 'no prior data' : `${change >= 0 ? '▲' : '▼'} ${Math.abs(change).toFixed(1)}% vs previous`}</p>
        )}
      </div>
    );
  };

  return (
    <>
      <PageIntro
        description="Trends from precomputed daily statistics (IST days). Past days are aggregated once and cached; recent days refresh automatically."
        actions={
          <Segmented
            label="View"
            value={view}
            onChange={setView}
            options={[
              { value: 'charts', label: 'Charts' },
              { value: 'table', label: 'Table' },
            ]}
          />
        }
      />
      <Card className="mb-6">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3.5">
          <DateRangeFilter value={range} onChange={setRange} />
          <Segmented
            size="sm"
            label="Interval"
            value={grain}
            onChange={setGrain}
            options={[
              { value: 'day', label: 'Daily' },
              { value: 'week', label: 'Weekly' },
              { value: 'month', label: 'Monthly' },
            ]}
          />
        </div>
        <div className="grid grid-cols-2 gap-5 px-5 py-4 md:grid-cols-3 xl:grid-cols-6">
          {series.isLoading ? (
            Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-14" />)
          ) : (
            <>
              {kpi('New users', number(totals.now.registrations), totals.now.registrations, totals.prev?.registrations)}
              {kpi('Revenue (net)', rupees(totals.now.revenue), totals.now.revenue, totals.prev?.revenue)}
              {kpi('Successful payments', number(totals.now.payments), totals.now.payments, totals.prev?.payments)}
              {kpi('Subscriptions started', number(totals.now.subs), totals.now.subs, totals.prev?.subs)}
              {kpi('Manual grants', number(totals.now.grants), totals.now.grants, totals.prev?.grants)}
              <div>
                <p className="text-[12px] font-medium text-ink-3">Payment success rate</p>
                <p className="text-xl font-semibold text-ink tabular">{successRate === null ? '—' : `${successRate.toFixed(1)}%`}</p>
                <p className="text-[12px] text-ink-3">{number(totals.now.failed)} failed</p>
              </div>
            </>
          )}
        </div>
      </Card>

      {series.error ? (
        <ErrorState error={series.error} onRetry={() => void series.refetch()} />
      ) : view === 'table' ? (
        <Card>
          <DataTable columns={columns} rows={data} rowKey={(d) => d.date} loading={series.isLoading} empty={{ title: 'No data in this range' }} />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          {[
            {
              title: 'User registrations',
              description: 'New accounts',
              chart: <TimeChart kind="area" height={300} data={data} series={[{ key: 'registrations', name: 'New users', color: SERIES[0]! }]} />,
            },
            {
              title: 'Revenue',
              description: 'Successful payments net of refunds',
              chart: <TimeChart height={300} data={data} yFormat={compactRupees} series={[{ key: 'revenue', name: 'Revenue', color: SERIES[0]!, format: (v) => rupees(v * 100) }]} />,
            },
            {
              title: 'Payments',
              description: 'Successful vs failed attempts',
              chart: (
                <TimeChart
                  stacked
                  height={300}
                  data={data}
                  series={[
                    { key: 'payments', name: 'Successful', color: SERIES[0]! },
                    { key: 'failedPayments', name: 'Failed', color: SERIES[1]! },
                  ]}
                />
              ),
            },
            {
              title: 'Subscriptions',
              description: 'Started via Razorpay vs granted by admins',
              chart: (
                <TimeChart
                  stacked
                  height={300}
                  data={data}
                  series={[
                    { key: 'newSubscriptions', name: 'Purchased', color: SERIES[0]! },
                    { key: 'grants', name: 'Granted', color: SERIES[1]! },
                  ]}
                />
              ),
            },
          ].map((c) => (
            <Card key={c.title}>
              <CardHeader title={c.title} description={c.description} />
              <div className="px-3 pb-4">{series.isLoading ? <Skeleton className="mx-2 h-[300px]" /> : c.chart}</div>
            </Card>
          ))}
        </div>
      )}
    </>
  );
};
