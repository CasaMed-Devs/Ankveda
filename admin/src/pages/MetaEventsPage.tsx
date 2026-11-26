import { Megaphone } from 'lucide-react';
import { useMemo, useState } from 'react';

import { PageIntro, useOpenUser } from '@/components/layout/Page';
import { Badge, type Tone } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { DataTable, Pagination, type Column } from '@/components/ui/DataTable';
import { CopyText } from '@/components/ui/Feedback';
import { Select } from '@/components/ui/Form';
import { dateTime, relative, rupees } from '@/lib/format';
import { fetchMetaEvents, useMetaEventSummary, usePagedList } from '@/lib/queries';
import type { MetaEventName, MetaEventRow } from '@/lib/types';

const EVENTS: Record<MetaEventName, { label: string; tone: Tone }> = {
  CompleteRegistration: { label: 'Complete registration', tone: 'info' },
  Login: { label: 'Login', tone: 'neutral' },
  ViewContent: { label: 'View content (paywall)', tone: 'neutral' },
  InitiatedCheckout: { label: 'Initiated checkout', tone: 'warning' },
  Purchase: { label: 'Purchase', tone: 'success' },
};

const EXTRA_KEYS = ['planId', 'subscriptionId', 'contentType', 'method'] as const;

export const MetaEventsPage = () => {
  const [event, setEvent] = useState('');
  const filters = useMemo(() => ({ event: event || undefined }), [event]);
  const list = usePagedList('meta-events', filters, fetchMetaEvents);
  const summary = useMetaEventSummary();
  const openUser = useOpenUser();

  const columns: Column<MetaEventRow>[] = [
    { key: 'event', header: 'Event', cell: (e) => <Badge tone={EVENTS[e.event]?.tone ?? 'neutral'}>{EVENTS[e.event]?.label ?? e.event}</Badge> },
    {
      key: 'user',
      header: 'User',
      cell: (e) => (
        <button type="button" className="font-mono text-[12px] text-link hover:underline" onClick={() => openUser(e.userId)}>
          {e.userId}
        </button>
      ),
    },
    {
      key: 'value',
      header: 'Value',
      cell: (e) => (e.value !== null ? <span className="tabular">{e.currency === 'INR' || !e.currency ? rupees(e.value * 100) : `${e.value} ${e.currency}`}</span> : <span className="text-ink-3">—</span>),
    },
    {
      key: 'details',
      header: 'Details',
      className: 'min-w-56',
      cell: (e) => (
        <div className="space-y-0.5 text-[12px] text-ink-2">
          {EXTRA_KEYS.filter((key) => e.params[key]).map((key) =>
            key === 'subscriptionId' ? (
              <p key={key}>
                <span className="text-ink-3">{key}:</span> <CopyText value={String(e.params[key])} className="inline-flex max-w-44" />
              </p>
            ) : (
              <p key={key}>
                <span className="text-ink-3">{key}:</span> {String(e.params[key])}
              </p>
            ),
          )}
          <p className="text-ink-3">
            {e.platform ?? '—'} · v{e.appVersion ?? '—'}
          </p>
        </div>
      ),
    },
    {
      key: 'when',
      header: 'When',
      cell: (e) => (
        <div className="whitespace-nowrap">
          <p className="text-ink tabular">{dateTime(e.createdAt)}</p>
          <p className="text-[12px] text-ink-3">{relative(e.createdAt)}</p>
        </div>
      ),
    },
  ];

  return (
    <>
      <PageIntro
        description="Events the app logged to Meta, copied to our server so they can be checked without Events Manager. This shows the app fired the event, not that Meta accepted it."
        actions={
          <Select aria-label="Filter by event" value={event} onChange={(e) => setEvent(e.target.value)} className="w-56">
            <option value="">All events</option>
            {(Object.keys(EVENTS) as MetaEventName[]).map((name) => (
              <option key={name} value={name}>
                {EVENTS[name].label}
              </option>
            ))}
          </Select>
        }
      />
      <Card className="mb-4 overflow-x-auto">
        <table className="w-full text-left text-[13px]">
          <thead>
            <tr className="text-ink-3">
              <th className="px-4 py-2 font-medium">Event</th>
              <th className="px-4 py-2 font-medium">Last 24 hours</th>
              <th className="px-4 py-2 font-medium">Last 7 days</th>
              <th className="px-4 py-2 font-medium">Last 30 days</th>
            </tr>
          </thead>
          <tbody>
            {(summary.data?.events ?? []).map((row) => (
              <tr key={row.event} className="border-t border-line">
                <td className="px-4 py-2 text-ink">{EVENTS[row.event]?.label ?? row.event}</td>
                <td className="px-4 py-2 tabular">{row.last24h}</td>
                <td className="px-4 py-2 tabular">{row.last7d}</td>
                <td className="px-4 py-2 tabular">{row.last30d}</td>
              </tr>
            ))}
            {summary.isLoading && (
              <tr>
                <td colSpan={4} className="px-4 py-3 text-ink-3">
                  Loading…
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {summary.data?.note && <p className="border-t border-line px-4 py-2 text-[12px] text-ink-3">{summary.data.note}</p>}
      </Card>
      <Card>
        <DataTable
          columns={columns}
          rows={list.items}
          rowKey={(e) => e.id}
          loading={list.isLoading}
          fetching={list.isFetching}
          error={list.error}
          onRetry={() => void list.refetch()}
          empty={{ icon: Megaphone, title: 'No Meta events yet' }}
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
