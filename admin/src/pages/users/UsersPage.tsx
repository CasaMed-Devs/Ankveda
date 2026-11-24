import { Ban, Funnel, Gift, Trash, Users as UsersIcon } from 'lucide-react';
import { useMemo } from 'react';
import { useSearchParams } from 'react-router';

import { PageIntro, useOpenUser, UserCell } from '@/components/layout/Page';
import { AccessBadge, SourceBadge } from '@/components/ui/Badge';
import { IconButton } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { CopyText, InlineAlert } from '@/components/ui/Feedback';
import { DataTable, Pagination, type Column } from '@/components/ui/DataTable';
import { Input, SearchInput, Select } from '@/components/ui/Form';
import { date, istKey } from '@/lib/format';
import { fetchUsers, usePagedList, usePlans, type UserFilters } from '@/lib/queries';
import type { UserRow } from '@/lib/types';
import { useUserActions, type ActionSubscription } from './UserActions';

const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'free', label: 'Free (never subscribed)' },
  { value: 'trial', label: 'Trial' },
  { value: 'active', label: 'Active (paid or complimentary)' },
  { value: 'granted', label: 'Manually granted' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'expired', label: 'Expired / halted' },
];

export const subscriptionOfRow = (u: UserRow): ActionSubscription | null =>
  u.entitlement?.subscriptionId
    ? {
        id: u.entitlement.subscriptionId,
        source: u.entitlement.source,
        status: u.entitlement.status,
        planName: u.entitlement.planName,
        expiresAt: u.entitlement.currentPeriodEnd,
        cancelAtPeriodEnd: u.entitlement.cancelAtPeriodEnd,
      }
    : null;

export const UsersPage = () => {
  const [params, setParams] = useSearchParams();
  const openUser = useOpenUser();
  const plans = usePlans();
  const actions = useUserActions();

  // Filters live in the URL: shareable, survive reloads and the global search box.
  const filters: UserFilters = useMemo(
    () => ({
      q: params.get('q') ?? undefined,
      status: params.get('status') ?? undefined,
      planId: params.get('plan') ?? undefined,
      from: params.get('from') ?? undefined,
      to: params.get('to') ?? undefined,
    }),
    [params],
  );
  const setFilter = (key: string, value: string) =>
    setParams((p) => {
      if (value) p.set(key, value);
      else p.delete(key);
      return p;
    });

  const list = usePagedList('users', filters, fetchUsers);
  const searching = !!filters.q;
  const filtered = !!(filters.status || filters.planId || filters.from || filters.to);

  const columns: Column<UserRow>[] = [
    { key: 'user', header: 'User', cell: (u) => <UserCell name={u.name} phone={u.phone} />, className: 'min-w-52' },
    { key: 'id', header: 'User ID', cell: (u) => <CopyText value={u.id} className="max-w-36" />, hideBelow: 'xl' },
    { key: 'registered', header: 'Registered', cell: (u) => <span className="whitespace-nowrap tabular">{date(u.createdAt)}</span>, hideBelow: 'md' },
    {
      key: 'plan',
      header: 'Plan',
      cell: (u) =>
        u.entitlement?.planName ? (
          <div className="flex flex-col items-start gap-1">
            <span className="font-medium text-ink">{u.entitlement.planName}</span>
            {u.entitlement.source === 'admin_grant' && <SourceBadge source="admin_grant" />}
          </div>
        ) : (
          <span className="text-ink-3">—</span>
        ),
      hideBelow: 'sm',
    },
    { key: 'status', header: 'Subscription', cell: (u) => <AccessBadge access={u.access} /> },
    { key: 'start', header: 'Started', cell: (u) => <span className="whitespace-nowrap tabular">{date(u.subscriptionStartAt)}</span>, hideBelow: '2xl' },
    {
      key: 'expiry',
      header: 'Expires',
      cell: (u) => <span className="whitespace-nowrap tabular">{date(u.entitlement?.currentPeriodEnd)}</span>,
      hideBelow: 'lg',
    },
    {
      key: 'account',
      header: 'Account',
      cell: (u) => (u.profileComplete ? <span className="text-[12px] font-medium text-emerald-700 dark:text-emerald-400">Active</span> : <span className="text-[12px] text-ink-3">Profile incomplete</span>),
      hideBelow: '2xl',
    },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      align: 'right',
      hideBelow: 'sm',
      cell: (u) => (
        <div className="flex justify-end gap-0.5" onClick={(e) => e.stopPropagation()}>
          <IconButton icon={Gift} label="Grant subscription" onClick={() => actions.open('grant', u)} />
          <IconButton icon={Ban} label="Expire subscription" disabled={!u.entitlement?.subscriptionId} onClick={() => actions.open('expire', u, subscriptionOfRow(u))} />
          <IconButton icon={Trash} label="Delete user" className="hover:bg-red-50 dark:hover:bg-red-500/10 hover:text-red-700 dark:hover:text-red-300" onClick={() => actions.open('delete', u)} />
        </div>
      ),
    },
  ];

  return (
    <>
      <PageIntro description="Every registered app user. App users sign in with a phone number and OTP — search by name, phone number or user ID." />
      <Card>
        <div className="flex flex-col gap-3 border-b border-line p-4 lg:flex-row lg:items-center">
          <SearchInput value={filters.q ?? ''} onChange={(v) => setFilter('q', v)} placeholder="Search name, phone or user ID" className="lg:w-80" />
          <div className="flex flex-1 flex-wrap items-center gap-2">
            <Funnel className="hidden size-4 text-ink-3 lg:block" aria-hidden />
            <Select aria-label="Subscription status" value={filters.status ?? ''} onChange={(e) => setFilter('status', e.target.value)} disabled={searching} className="w-full sm:w-56">
              {STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
            <Select aria-label="Plan" value={filters.planId ?? ''} onChange={(e) => setFilter('plan', e.target.value)} disabled={searching} className="w-full sm:w-48">
              <option value="">All plans</option>
              {plans.data?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
            <div className="flex items-center gap-1.5">
              <Input type="date" aria-label="Registered from" max={istKey()} value={filters.from ?? ''} onChange={(e) => setFilter('from', e.target.value)} disabled={searching} className="h-10 w-[150px]" />
              <span className="text-ink-3">–</span>
              <Input type="date" aria-label="Registered until" max={istKey()} value={filters.to ?? ''} onChange={(e) => setFilter('to', e.target.value)} disabled={searching} className="h-10 w-[150px]" />
            </div>
            {(filtered || searching) && (
              <button
                type="button"
                onClick={() => setParams(new URLSearchParams())}
                className="h-10 rounded-lg px-3 text-[13px] font-semibold text-link hover:bg-sky-50 dark:hover:bg-sky-500/10"
              >
                Clear
              </button>
            )}
          </div>
        </div>
        {searching && filtered && (
          <InlineAlert tone="info" className="mx-4 mt-4">
            Filters are paused while searching. Clear the search to filter the full list.
          </InlineAlert>
        )}
        <DataTable
          columns={columns}
          rows={list.items}
          rowKey={(u) => u.id}
          loading={list.isLoading}
          fetching={list.isFetching}
          error={list.error}
          onRetry={() => void list.refetch()}
          onRowClick={(u) => openUser(u.id)}
          rowLabel={(u) => `Open ${u.name ?? u.phone}`}
          empty={{
            icon: UsersIcon,
            title: searching ? 'No users match this search' : filtered ? 'No users match these filters' : 'No users yet',
            body: searching ? 'Names match from the start (e.g. “Aar” finds “Aarav”). Phone numbers match from the first digit.' : undefined,
          }}
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
      {actions.modals()}
    </>
  );
};
