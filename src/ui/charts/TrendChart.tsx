import { Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { TrendSeries } from '../../domain/charts';
import { formatCents } from '../../domain/money';
import { relativeChange } from '../../domain/periods';
import type { Category } from '../../domain/types';
import { cx } from '../kit/cx';
import { formatMonth, formatPct } from '../labels';
import { CHART_HEIGHT, ChartCard, ChartTooltip, gridProps, Legend, MiniStat, xAxisProps, yAxisProps } from './chartKit';

export interface TrendOption {
  id: string;
  name: string;
  kind: Category['kind'];
}

export function TrendChart({
  series,
  options,
  selected,
  onSelect,
  name,
  color,
  kind,
}: {
  series: TrendSeries;
  options: TrendOption[];
  selected: string;
  onSelect: (id: string) => void;
  name: string;
  color: string;
  kind: Category['kind'];
}) {
  const { points, averageCents } = series;
  const total = points.reduce((s, p) => s + p.cents, 0);
  const last = points.at(-1);
  const change = last ? relativeChange(last.cents, averageCents) : null;
  // Per a una despesa, pujar és dolent; per a un ingrés, bo.
  const good = change !== null && (kind === 'expense' ? change <= 0 : change >= 0);
  const peak = points.reduce<(typeof points)[number] | undefined>((max, p) => (!max || p.cents > max.cents ? p : max), undefined);

  const select = (
    <select className="input h-8 w-auto max-w-56 text-[13px]" value={selected} onChange={(e) => onSelect(e.target.value)} aria-label="Categoria">
      <optgroup label="Despeses">
        {options
          .filter((o) => o.kind === 'expense')
          .map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
      </optgroup>
      <optgroup label="Ingressos">
        {options
          .filter((o) => o.kind === 'income')
          .map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
      </optgroup>
    </select>
  );

  return (
    <ChartCard title="Tendència d'una categoria" subtitle="Mes a mes, amb la mitjana del període." actions={select}>
      <div className="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <MiniStat label="Total" value={formatCents(total)} />
        <MiniStat label="Mitjana mensual" value={formatCents(averageCents)} />
        <MiniStat
          label="Últim mes"
          value={formatCents(last?.cents ?? 0)}
          hint={
            change === null || !Number.isFinite(change) ? undefined : (
              <span className={cx(Math.abs(change) < 0.005 ? 'text-ink-muted' : good ? 'text-pos' : 'text-neg')}>
                {change > 0 ? '↑' : change < 0 ? '↓' : ''} {formatPct(Math.abs(change), 0)} vs mitjana
              </span>
            )
          }
        />
        <MiniStat label="Mes més alt" value={peak && peak.cents > 0 ? formatCents(peak.cents) : '—'} hint={peak && peak.cents > 0 ? formatMonth(peak.month) : undefined} />
      </div>
      <Legend
        items={[
          { label: name, color },
          { label: `Mitjana ${formatCents(averageCents)}`, color: 'var(--color-ink-muted)', line: true },
        ]}
      />
      <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
        <BarChart data={points} margin={{ top: 4, right: 4, bottom: 0, left: 0 }} barCategoryGap="22%">
          <CartesianGrid {...gridProps} />
          <XAxis {...xAxisProps} />
          <YAxis {...yAxisProps} />
          <Tooltip cursor={{ fill: 'var(--color-subtle)' }} content={({ active, payload, label }) => <ChartTooltip active={active} payload={payload} label={label} />} />
          <Bar dataKey="cents" name={name} fill={color} radius={[4, 4, 0, 0]} maxBarSize={36} />
          {averageCents !== 0 && <ReferenceLine y={averageCents} stroke="var(--color-ink-muted)" strokeDasharray="4 4" />}
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
