import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';
import { useTheme, type Theme } from '@/lib/theme';
import { monthLabel, number, shortDay } from '@/lib/format';
import type { DayStat } from '@/lib/types';

/**
 * Chart conventions (dataviz method): categorical hues in fixed order (series-1 blue, series-2 orange,
 * series-3 aqua — validated light palette), thin marks, 4px rounded bar ends on the baseline, 2px lines,
 * recessive grid/axes, one y-axis, hover tooltip on every chart, legend for ≥ 2 series.
 */
/**
 * Series colours are referenced by slot (CSS variables, so HTML swatches and bar lists follow the theme).
 * SVG presentation attributes (fill=, stroke=) cannot resolve CSS variables, so TimeChart maps each slot
 * to the hex step for the active theme. Light and dark steps are each validated against their own surface
 * (dark: #131c2e — all checks pass, every slot >= 3:1).
 */
export const SERIES = ['var(--color-series-1)', 'var(--color-series-2)', 'var(--color-series-3)', 'var(--color-series-4)', 'var(--color-series-5)'];

const PALETTE = {
  light: { series: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4'], ink3: '#64748b', line: '#e6e8ef', lineStrong: '#d5d9e3', surface: '#ffffff', cursor: 'rgb(15 23 42 / 0.04)' },
  dark: { series: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181'], ink3: '#8794ad', line: '#23304a', lineStrong: '#31405e', surface: '#131c2e', cursor: 'rgb(255 255 255 / 0.04)' },
} as const;

const resolveColor = (color: string, theme: Theme) => {
  const slot = /^var\(--color-series-(\d)\)$/.exec(color);
  return slot ? (PALETTE[theme].series[Number(slot[1]) - 1] ?? color) : color;
};

export type Grain = 'day' | 'week' | 'month';

/** Day buckets → week (Mon-start) or month buckets. Sums every numeric metric. */
export const rollup = (days: DayStat[], grain: Grain): (DayStat & { label: string })[] => {
  if (grain === 'day') return days.map((d) => ({ ...d, label: shortDay(d.date) }));
  const buckets = new Map<string, DayStat>();
  for (const d of days) {
    let key: string;
    if (grain === 'month') key = d.date.slice(0, 7);
    else {
      const dt = new Date(`${d.date}T00:00:00Z`);
      dt.setUTCDate(dt.getUTCDate() - ((dt.getUTCDay() + 6) % 7));
      key = dt.toISOString().slice(0, 10);
    }
    const b = buckets.get(key) ?? { date: key, registrations: 0, revenueInPaise: 0, payments: 0, failedPayments: 0, newSubscriptions: 0, grants: 0 };
    b.registrations += d.registrations;
    b.revenueInPaise += d.revenueInPaise;
    b.payments += d.payments;
    b.failedPayments += d.failedPayments;
    b.newSubscriptions += d.newSubscriptions;
    b.grants += d.grants;
    buckets.set(key, b);
  }
  return [...buckets.values()].map((b) => ({ ...b, label: grain === 'month' ? monthLabel(b.date) : `Wk ${shortDay(b.date)}` }));
};

type SeriesDef = { key: string; name: string; color: string; format?: (v: number) => string };

const ChartTooltip = ({ active, payload, label, series }: { active?: boolean; payload?: { dataKey?: unknown; value?: unknown }[]; label?: unknown; series: SeriesDef[] }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="min-w-36 rounded-lg border border-line bg-surface px-3 py-2 text-[12px] shadow-[var(--shadow-pop)]">
      <p className="mb-1 font-semibold text-ink">{String(label)}</p>
      {series.map((s) => {
        const v = Number(payload.find((p) => p.dataKey === s.key)?.value ?? 0);
        return (
          <div key={s.key} className="flex items-center justify-between gap-4 text-ink-2">
            <span className="flex items-center gap-1.5">
              <span className="size-2 rounded-sm" style={{ background: s.color }} aria-hidden />
              {s.name}
            </span>
            <span className="font-semibold text-ink tabular">{s.format ? s.format(v) : number(v)}</span>
          </div>
        );
      })}
    </div>
  );
};

const Legend = ({ series }: { series: SeriesDef[] }) =>
  series.length < 2 ? null : (
    <div className="flex flex-wrap gap-x-4 gap-y-1 px-1 pb-2 text-[12px] text-ink-2">
      {series.map((s) => (
        <span key={s.key} className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm" style={{ background: s.color }} aria-hidden />
          {s.name}
        </span>
      ))}
    </div>
  );


export const TimeChart = ({
  data,
  series,
  kind = 'bar',
  height = 260,
  yFormat,
  stacked,
}: {
  data: Record<string, unknown>[];
  series: SeriesDef[];
  kind?: 'bar' | 'area';
  height?: number;
  yFormat?: (v: number) => string;
  stacked?: boolean;
}) => {
  const { theme } = useTheme();
  const c = PALETTE[theme];
  const axisProps = { tickLine: false, axisLine: false, tick: { fill: c.ink3, fontSize: 11 } } as const;
  // Resolve slot colours to hex for SVG; keep the slot (CSS variable) for the HTML legend / tooltip.
  const svg = series.map((s) => ({ ...s, hex: resolveColor(s.color, theme) }));
  return (
  <div>
    <Legend series={series} />
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        {kind === 'area' ? (
          <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <defs>
              {svg.map((s) => (
                <linearGradient key={s.key} id={`fill-${s.key}-${theme}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={s.hex} stopOpacity={theme === 'dark' ? 0.3 : 0.22} />
                  <stop offset="100%" stopColor={s.hex} stopOpacity={0.02} />
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid vertical={false} stroke={c.line} />
            <XAxis dataKey="label" {...axisProps} minTickGap={24} />
            <YAxis {...axisProps} width={yFormat ? 56 : 36} allowDecimals={false} tickFormatter={yFormat} />
            <Tooltip cursor={{ stroke: c.lineStrong, strokeWidth: 1 }} content={<ChartTooltip series={series} />} />
            {svg.map((s) => (
              <Area
                key={s.key}
                type="monotone"
                dataKey={s.key}
                name={s.name}
                stroke={s.hex}
                strokeWidth={2}
                fill={`url(#fill-${s.key}-${theme})`}
                dot={false}
                animationDuration={500}
                activeDot={{ r: 4, strokeWidth: 2, stroke: c.surface }}
              />
            ))}
          </AreaChart>
        ) : (
          <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap="22%">
            <CartesianGrid vertical={false} stroke={c.line} />
            <XAxis dataKey="label" {...axisProps} minTickGap={16} />
            <YAxis {...axisProps} width={yFormat ? 56 : 36} allowDecimals={false} tickFormatter={yFormat} />
            <Tooltip cursor={{ fill: c.cursor }} content={<ChartTooltip series={series} />} />
            {svg.map((s, i) => (
              <Bar
                key={s.key}
                dataKey={s.key}
                name={s.name}
                fill={s.hex}
                stackId={stacked ? 'a' : undefined}
                // 2px surface gap between stacked segments; rounded data-end on the top segment only.
                stroke={stacked ? c.surface : undefined}
                strokeWidth={stacked ? 2 : 0}
                radius={!stacked || i === series.length - 1 ? [4, 4, 0, 0] : 0}
                maxBarSize={36}
                animationDuration={500}
              />
            ))}
          </BarChart>
        )}
      </ResponsiveContainer>
    </div>
  </div>
  );
};

/**
 * Horizontal bar list — part-to-whole with exact values always visible (the contrast relief for the
 * lighter series hues), each row labelled with its name: identity never relies on colour.
 */
export const BarList = ({ items, format = number, emptyText = 'No data yet' }: { items: { label: ReactNode; value: number; color?: string; hint?: string }[]; format?: (v: number) => string; emptyText?: string }) => {
  const total = items.reduce((s, i) => s + i.value, 0);
  const max = Math.max(1, ...items.map((i) => i.value));
  if (!items.length || total === 0) return <p className="py-6 text-center text-[13px] text-ink-3">{emptyText}</p>;
  return (
    <ul className="flex flex-col gap-3">
      {items.map((item, i) => (
        <li key={i} title={item.hint}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-[13px]">
            <span className="truncate font-medium text-ink-2">{item.label}</span>
            <span className="shrink-0 tabular">
              <span className="font-semibold text-ink">{format(item.value)}</span>
              <span className="ml-1.5 text-[12px] text-ink-3">{((item.value / total) * 100).toFixed(0)}%</span>
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-surface-3">
            <div
              className={cn('h-full rounded-full transition-[width] duration-500')}
              style={{ width: `${Math.max(item.value > 0 ? 2 : 0, (item.value / max) * 100)}%`, background: item.color ?? SERIES[i] ?? 'var(--color-ink-3)' }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
};
