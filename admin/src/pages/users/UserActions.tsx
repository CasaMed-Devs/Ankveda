import { Ban, CalendarDays, CircleCheck, Gift, Trash } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { DescList } from '@/components/layout/Page';
import { AccessBadge, SourceBadge, SubStatusBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { InlineAlert } from '@/components/ui/Feedback';
import { Field, Input, Select, Textarea } from '@/components/ui/Form';
import { Modal, useToast } from '@/components/ui/Overlay';
import { ApiError, errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { addDays, date, istKey, phone, rupees } from '@/lib/format';
import { useDeleteUser, useExpire, useGrant, usePlans } from '@/lib/queries';
import type { AccessBucket, Source, SubscriptionStatus } from '@/lib/types';

export type ActionUser = { id: string; name: string | null; phone: string; access: AccessBucket };
export type ActionSubscription = {
  id: string;
  source: Source;
  status: SubscriptionStatus;
  planName: string | null;
  expiresAt: number | null;
  cancelAtPeriodEnd: boolean;
  nextChargeAt?: number | null;
  amountInPaise?: number | null;
};

// ── Grant ────────────────────────────────────────────────────────────────────

const DURATIONS = [
  { value: '7', label: '7 days' },
  { value: '30', label: '30 days (1 month)' },
  { value: '90', label: '90 days (3 months)' },
  { value: '180', label: '180 days (6 months)' },
  { value: '365', label: '365 days (1 year)' },
  { value: 'custom', label: 'Custom number of days' },
];

export const GrantModal = ({ user, open, onClose }: { user: ActionUser; open: boolean; onClose: () => void }) => {
  const plans = usePlans();
  const grant = useGrant(user.id);
  const toast = useToast();
  const today = istKey();
  const [planId, setPlanId] = useState('');
  const [duration, setDuration] = useState('30');
  const [customDays, setCustomDays] = useState('14');
  const [startDate, setStartDate] = useState(today);
  const [expiryDate, setExpiryDate] = useState('');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (!open) return;
    grant.reset();
    setStartDate(istKey());
    setExpiryDate('');
    setNotes('');
    setDuration('30');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  useEffect(() => {
    if (!planId && plans.data?.length) setPlanId((plans.data.find((p) => p.featured && p.active) ?? plans.data[0])!.id);
  }, [plans.data, planId]);

  const days = duration === 'custom' ? Number(customDays) : Number(duration);
  // Expiry date is inclusive (access until the end of that day).
  const effectiveExpiry = expiryDate || (days > 0 ? addDays(startDate, days - 1) : '');
  const validationError =
    !planId
      ? 'Choose a plan.'
      : startDate > today
        ? 'The start date cannot be in the future — a grant gives access immediately.'
        : !expiryDate && (!Number.isInteger(days) || days < 1 || days > 3650)
          ? 'Duration must be 1–3650 days.'
          : expiryDate && expiryDate < today
            ? 'The expiry date is in the past.'
            : expiryDate && expiryDate < startDate
              ? 'The expiry must be after the start date.'
              : null;

  const submit = () => {
    if (validationError) return;
    grant.mutate(
      {
        planId,
        startDate,
        ...(expiryDate ? { expiryDate } : { durationDays: days }),
        notes: notes.trim() || undefined,
      },
      {
        onSuccess: () => {
          toast.success('Subscription granted', `${user.name ?? phone(user.phone)} has complimentary access until ${date(Date.parse(`${effectiveExpiry}T23:59:59+05:30`))}.`);
          onClose();
        },
      },
    );
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Grant subscription"
      description={`Complimentary access for ${user.name ?? phone(user.phone)} — recorded as a manual grant, never as a payment.`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon={Gift} onClick={submit} loading={grant.isPending} disabled={!!validationError}>
            Confirm grant
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {(user.access === 'paid' || user.access === 'trial' || user.access === 'cancelling') && (
          <InlineAlert>
            This user has a Razorpay subscription with access right now. Expire it first (and stop its billing) — the server will refuse a grant on top of a
            paid subscription.
          </InlineAlert>
        )}
        <Field label="Subscription plan" htmlFor="grant-plan" hint="The plan name the user sees. No payment is taken.">
          <Select id="grant-plan" value={planId} onChange={(e) => setPlanId(e.target.value)} disabled={plans.isLoading}>
            {plans.isLoading && <option>Loading plans…</option>}
            {plans.data?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} · {rupees(p.priceInPaise)}/{p.period.replace('ly', '')}
                {p.featured && p.active ? ' (paywall plan)' : !p.active ? ' (archived)' : ''}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Duration" htmlFor="grant-duration">
            <Select id="grant-duration" value={duration} onChange={(e) => setDuration(e.target.value)} disabled={!!expiryDate}>
              {DURATIONS.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </Select>
          </Field>
          {duration === 'custom' && !expiryDate ? (
            <Field label="Days" htmlFor="grant-days">
              <Input id="grant-days" type="number" min={1} max={3650} value={customDays} onChange={(e) => setCustomDays(e.target.value)} />
            </Field>
          ) : (
            <Field label="Start date" htmlFor="grant-start" hint="Today, or backdated">
              <Input id="grant-start" type="date" max={today} value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </Field>
          )}
        </div>
        {duration === 'custom' && !expiryDate && (
          <Field label="Start date" htmlFor="grant-start2" hint="Today, or backdated">
            <Input id="grant-start2" type="date" max={today} value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </Field>
        )}
        <Field label="Expiry date" optional htmlFor="grant-expiry" hint="Overrides the duration. Access lasts until the end of this day (IST).">
          <Input id="grant-expiry" type="date" min={today} value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} />
        </Field>
        <Field label="Admin notes" optional htmlFor="grant-notes" hint="Why this grant was given (saved in the audit log).">
          <Textarea id="grant-notes" maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Compensation for support ticket #1234" />
        </Field>
        <div className="flex items-center gap-3 rounded-xl border border-violet-200 dark:border-violet-500/25 bg-violet-50 dark:bg-violet-500/10 px-4 py-3 text-[13px] text-violet-900 dark:text-violet-300">
          <CalendarDays className="size-4 shrink-0" />
          <span>
            Access {startDate === today ? 'from now' : `from ${date(Date.parse(`${startDate}T00:00:00+05:30`))}`} until{' '}
            <strong>{effectiveExpiry ? date(Date.parse(`${effectiveExpiry}T00:00:00+05:30`)) : '—'}</strong> · Manual grant · ₹0 charged
          </span>
        </div>
        {(validationError || grant.error) && <InlineAlert tone="danger">{validationError ?? errorMessage(grant.error)}</InlineAlert>}
      </div>
    </Modal>
  );
};

// ── Expire / cancel ──────────────────────────────────────────────────────────

const BILLABLE: SubscriptionStatus[] = ['created', 'authenticated', 'active', 'pending', 'halted'];

export const ExpireModal = ({ user, subscription, open, onClose }: { user: ActionUser; subscription: ActionSubscription | null; open: boolean; onClose: () => void }) => {
  const expire = useExpire(user.id);
  const toast = useToast();
  const isGrant = subscription?.source === 'admin_grant';
  const billable = !!subscription && !isGrant && BILLABLE.includes(subscription.status);
  const canCancelRenewal = billable && !(subscription.cancelAtPeriodEnd && subscription.status === 'active');
  const [mode, setMode] = useState<'cancel_renewal' | 'expire_now'>('expire_now');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (!open) return;
    expire.reset();
    setNotes('');
    setMode(canCancelRenewal ? 'cancel_renewal' : 'expire_now');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!subscription) {
    return (
      <Modal open={open} onClose={onClose} title="Expire subscription" footer={<Button onClick={onClose}>Close</Button>}>
        <p className="text-[13px] text-ink-2">This user has no current subscription.</p>
      </Modal>
    );
  }

  const submit = () =>
    expire.mutate(
      { subscriptionId: subscription.id, mode, notes: notes.trim() || undefined },
      {
        onSuccess: () => {
          toast.success(mode === 'expire_now' ? 'Access ended' : 'Renewal cancelled', mode === 'expire_now' ? 'The user no longer has premium access.' : `Access continues until ${date(subscription.expiresAt)}.`);
          onClose();
        },
      },
    );

  const options = [
    {
      value: 'cancel_renewal' as const,
      title: 'Cancel future billing',
      body: isGrant
        ? 'Not available — complimentary grants have no billing.'
        : !billable
          ? 'Not available — Razorpay is no longer billing this subscription.'
          : !canCancelRenewal
            ? 'Renewal is already cancelled.'
            : `Stops all future Razorpay charges. The user keeps access until the paid period ends (${date(subscription.expiresAt)}). No refund is issued.`,
      disabled: !canCancelRenewal,
    },
    {
      value: 'expire_now' as const,
      title: 'Expire access immediately',
      body: billable
        ? 'Cancels the Razorpay subscription right now (no further charges) and ends access immediately, even though the period was paid. No refund is issued automatically.'
        : 'Ends access immediately.',
      disabled: false,
    },
  ];

  return (
    <Modal
      open={open}
      onClose={onClose}
      tone={mode === 'expire_now' ? 'danger' : 'default'}
      title="Expire subscription"
      description={`${user.name ?? phone(user.phone)} · these options are not interchangeable — pick exactly what should happen.`}
      size="lg"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant={mode === 'expire_now' ? 'danger' : 'primary'} icon={Ban} onClick={submit} loading={expire.isPending}>
            {mode === 'expire_now' ? 'Expire now' : 'Cancel renewal'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="rounded-xl border border-line bg-surface-2 p-4">
          <DescList
            items={[
              { label: 'Plan', value: subscription.planName ?? '—' },
              { label: 'Status', value: <SubStatusBadge status={subscription.status} /> },
              { label: 'Source', value: <SourceBadge source={subscription.source} /> },
              { label: 'Access until', value: date(subscription.expiresAt) },
              { label: 'Next charge', value: subscription.nextChargeAt ? `${date(subscription.nextChargeAt)}${subscription.amountInPaise ? ` · ${rupees(subscription.amountInPaise)}` : ''}` : '—' },
              { label: 'Subscription ID', value: <code className="text-[12px]">{subscription.id}</code> },
            ]}
          />
        </div>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-[13px] font-semibold">What should happen?</legend>
          {options.map((o) => (
            <label
              key={o.value}
              className={cn(
                'flex cursor-pointer gap-3 rounded-xl border p-3.5 transition-colors',
                mode === o.value ? (o.value === 'expire_now' ? 'border-red-300 dark:border-red-500/40 bg-red-50/60 dark:bg-red-500/10' : 'border-series-1 bg-sky-50/60 dark:bg-sky-500/10') : 'border-line hover:border-line-strong',
                o.disabled && 'cursor-not-allowed opacity-55',
              )}
            >
              <input type="radio" name="expire-mode" className="mt-1 accent-primary" checked={mode === o.value} disabled={o.disabled} onChange={() => setMode(o.value)} />
              <span>
                <span className="block text-[13px] font-semibold text-ink">{o.title}</span>
                <span className="mt-0.5 block text-[12px] leading-relaxed text-ink-2">{o.body}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <Field label="Admin notes" optional htmlFor="expire-notes">
          <Textarea id="expire-notes" maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Reason (saved in the audit log)" />
        </Field>
        {expire.error && <InlineAlert tone="danger">{errorMessage(expire.error)}</InlineAlert>}
      </div>
    </Modal>
  );
};

// ── Delete ───────────────────────────────────────────────────────────────────

export const DeleteUserModal = ({ user, open, onClose, onDeleted }: { user: ActionUser; open: boolean; onClose: () => void; onDeleted?: () => void }) => {
  const del = useDeleteUser();
  const toast = useToast();
  const [confirm, setConfirm] = useState('');
  const [force, setForce] = useState(false);
  useEffect(() => {
    if (!open) return;
    del.reset();
    setConfirm('');
    setForce(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const done = del.data?.deletion.status === 'completed';
  const summary = useMemo(() => del.data?.deletion.deleted, [del.data]);
  const skippedBilling = del.data?.deletion.billingNotStopped ?? [];
  // Razorpay billing couldn't be confirmed stopped — the admin may choose to delete anyway.
  const billingBlocked = del.error instanceof ApiError && del.error.code === 'billing_not_stopped';

  const submit = () =>
    del.mutate({ userId: user.id, force: billingBlocked && force }, {
      onSuccess: (data) => {
        const skipped = data.deletion.billingNotStopped ?? [];
        if (skipped.length) toast.error('User deleted — Razorpay billing not stopped', `Cancel ${skipped.join(', ')} in the Razorpay dashboard.`);
        else toast.success('User permanently deleted');
        onDeleted?.();
      },
    });

  return (
    <Modal
      open={open}
      onClose={onClose}
      tone="danger"
      title={done ? 'User deleted' : 'Permanently delete user'}
      footer={
        done ? (
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        ) : (
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button
              variant="danger"
              icon={Trash}
              onClick={submit}
              loading={del.isPending}
              disabled={confirm !== 'DELETE' || (billingBlocked && !force)}
            >
              {billingBlocked ? 'Delete anyway' : del.error ? 'Retry deletion' : 'Delete permanently'}
            </Button>
          </>
        )
      }
    >
      {done ? (
        <div className="flex flex-col items-center gap-3 py-4 text-center">
          <CircleCheck className="size-10 text-emerald-600 dark:text-emerald-400" />
          <p className="text-[13px] text-ink-2">All data for this user has been removed.</p>
          {summary && (
            <p className="text-[12px] text-ink-3">
              Deleted {summary.subscriptions} subscription(s) and {summary.transactions} payment record(s) ({rupees(summary.paymentsInPaise)} of revenue). The audit log keeps only these
              counts.
            </p>
          )}
          {skippedBilling.length > 0 && (
            <InlineAlert tone="danger">
              Razorpay billing was not confirmed stopped for {skippedBilling.map((id) => <code key={id} className="text-[12px]">{id} </code>)}— cancel
              {skippedBilling.length > 1 ? ' them' : ' it'} in the Razorpay dashboard.
            </InlineAlert>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="rounded-xl border border-line bg-surface-2 p-4">
            <DescList
              items={[
                { label: 'Name', value: user.name ?? '—' },
                { label: 'Phone', value: phone(user.phone) },
                { label: 'User ID', value: <code className="text-[12px] break-all">{user.id}</code> },
                { label: 'Subscription', value: <AccessBadge access={user.access} /> },
              ]}
            />
          </div>
          <InlineAlert tone="danger">
            <p className="font-semibold">This cannot be undone.</p>
            <ul className="mt-1 list-disc pl-4">
              <li>Any active Razorpay subscription is cancelled first — if billing can’t be stopped, nothing is deleted unless you choose to delete anyway.</li>
              <li>Deletes the profile, reports, chat history, daily guidance, login code, subscriptions and payment records.</li>
              <li>Their payments disappear from revenue figures. The Razorpay dashboard keeps its own records.</li>
              <li>If a step fails, retrying resumes where it stopped.</li>
            </ul>
          </InlineAlert>
          <Field label={<>Type <code className="rounded bg-surface-3 px-1">DELETE</code> to confirm</>} htmlFor="confirm-delete">
            <Input id="confirm-delete" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" spellCheck={false} />
          </Field>
          {del.error && <InlineAlert tone="danger">{errorMessage(del.error)}</InlineAlert>}
          {billingBlocked && (
            <label className="flex items-start gap-2 text-[13px] text-ink-2">
              <input type="checkbox" className="mt-0.5" checked={force} onChange={(e) => setForce(e.target.checked)} />
              <span>
                Delete anyway. I have cancelled (or will cancel) this subscription in the Razorpay dashboard — the subscription id is kept in the
                audit log.
              </span>
            </label>
          )}
        </div>
      )}
    </Modal>
  );
};

/** Grant / Expire / Delete buttons + their modals (used by the users table and the user drawer). */
export const useUserActions = () => {
  const [state, setState] = useState<{ kind: 'grant' | 'expire' | 'delete'; user: ActionUser; subscription?: ActionSubscription | null } | null>(null);
  const close = () => setState(null);
  return {
    open: (kind: 'grant' | 'expire' | 'delete', user: ActionUser, subscription?: ActionSubscription | null) => setState({ kind, user, subscription }),
    modals: (onDeleted?: () => void) =>
      state && (
        <>
          <GrantModal user={state.user} open={state.kind === 'grant'} onClose={close} />
          <ExpireModal user={state.user} subscription={state.subscription ?? null} open={state.kind === 'expire'} onClose={close} />
          <DeleteUserModal user={state.user} open={state.kind === 'delete'} onClose={close} onDeleted={onDeleted} />
        </>
      ),
  };
};
