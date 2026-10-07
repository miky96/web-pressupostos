import { useState } from 'react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { NetWorthPoint } from '../../domain/charts';
import { formatCents } from '../../domain/money';
import { relativeChange } from '../../domain/periods';
import type { Account } from '../../domain/types';
import { Segmented } from '../kit/Feedback';
import { ACCOUNT_GROUPS, formatPct } from '../labels';
import { CHART_HEIGHT, ChartCard, ChartTooltip, gridProps, Legend, MiniStat, seriesColor, xAxisProps, yAxisProps } from './chartKit';

type Grouping = 'type' | 'account';

interface Series {
  key: string;
  label: string;
  color: string;
  value: (p: NetWorthPoint) => number;
}

export function NetWorthChart({ points, accounts, allAccounts }: { points: NetWorthPoint[]; accounts: Account[]; allAccounts: Account[] }) {
  const [grouping, setGrouping] = useState<Grouping>('type');

  const byType: Series[] = ACCOUNT_GROUPS.map((g) => {
    const ids = accounts.filter((a) => g.types.includes(a.type)).map((a) => a.id);
    return { key: g.label, label: g.label, color: g.color, value: (p: NetWorthPoint) => ids.reduce((s, id) => s + (p.byAccount[id] ?? 0), 0) };
  });
  // El color segueix el compte (posició a la llista completa), no el rànquing: filtrar no repinta.
  const byAccount: Series[] = accounts.map((a) => ({
    key: a.id,
    label: a.name,
    color: seriesColor(allAccounts.findIndex((x) => x.id === a.id)),
    value: (p: NetWorthPoint) => p.byAccount[a.id] ?? 0,
  }));
  const series = (grouping === 'type' ? byType : byAccount).filter((s) => points.some((p) => s.value(p) !== 0));

  const first = points[0];
  const last = points.at(-1);
  const delta = first && last ? last.totalCents - first.totalCents : 0;
  const change = first && last ? relativeChange(last.totalCents, first.totalCents) : null;

  return (
    <ChartCard
      title="Evolució del patrimoni"
      subtitle="Saldo de tots els comptes a final de cada mes (els comptes amb valoració manual poden ser estimats)."
      actions={
        <Segmented
          value={grouping}
          onChange={setGrouping}
          options={[
            { value: 'type', label: 'Per tipus' },
            { value: 'account', label: 'Per compte' },
          ]}
        />
      }
    >
      <div className="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <MiniStat label="Patrimoni" value={formatCents(last?.totalCents ?? 0)} hint={last?.estimated ? 'inclou estimacions' : undefined} />
        <MiniStat
          label="Variació del període"
          value={`${delta > 0 ? '+' : ''}${formatCents(delta)}`}
          tone={delta < 0 ? 'neg' : delta > 0 ? 'pos' : undefined}
          hint={change !== null && Number.isFinite(change) ? `${change > 0 ? '+' : ''}${formatPct(change, 1)}` : undefined}
        />
      </div>
      <Legend items={series.map((s) => ({ label: s.label, color: s.color }))} />
      <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
        <AreaChart data={points} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
          <CartesianGrid {...gridProps} />
          <XAxis {...xAxisProps} />
          <YAxis {...yAxisProps} />
          <Tooltip
            cursor={{ stroke: 'var(--color-chart-axis)' }}
            content={({ active, payload, label }) => (
              <ChartTooltip
                active={active}
                payload={payload}
                label={label}
                reverse
                hideZero
                footer={(row) => {
                  const p = row as NetWorthPoint | undefined;
                  return (
                    <span className="flex justify-between text-ink-muted">
                      Total{p?.estimated ? ' (≈)' : ''} <span className="amount font-medium text-ink">{formatCents(p?.totalCents ?? 0)}</span>
                    </span>
                  );
                }}
              />
            )}
          />
          {series.map((s) => (
            <Area
              key={s.key}
              dataKey={s.value}
              name={s.label}
              type="monotone"
              stackId="networth"
              stroke={s.color}
              strokeWidth={2}
              fill={s.color}
              fillOpacity={0.18}
              activeDot={{ r: 4, stroke: 'var(--color-surface)', strokeWidth: 2 }}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
