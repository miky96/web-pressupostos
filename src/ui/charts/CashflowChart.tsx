import { Bar, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { CashflowPoint } from '../../domain/charts';
import { formatCents } from '../../domain/money';
import { formatPct } from '../labels';
import { CHART_HEIGHT, ChartCard, ChartTooltip, gridProps, Legend, MiniStat, SERIES, xAxisProps, yAxisProps } from './chartKit';

const INCOME = SERIES[0];
const EXPENSE = SERIES[1];
const SAVINGS = 'var(--color-ink)';

export function CashflowChart({ points }: { points: CashflowPoint[] }) {
  const income = points.reduce((s, p) => s + p.incomeCents, 0);
  const expense = points.reduce((s, p) => s + p.expenseCents, 0);
  const savings = income - expense;
  const months = Math.max(points.length, 1);

  return (
    <ChartCard title="Ingressos i despeses" subtitle="Despesa real: ja descomptades devolucions i reemborsaments. Els traspassos no compten.">
      <div className="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <MiniStat label="Ingressos" value={formatCents(income)} hint={`${formatCents(Math.round(income / months))} / mes`} />
        <MiniStat label="Despesa real" value={formatCents(expense)} hint={`${formatCents(Math.round(expense / months))} / mes`} />
        <MiniStat label="Estalvi" value={formatCents(savings)} tone={savings < 0 ? 'neg' : 'pos'} />
        <MiniStat label="Taxa d'estalvi" value={income > 0 ? formatPct(savings / income, 0) : '—'} />
      </div>
      <Legend
        items={[
          { label: 'Ingressos', color: INCOME },
          { label: 'Despesa real', color: EXPENSE },
          { label: 'Estalvi', color: SAVINGS, line: true },
        ]}
      />
      <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
        <ComposedChart data={points} margin={{ top: 4, right: 4, bottom: 0, left: 0 }} barGap={2} barCategoryGap="22%">
          <CartesianGrid {...gridProps} />
          <XAxis {...xAxisProps} />
          <YAxis {...yAxisProps} />
          <ReferenceLine y={0} stroke="var(--color-chart-axis)" />
          <Tooltip
            cursor={{ fill: 'var(--color-subtle)' }}
            content={({ active, payload, label }) => (
              <ChartTooltip
                active={active}
                payload={payload}
                label={label}
                footer={(row) => {
                  const rate = (row as CashflowPoint | undefined)?.savingsRate;
                  return (
                    <span className="text-ink-muted">
                      Taxa d'estalvi <span className="font-medium text-ink">{rate == null ? '—' : formatPct(rate, 0)}</span>
                    </span>
                  );
                }}
              />
            )}
          />
          <Bar dataKey="incomeCents" name="Ingressos" fill={INCOME} radius={[4, 4, 0, 0]} maxBarSize={28} />
          <Bar dataKey="expenseCents" name="Despesa real" fill={EXPENSE} radius={[4, 4, 0, 0]} maxBarSize={28} />
          <Line dataKey="savingsCents" name="Estalvi" type="monotone" stroke={SAVINGS} strokeWidth={2} dot={{ r: 3, fill: SAVINGS, strokeWidth: 0 }} activeDot={{ r: 5 }} />
        </ComposedChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
