import { ScrollText } from 'lucide-react';
import { useMemo, useState } from 'react';

import { PageIntro, useOpenUser } from '@/components/layout/Page';
import { Badge, type Tone } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { DataTable, Pagination, type Column } from '@/components/ui/DataTable';
import { CopyText } from '@/components/ui/Feedback';
import { Select } from '@/components/ui/Form';
import { dateTime, relative, rupees } from '@/lib/format';
import { fetchAudit, usePagedList } from '@/lib/queries';
import type { AuditAction, AuditRow } from '@/lib/types';

const ACTIONS: Record<AuditAction, { label: string; tone: Tone }> = {
  'account.self_delete': { label: 'Account deleted by user', tone: 'warning' },
  'admin.login': { label: 'Admin login', tone: 'neutral' },
  'plan.create': { label: 'Plan created', tone: 'info' },
  'plan.update': { label: 'Plan changed', tone: 'info' },
  'pricing.update': { label: 'Pricing updated', tone: 'gold' },
  'subscription.grant': { label: 'Subscription granted', tone: 'violet' },
  'subscription.expire': { label: 'Subscription expired', tone: 'danger' },
  'subscription.cancel_renewal': { label: 'Renewal cancelled', tone: 'warning' },
  'user.delete': { label: 'User deleted', tone: 'danger' },
  'maintenance.run': { label: 'Maintenance', tone: 'neutral' },
};

export const auditLabel = (a: AuditAction) => ACTIONS[a]?.label ?? a;

const fmt = (key: string, value: unknown): string => {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number' && /InPaise$/.test(key)) return rupees(value);
  if (typeof value === 'number' && /At$/.test(key) && value > 1e12) return dateTime(value);
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
};

const HIDDEN = new Set(['before', 'after', 'ip']);

/** Human-readable details. Pricing changes are shown as before → after. */
export const AuditDetails = ({ row }: { row: AuditRow }) => {
  const d = row.details ?? {};
  const before = d.before as Record<string, unknown> | null | undefined;
  const after = d.after as Record<string, unknown> | undefined;
  const changed = after ? Object.keys(after).filter((k) => JSON.stringify(before?.[k]) !== JSON.stringify(after[k])) : [];
  const rest = Object.entries(d).filter(([k, v]) => !HIDDEN.has(k) && v !== null && v !== undefined && v !== '');
  return (
    <div className="mt-1 space-y-0.5 text-[12px] text-ink-2">
      {changed.map((k) => (
        <p key={k}>
          <span className="text-ink-3">{k}:</span> {before ? `${fmt(k, before[k])} → ` : ''}
          <strong>{fmt(k, after![k])}</strong>
        </p>
      ))}
      {rest.map(([k, v]) => (
        <p key={k}>
          <span className="text-ink-3">{k}:</span> {fmt(k, v)}
        </p>
      ))}
    </div>
  );
};

export const ActivityPage = () => {
  const [action, setAction] = useState('');
  const filters = useMemo(() => ({ action: action || undefined }), [action]);
  const list = usePagedList('audit', filters, fetchAudit);
  const openUser = useOpenUser();

  const columns: Column<AuditRow>[] = [
    {
      key: 'action',
      header: 'Action',
      cell: (a) => <Badge tone={ACTIONS[a.action]?.tone ?? 'neutral'}>{auditLabel(a.action)}</Badge>,
    },
    {
      key: 'admin',
      header: 'Admin',
      cell: (a) =>
        a.actor ? (
          <div className="min-w-0">
            <p className="truncate font-medium text-ink">{a.actor.email ?? '—'}</p>
            <CopyText value={a.actor.uid} className="max-w-40" />
          </div>
        ) : (
          <span className="text-ink-3" title="Recorded before admin accounts existed (shared password)">
            Legacy admin
          </span>
        ),
    },
    {
      key: 'target',
      header: 'Target user',
      cell: (a) =>
        a.targetUserId ? (
          a.action === 'user.delete' ? (
            <CopyText value={a.targetUserId} className="max-w-40" />
          ) : (
            <button type="button" className="font-mono text-[12px] text-link hover:underline" onClick={() => openUser(a.targetUserId!)}>
              {a.targetUserId}
            </button>
          )
        ) : (
          <span className="text-ink-3">—</span>
        ),
      hideBelow: 'md',
    },
    { key: 'details', header: 'Details', cell: (a) => <AuditDetails row={a} />, className: 'min-w-64' },
    {
      key: 'when',
      header: 'When',
      cell: (a) => (
        <div className="whitespace-nowrap">
          <p className="text-ink tabular">{dateTime(a.createdAt)}</p>
          <p className="text-[12px] text-ink-3">{relative(a.createdAt)}</p>
        </div>
      ),
    },
  ];

  return (
    <>
      <PageIntro
        description="Every administrative action, written by the server in the same transaction as the change. Clients cannot create, edit or delete entries."
        actions={
          <Select aria-label="Filter by action" value={action} onChange={(e) => setAction(e.target.value)} className="w-56">
            <option value="">All actions</option>
            {(Object.keys(ACTIONS) as AuditAction[]).map((a) => (
              <option key={a} value={a}>
                {ACTIONS[a].label}
              </option>
            ))}
          </Select>
        }
      />
      <Card>
        <DataTable
          columns={columns}
          rows={list.items}
          rowKey={(a) => a.id}
          loading={list.isLoading}
          fetching={list.isFetching}
          error={list.error}
          onRetry={() => void list.refetch()}
          empty={{ icon: ScrollText, title: 'No admin activity yet' }}
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
