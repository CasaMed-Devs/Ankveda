import { formatRupees } from '@/lib/format';
import type { Plan, PlanPeriod } from '@/lib/types';

const PERIOD_UNIT: Record<PlanPeriod, [string, string]> = {
  daily: ['day', 'days'],
  weekly: ['week', 'weeks'],
  monthly: ['month', 'months'],
  yearly: ['year', 'years'],
};

/** "month", "3 months", "year" */
export const periodLabel = (plan: Pick<Plan, 'period' | 'interval'>) => {
  const [one, many] = PERIOD_UNIT[plan.period];
  return plan.interval === 1 ? one : `${plan.interval} ${many}`;
};

export const hasTrial = (plan: Plan) => plan.trialDays > 0;

/** All copy the paywall needs, derived from the backend plan (prices & durations are dynamic). */
export const describePlan = (plan: Plan) => {
  const recurring = `${formatRupees(plan.priceInPaise)} / ${periodLabel(plan)}`;
  if (hasTrial(plan)) {
    const trialPrice = plan.trialPriceInPaise > 0 ? formatRupees(plan.trialPriceInPaise) : 'Free';
    return {
      title: `${plan.trialDays} day Trial`,
      price: trialPrice,
      note: `After that ${recurring}`,
      cta: plan.trialPriceInPaise > 0 ? `Start Trial · ${trialPrice}` : 'Start free trial',
    };
  }
  return {
    title: plan.name,
    price: formatRupees(plan.priceInPaise),
    note: `Billed every ${periodLabel(plan)} · ${recurring}`,
    cta: `Subscribe · ${recurring}`,
  };
};
