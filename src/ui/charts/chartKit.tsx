import type { ReactNode } from 'react';
import { formatCents } from '../../domain/money';
import { CategoryDot } from '../CategoryAvatar';
import { Card } from '../kit/Card';
import { cx } from '../kit/cx';
import { formatCentsCompact, formatMonth, formatMonthShort } from '../labels';

/** Colors de la paleta categòrica, en ordre fix. Més enllà de 8 sèries, tot va a "Altres". */
export const SERIES = Array.from({ length: 8 }, (_, i) => `var(--color-series-${i + 1})`);
export const SERIES_OTHER = 'var(--color-series-other)';
export const seriesColor = (index: number) => SERIES[index] ?? SERIES_OTHER;

export const CHART_HEIGHT = 260;

/** Props comunes dels eixos: discrets, sense marques, imports compactes. */
export const xAxisProps = {
  dataKey: 'month',
  tickFormatter: (m: string) => formatMonthShort(m),
  tick: { fill: 'var(--color-ink-faint)', fontSize: 11 },
  tickLine: false,
  stroke: 'var(--color-chart-axis)',
  minTickGap: 8,
} as const;

export const yAxisProps = {
  tickFormatter: (c: number) => formatCentsCompact(c),
  tick: { fill: 'var(--color-ink-faint)', fontSize: 11 },
  tickLine: false,
  axisLine: false,
  width: 64,
} as const;

export const gridProps = { vertical: false, stroke: 'var(--color-chart-grid)' } as const;

/** Element del tooltip tal com el passa Recharts (només el que fem servir). */
interface TipItem {
  name?: unknown;
  value?: unknown;
  color?: string;
  payload?: unknown;
}

export function ChartTooltip({
  active,
  payload,
  label,
  reverse,
  hideZero,
  footer,
}: {
  active?: boolean;
  payload?: readonly TipItem[];
  label?: unknown;
  /** Per a sèries apilades: la de dalt primer, com es veu a la gràfica. */
  reverse?: boolean;
  hideZero?: boolean;
  footer?: (row: unknown) => ReactNode;
}) {
  if (!active || !payload?.length) return null;
  let items = payload.filter((p) => typeof p.value === 'number' && (!hideZero || p.value !== 0));
  if (reverse) items = [...items].reverse();
  return (
    <div className="min-w-44 rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-pop">
      <div className="mb-1.5 font-semibold text-ink">{typeof label === 'string' ? formatMonth(label) : String(label ?? '')}</div>
      <ul className="space-y-1">
        {items.map((p, i) => (
          <li key={i} className="flex items-center gap-2">
            <CategoryDot color={p.color} className="size-2" />
            <span className="flex-1 text-ink-muted">{String(p.name)}</span>
            <span className="amount font-medium text-ink">{formatCents(p.value as number)}</span>
          </li>
        ))}
      </ul>
      {footer && <div className="mt-1.5 border-t border-line pt-1.5">{footer(payload[0]?.payload)}</div>}
    </div>
  );
}

export function ChartCard({ title, subtitle, actions, children, className }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <Card className={cx('min-w-0 px-4 py-4 sm:px-5', className)}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[15px] font-semibold">{title}</h3>
          {subtitle && <p className="mt-0.5 text-sm text-ink-muted">{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </Card>
  );
}

/** Llegenda HTML (les sèries s'identifiquen pel nom, no només pel color). */
export function Legend({ items }: { items: { label: string; color: string; line?: boolean }[] }) {
  return (
    <div className="mb-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-ink-muted">
      {items.map((it) => (
        <span key={it.label} className="inline-flex items-center gap-1.5">
          {it.line ? <span className="inline-block h-0.5 w-3.5 rounded-full" style={{ backgroundColor: it.color }} /> : <CategoryDot color={it.color} className="size-2" />}
          {it.label}
        </span>
      ))}
    </div>
  );
}

/** Xifra petita per a la capçalera d'una gràfica. */
export function MiniStat({ label, value, tone, hint }: { label: string; value: ReactNode; tone?: 'pos' | 'neg'; hint?: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-ink-muted">{label}</div>
      <div className={cx('amount text-lg font-semibold tracking-tight', tone === 'pos' && 'text-pos', tone === 'neg' && 'text-neg')}>{value}</div>
      {hint && <div className="text-[11px] text-ink-faint">{hint}</div>}
    </div>
  );
}
