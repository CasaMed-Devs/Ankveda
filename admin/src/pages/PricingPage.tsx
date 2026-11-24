import { Eye, FileClock, RotateCcw, Save, Sparkles, Tags } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';

import { PageIntro } from '@/components/layout/Page';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { CopyText, ErrorState, InlineAlert, Skeleton } from '@/components/ui/Feedback';
import { Field, Input, Switch, Textarea } from '@/components/ui/Form';
import { Modal, useToast } from '@/components/ui/Overlay';
import { errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { date, dateTime, periodLabel, relative, rupees } from '@/lib/format';
import { usePricing, useSavePricing, type PricingBody } from '@/lib/queries';
import type { PricingPlan } from '@/lib/types';

type Form = {
  name: string;
  description: string;
  trialEnabled: boolean;
  trialDays: string;
  trialPrice: string;
  monthlyPlanEnabled: boolean;
  monthlyPrice: string;
  priceMode: 'create' | 'existing';
  razorpayPlanId: string;
  relinkPlan: boolean;
};

const toForm = (p: PricingPlan | null): Form => ({
  name: p?.name ?? 'Ankveda Premium',
  description: p?.description ?? '',
  trialEnabled: p?.trialEnabled ?? true,
  trialDays: String(p?.trialDays || 5),
  trialPrice: p ? String(p.trialPriceInPaise / 100) : '49',
  monthlyPlanEnabled: p?.monthlyPlanEnabled ?? true,
  monthlyPrice: p ? String(p.priceInPaise / 100) : '',
  priceMode: 'create',
  razorpayPlanId: '',
  relinkPlan: false,
});

const paise = (rupeeText: string) => Math.round(Number(rupeeText) * 100);

/** Mirrors app/src/lib/plans.ts describePlan() so the preview matches the real paywall copy. */
const describe = (f: { name: string; priceInPaise: number; period: string; interval: number; trialDays: number; trialPriceInPaise: number }) => {
  const recurring = `${rupees(f.priceInPaise)} / ${periodLabel(f.period, f.interval)}`;
  if (f.trialDays > 0) {
    const trialPrice = f.trialPriceInPaise > 0 ? rupees(f.trialPriceInPaise) : 'Free';
    return { title: `${f.trialDays} day Trial`, price: trialPrice, note: `After that ${recurring}`, cta: f.trialPriceInPaise > 0 ? `Start Trial · ${trialPrice}` : 'Start free trial' };
  }
  return { title: f.name, price: rupees(f.priceInPaise), note: `Billed every ${periodLabel(f.period, f.interval)} · ${recurring}`, cta: `Subscribe · ${recurring}` };
};

/** A phone-sized rendering of the app paywall card, in the app's maroon & gold. */
const PaywallPreview = ({ form, period, interval }: { form: Form; period: string; interval: number }) => {
  const price = paise(form.monthlyPrice || '0');
  const trialOn = form.trialEnabled && Number(form.trialDays) > 0;
  const copy = describe({
    name: form.name,
    priceInPaise: price,
    period,
    interval,
    trialDays: trialOn ? Number(form.trialDays) : 0,
    trialPriceInPaise: trialOn ? paise(form.trialPrice || '0') : 0,
  });
  return (
    <div className="mx-auto w-full max-w-[300px] rounded-[28px] border-[6px] border-navy-900 dark:border-black bg-gradient-to-b from-[#300810] to-[#5b1022] p-5 text-[#fff5e4] shadow-[var(--shadow-pop)]">
      <p className="text-center font-display text-[13px] tracking-[0.25em] text-[#e9c783] uppercase">Ankveda Premium</p>
      <p className="mt-2 text-center font-display text-2xl leading-tight">Unlock every reading</p>
      {form.monthlyPlanEnabled ? (
        <>
          <div className="mt-5 rounded-[18px] border border-[#9b6145] bg-[#601528] p-4">
            <p className="font-display text-xl text-[#e9c783]">{copy.title}</p>
            <p className="mt-1 text-3xl font-bold">{copy.price}</p>
            <p className="mt-1 text-[12px] text-[#d7b9b6]">{copy.note}</p>
          </div>
          <div className="mt-4 rounded-2xl bg-gradient-to-r from-[#f9e4b2] to-[#dca951] py-3 text-center text-[13px] font-bold text-[#350911]">{copy.cta}</div>
        </>
      ) : (
        <div className="mt-5 rounded-[18px] border border-[#9b6145] bg-[#601528]/40 p-4 text-center text-[12px] text-[#d7b9b6]">
          Premium plans are being prepared. Please check back soon.
        </div>
      )}
      <p className="mt-3 text-center text-[10px] text-[#d7b9b6]">Cancel anytime · Auto-renews</p>
    </div>
  );
};

const Section = ({ title, description, children, badge }: { title: string; description: string; children: ReactNode; badge?: ReactNode }) => (
  <Card>
    <CardHeader title={<span className="flex items-center gap-2">{title} {badge}</span>} description={description} />
    <div className="flex flex-col gap-4 px-5 pb-5">{children}</div>
  </Card>
);

export const PricingPage = () => {
  const pricing = usePricing();
  const save = useSavePricing();
  const toast = useToast();
  const plan = pricing.data?.plan ?? null;
  const [form, setForm] = useState<Form>(() => toForm(null));
  const [confirming, setConfirming] = useState(false);
  const [showPreview, setShowPreview] = useState(true);

  useEffect(() => {
    if (pricing.data) setForm(toForm(pricing.data.plan));
  }, [pricing.data]);

  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => ({ ...f, [key]: value }));
  const initial = useMemo(() => toForm(plan), [plan]);
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const newPrice = paise(form.monthlyPrice || '0');
  const priceChanged = !plan || newPrice !== plan.priceInPaise;
  const needsPlanId = (priceChanged && form.priceMode === 'existing') || (!priceChanged && form.relinkPlan);

  const errors = {
    trialDays: form.trialEnabled && !(Number.isInteger(Number(form.trialDays)) && Number(form.trialDays) >= 1 && Number(form.trialDays) <= 90) ? 'Enter 1–90 days.' : null,
    trialPrice:
      form.trialEnabled && !(Number(form.trialPrice) === 0 || (Number(form.trialPrice) >= 1 && Number(form.trialPrice) <= 100000)) ? 'Enter ₹0 (free trial) or at least ₹1.' : null,
    monthlyPrice: !(Number(form.monthlyPrice) >= 1 && Number(form.monthlyPrice) <= 100000) ? 'Enter at least ₹1.' : null,
    razorpayPlanId: needsPlanId && !/^plan_[A-Za-z0-9]+$/.test(form.razorpayPlanId.trim()) ? 'Enter a Razorpay plan id (plan_…).' : null,
    name: form.name.trim().length < 2 ? 'Enter a plan name.' : null,
  };
  const invalid = Object.values(errors).some(Boolean);

  const body = (): PricingBody => ({
    expectedUpdatedAt: plan?.updatedAt ?? null,
    name: form.name.trim(),
    description: form.description.trim() || null,
    trialEnabled: form.trialEnabled,
    trialDays: form.trialEnabled ? Number(form.trialDays) : (plan?.trialDays ?? 0),
    trialPriceInPaise: form.trialEnabled ? paise(form.trialPrice) : (plan?.trialPriceInPaise ?? 0),
    monthlyPlanEnabled: form.monthlyPlanEnabled,
    price: priceChanged
      ? form.priceMode === 'create'
        ? { mode: 'create', priceInPaise: newPrice }
        : { mode: 'existing', priceInPaise: newPrice, razorpayPlanId: form.razorpayPlanId.trim() }
      : form.relinkPlan
        ? { mode: 'existing', priceInPaise: newPrice, razorpayPlanId: form.razorpayPlanId.trim() }
        : { mode: 'unchanged' },
  });

  const submit = () =>
    save.mutate(body(), {
      onSuccess: () => {
        setConfirming(false);
        toast.success('Pricing saved', 'New checkouts use these terms immediately. Existing subscribers keep theirs.');
      },
      onError: (e) => toast.error('Could not save pricing', errorMessage(e)),
    });

  if (pricing.isLoading) return <Skeleton className="h-[600px]" />;
  if (pricing.error) return <ErrorState error={pricing.error} onRetry={() => void pricing.refetch()} />;

  const history = pricing.data?.history ?? [];
  const historyColumns: Column<PricingPlan>[] = [
    { key: 'name', header: 'Plan', cell: (p) => <span className="font-medium text-ink">{p.name}</span> },
    { key: 'price', header: 'Price', cell: (p) => `${rupees(p.priceInPaise)} / ${periodLabel(p.period, p.interval)}` },
    { key: 'trial', header: 'Trial', cell: (p) => (p.trialEnabled ? `${p.trialDays} days · ${rupees(p.trialPriceInPaise)}` : 'Off'), hideBelow: 'md' },
    { key: 'rzp', header: 'Razorpay plan', cell: (p) => <CopyText value={p.razorpayPlanId} className="max-w-40" />, hideBelow: 'lg' },
    {
      key: 'state',
      header: 'State',
      cell: (p) =>
        p.featured && p.monthlyPlanEnabled ? <Badge tone="success">On paywall</Badge> : p.featured ? <Badge tone="warning">Disabled</Badge> : <Badge tone="neutral">Archived</Badge>,
    },
    { key: 'created', header: 'Created', cell: (p) => date(p.createdAt), hideBelow: 'md' },
  ];

  return (
    <>
      <PageIntro
        description="Edit the paywall the app shows. Changes apply to new checkouts immediately — no app release needed. Existing subscribers keep the terms they signed up with."
        actions={
          <Button size="sm" variant="ghost" icon={Eye} onClick={() => setShowPreview((s) => !s)} className="xl:hidden">
            {showPreview ? 'Hide preview' : 'Preview pricing'}
          </Button>
        }
      />
      {!pricing.data?.razorpayConfigured && (
        <InlineAlert className="mb-5">Razorpay keys are not configured on this backend. Trial settings can still be changed; a new monthly price cannot be created or verified.</InlineAlert>
      )}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_340px]">
        <div className="flex flex-col gap-6">
          <Section
            title="Free trial"
            description="Applied when a subscription is created (first charge delayed + one-time trial charge). Changing it never needs a Razorpay plan."
            badge={form.trialEnabled ? <Badge tone="info">On</Badge> : <Badge>Off</Badge>}
          >
            <Switch checked={form.trialEnabled} onChange={(v) => set('trialEnabled', v)} label="Offer a trial" description="When off, new subscribers are charged the monthly amount immediately. Your trial values are kept." />
            <div className={cn('grid grid-cols-1 gap-4 sm:grid-cols-2', !form.trialEnabled && 'pointer-events-none opacity-50')}>
              <Field label="Trial duration (days)" htmlFor="trial-days" error={errors.trialDays}>
                <Input id="trial-days" type="number" min={1} max={90} value={form.trialDays} onChange={(e) => set('trialDays', e.target.value)} disabled={!form.trialEnabled} aria-invalid={!!errors.trialDays} />
              </Field>
              <Field label="Trial amount (₹)" htmlFor="trial-price" hint="₹0 = free trial" error={errors.trialPrice}>
                <Input id="trial-price" type="number" min={0} step="1" value={form.trialPrice} onChange={(e) => set('trialPrice', e.target.value)} disabled={!form.trialEnabled} leading="₹" aria-invalid={!!errors.trialPrice} />
              </Field>
            </div>
          </Section>

          <Section
            title="Monthly subscription"
            description="Razorpay plan amounts cannot be edited. A new amount creates (or links) a new Razorpay plan; the old plan is archived and its subscribers are unaffected."
            badge={form.monthlyPlanEnabled ? <Badge tone="success">Enabled</Badge> : <Badge tone="warning">Disabled</Badge>}
          >
            <Switch
              checked={form.monthlyPlanEnabled}
              onChange={(v) => set('monthlyPlanEnabled', v)}
              label="Show the plan on the paywall"
              description="When disabled, the app shows “Premium plans are being prepared” and nobody can subscribe. Existing subscribers are unaffected."
            />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Plan name" htmlFor="plan-name" error={errors.name}>
                <Input id="plan-name" maxLength={60} value={form.name} onChange={(e) => set('name', e.target.value)} />
              </Field>
              <Field label="Monthly amount (₹)" htmlFor="monthly-price" error={errors.monthlyPrice} hint={plan && priceChanged ? `Currently ${rupees(plan.priceInPaise)} — changing it needs a new Razorpay plan` : undefined}>
                <Input id="monthly-price" type="number" min={1} step="1" leading="₹" value={form.monthlyPrice} onChange={(e) => set('monthlyPrice', e.target.value)} aria-invalid={!!errors.monthlyPrice} />
              </Field>
            </div>
            <Field label="Subscription description" optional htmlFor="plan-desc" hint="Shown on the Razorpay checkout / invoice">
              <Textarea id="plan-desc" maxLength={200} value={form.description} onChange={(e) => set('description', e.target.value)} placeholder="All reports, daily guidance & astrologer chat" />
            </Field>

            <div className="rounded-xl border border-line bg-surface-2 p-4">
              <p className="text-[13px] font-semibold">Razorpay plan</p>
              {plan && <p className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-ink-3">Current: <CopyText value={plan.razorpayPlanId} truncate={false} /></p>}
              {priceChanged ? (
                <fieldset className="mt-3 flex flex-col gap-2">
                  <legend className="sr-only">How to get the Razorpay plan for the new amount</legend>
                  {[
                    { v: 'create' as const, t: `Create a new Razorpay plan for ${rupees(newPrice)} / month`, d: 'Done for you through the Razorpay API when you save.' },
                    { v: 'existing' as const, t: 'Use a plan I already created in Razorpay', d: 'Its amount, currency and billing period are checked against Razorpay before saving.' },
                  ].map((o) => (
                    <label key={o.v} className={cn('flex cursor-pointer gap-3 rounded-lg border bg-surface p-3', form.priceMode === o.v ? 'border-series-1' : 'border-line')}>
                      <input type="radio" name="price-mode" className="mt-1 accent-primary" checked={form.priceMode === o.v} onChange={() => set('priceMode', o.v)} />
                      <span>
                        <span className="block text-[13px] font-semibold">{o.t}</span>
                        <span className="block text-[12px] text-ink-3">{o.d}</span>
                      </span>
                    </label>
                  ))}
                </fieldset>
              ) : (
                <label className="mt-3 flex items-center gap-2 text-[13px]">
                  <input type="checkbox" className="accent-primary" checked={form.relinkPlan} onChange={(e) => set('relinkPlan', e.target.checked)} />
                  Link a different Razorpay plan with the same amount
                </label>
              )}
              {needsPlanId && (
                <Field label="Razorpay plan ID" htmlFor="rzp-plan" error={errors.razorpayPlanId} className="mt-3">
                  <Input id="rzp-plan" value={form.razorpayPlanId} onChange={(e) => set('razorpayPlanId', e.target.value)} placeholder="plan_XXXXXXXXXXXX" spellCheck={false} />
                </Field>
              )}
            </div>
          </Section>

          <div className="sticky bottom-4 z-10 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-surface/95 px-5 py-3 shadow-[var(--shadow-pop)] backdrop-blur">
            <p className="text-[12px] text-ink-3">
              {plan ? (
                <>
                  Last updated {dateTime(plan.updatedAt)} ({relative(plan.updatedAt)}) by <strong className="text-ink-2">{plan.updatedBy?.email ?? 'an earlier admin'}</strong>
                </>
              ) : (
                'No paywall plan exists yet — saving creates it.'
              )}
            </p>
            <div className="flex gap-2">
              <Button icon={RotateCcw} onClick={() => setForm(initial)} disabled={!dirty || save.isPending}>
                Reset changes
              </Button>
              <Button variant="primary" icon={Save} disabled={!dirty || invalid} loading={save.isPending} onClick={() => (priceChanged || form.relinkPlan ? setConfirming(true) : submit())}>
                Save changes
              </Button>
            </div>
          </div>
        </div>

        <aside className={cn('xl:sticky xl:top-24 xl:self-start', !showPreview && 'hidden xl:block')}>
          <Card className="p-5">
            <p className="mb-4 flex items-center gap-2 text-[13px] font-semibold text-ink">
              <Sparkles className="size-4 text-gold-600 dark:text-gold-300" /> Paywall preview
            </p>
            <PaywallPreview form={form} period={plan?.period ?? 'monthly'} interval={plan?.interval ?? 1} />
            <p className="mt-4 text-center text-[12px] text-ink-3">{dirty ? 'Unsaved changes — this is how the paywall will look.' : 'This is what the app shows now.'}</p>
          </Card>
        </aside>
      </div>

      <Card className="mt-6">
        <CardHeader title={<span className="flex items-center gap-2"><FileClock className="size-4 text-ink-3" />Plan history</span>} description="Plans are archived, never deleted — existing subscriptions still reference them." />
        <DataTable columns={historyColumns} rows={history} rowKey={(p) => p.id} empty={{ icon: Tags, title: 'No plans yet' }} />
      </Card>

      <Modal
        open={confirming}
        onClose={() => setConfirming(false)}
        title="Change the monthly price?"
        footer={
          <>
            <Button onClick={() => setConfirming(false)}>Cancel</Button>
            <Button variant="primary" onClick={submit} loading={save.isPending}>
              Confirm and save
            </Button>
          </>
        }
      >
        <ul className="list-disc space-y-1.5 pl-5 text-[13px] text-ink-2">
          {form.priceMode === 'create' && priceChanged ? (
            <li>A new Razorpay plan for <strong>{rupees(newPrice)} / month</strong> will be created in your Razorpay account.</li>
          ) : (
            <li>
              Razorpay plan <code>{form.razorpayPlanId}</code> will be verified ({rupees(newPrice)} / month) and linked.
            </li>
          )}
          <li>New checkouts use it immediately. {plan && <>The current plan ({rupees(plan.priceInPaise)}) is archived.</>}</li>
          <li>Existing subscribers keep their current price — Razorpay subscriptions cannot change plans.</li>
        </ul>
        {save.error && <InlineAlert tone="danger" className="mt-4">{errorMessage(save.error)}</InlineAlert>}
      </Modal>
    </>
  );
};
