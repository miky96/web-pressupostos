import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { OTHER, type CategoryBreakdown } from '../../domain/charts';
import { formatCents } from '../../domain/money';
import { CategoryDot } from '../CategoryAvatar';
import { cx } from '../kit/cx';
import { CHART_HEIGHT, ChartCard, ChartTooltip, gridProps, xAxisProps, yAxisProps } from './chartKit';

export function CategoryChart({
  breakdown,
  nameOf,
  colorOf,
  selected,
  onSelect,
}: {
  breakdown: CategoryBreakdown;
  nameOf: (key: string) => string;
  colorOf: (key: string) => string;
  /** Categoria que es mostra a la tendència (es ressalta aquí). */
  selected?: string;
  onSelect: (key: string) => void;
}) {
  const { keys, totals, rows } = breakdown;
  const total = keys.reduce((s, k) => s + (totals.get(k) ?? 0), 0);
  const dim = (k: string) => !!selected && keys.includes(selected) && selected !== k;
  const pick = (k: string) => k !== OTHER && onSelect(k);

  return (
    <ChartCard title="Despesa per categoria" subtitle="Clica una categoria per veure'n la tendència.">
      <ul className="-mx-4 mb-4 flex gap-1.5 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0">
        {keys.map((k) => (
          <li key={k}>
            <button
              type="button"
              disabled={k === OTHER}
              onClick={() => pick(k)}
              className={cx(
                'inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs whitespace-nowrap transition',
                selected === k ? 'border-accent bg-accent-soft text-accent-ink' : 'border-line text-ink-muted hover:bg-subtle hover:text-ink',
                k === OTHER && 'cursor-default hover:bg-transparent',
              )}
            >
              <CategoryDot color={colorOf(k)} className="size-2" />
              <span className="font-medium text-ink">{nameOf(k)}</span>
              <span className="amount">{formatCents(totals.get(k) ?? 0)}</span>
              {total > 0 && <span className="text-ink-faint">{Math.round(((totals.get(k) ?? 0) / total) * 100)}%</span>}
            </button>
          </li>
        ))}
      </ul>
      <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
        <BarChart data={rows} margin={{ top: 4, right: 4, bottom: 0, left: 0 }} barCategoryGap="22%">
          <CartesianGrid {...gridProps} />
          <XAxis {...xAxisProps} />
          <YAxis {...yAxisProps} />
          <Tooltip
            cursor={{ fill: 'var(--color-subtle)' }}
            content={({ active, payload, label }) => (
              <ChartTooltip
                active={active}
                payload={payload}
                label={label}
                reverse
                hideZero
                footer={(row) => {
                  const values = (row as (typeof rows)[number] | undefined)?.values ?? {};
                  const sum = Object.values(values).reduce((s, c) => s + c, 0);
                  return (
                    <span className="flex justify-between text-ink-muted">
                      Total <span className="amount font-medium text-ink">{formatCents(sum)}</span>
                    </span>
                  );
                }}
              />
            )}
          />
          {keys.map((k, i) => (
            <Bar
              key={k}
              dataKey={(row: (typeof rows)[number]) => row.values[k] ?? 0}
              name={nameOf(k)}
              stackId="categories"
              fill={colorOf(k)}
              fillOpacity={dim(k) ? 0.25 : 1}
              stroke="var(--color-surface)"
              strokeWidth={1}
              radius={i === keys.length - 1 ? [4, 4, 0, 0] : undefined}
              maxBarSize={36}
              cursor={k === OTHER ? undefined : 'pointer'}
              onClick={() => pick(k)}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
