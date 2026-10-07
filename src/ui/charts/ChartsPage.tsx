import { useMemo, useState } from 'react';
import { categoryBreakdown, categoryTrend, endOfMonth, monthlyCashflow, monthsBetween, monthsForRange, netWorthByMonth, OTHER } from '../../domain/charts';
import { todayIso } from '../../domain/dates';
import { latestMonth, periodRange, shiftMonth } from '../../domain/periods';
import { UNCATEGORIZED } from '../../domain/summary';
import type { Transaction } from '../../domain/types';
import { Button } from '../kit/Button';
import { PageHeader } from '../kit/Card';
import { EmptyState, Segmented } from '../kit/Feedback';
import type { BudgetState } from '../useBudget';
import { AccountFilter } from './AccountFilter';
import { CashflowChart } from './CashflowChart';
import { CategoryChart } from './CategoryChart';
import { SERIES_OTHER } from './chartKit';
import { NetWorthChart } from './NetWorthChart';
import { TrendChart, type TrendOption } from './TrendChart';

type ChartPeriod = { kind: 'last12' } | { kind: 'year'; year: string } | { kind: 'all' } | { kind: 'range'; from?: string; to?: string };

const UNCATEGORIZED_COLOR = '#c4c9d4';

/** Mesos que mostra cada període. Mai més enllà del mes en curs. */
function monthsOf(p: ChartPeriod, txs: Transaction[], today: string): string[] {
  const current = today.slice(0, 7);
  switch (p.kind) {
    case 'last12': {
      const end = latestMonth(txs, today);
      return monthsBetween(shiftMonth(end, -11), end);
    }
    case 'year':
      return monthsBetween(`${p.year}-01`, `${p.year}-12` < current ? `${p.year}-12` : current);
    case 'all':
      return monthsForRange(txs, {});
    case 'range':
      return monthsForRange(txs, periodRange(p));
  }
}

/** Default export perquè la pàgina (i Recharts) es carreguin en diferit amb React.lazy. */
export default function ChartsPage({ budget }: { budget: BudgetState }) {
  const { data, lookups } = budget;
  const today = todayIso();
  const [period, setPeriod] = useState<ChartPeriod>({ kind: 'last12' });
  const [accountIds, setAccountIds] = useState<Set<string> | null>(null);
  const [trendId, setTrendId] = useState<string | null>(null);

  const view = useMemo(() => {
    if (!data) return null;
    const accounts = accountIds ? data.accounts.filter((a) => accountIds.has(a.id)) : data.accounts;
    const ofAccounts = accountIds ? data.transactions.filter((t) => accountIds.has(t.accountId)) : data.transactions;
    const months = monthsOf(period, ofAccounts, today);
    if (!months.length) return { months, accounts, charts: null };
    const from = `${months[0]}-01T00:00:00`;
    const to = endOfMonth(months.at(-1)!);
    const txs = ofAccounts.filter((t) => t.date >= from && t.date <= to);
    return {
      months,
      accounts,
      charts: {
      cashflow: monthlyCashflow(txs, months),
      breakdown: categoryBreakdown(txs, months, 6),
      txs,
      // El patrimoni necessita tot l'historial anterior per calcular els saldos.
      netWorth: netWorthByMonth(accounts, ofAccounts, data.valuations, months, today),
      },
    };
  }, [data, accountIds, period, today]);

  const trendOptions = useMemo<TrendOption[]>(
    () => [
      ...(data?.categories ?? []).map((c) => ({ id: c.id, name: c.name, kind: c.kind })).sort((a, b) => a.name.localeCompare(b.name, 'ca')),
      { id: UNCATEGORIZED, name: 'Sense categoria', kind: 'expense' as const },
    ],
    [data],
  );

  if (!data || !view) return null;
  const { charts } = view;

  const nameOf = (k: string) => (k === OTHER ? 'Altres' : k === UNCATEGORIZED ? 'Sense categoria' : (lookups.categories.get(k)?.name ?? k));
  const colorOf = (k: string) => (k === OTHER ? SERIES_OTHER : k === UNCATEGORIZED ? UNCATEGORIZED_COLOR : (lookups.categories.get(k)?.color ?? '#8a93a6'));

  // Per defecte, la tendència mostra la categoria amb més despesa del període.
  const defaultTrend = charts?.breakdown.keys.find((k) => k !== OTHER) ?? trendOptions[0]?.id;
  const trendKey = trendId ?? defaultTrend;
  const trendOption = trendOptions.find((o) => o.id === trendKey);

  const year = period.kind === 'year' ? period.year : today.slice(0, 4);
  const changeKind = (kind: ChartPeriod['kind']) => {
    if (kind === period.kind) return;
    if (kind === 'year') setPeriod({ kind, year: latestMonth(data.transactions, today).slice(0, 4) });
    else if (kind === 'range') setPeriod({ kind, from: view.months[0] && `${view.months[0]}-01` });
    else setPeriod({ kind });
  };

  return (
    <section>
      <PageHeader title="Gràfiques" subtitle="Com evolucionen els ingressos, les despeses i el patrimoni." />

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <Segmented
          value={period.kind}
          onChange={changeKind}
          options={[
            { value: 'last12', label: '12 mesos' },
            { value: 'year', label: 'Any' },
            { value: 'all', label: 'Tot' },
            { value: 'range', label: 'Dates' },
          ]}
        />
        {period.kind === 'year' && (
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" icon="chevronLeft" aria-label="Any anterior" onClick={() => setPeriod({ kind: 'year', year: String(Number(year) - 1) })} />
            <span className="min-w-12 text-center font-semibold">{year}</span>
            <Button
              variant="ghost"
              size="sm"
              icon="chevronRight"
              aria-label="Any següent"
              disabled={year >= today.slice(0, 4)}
              onClick={() => setPeriod({ kind: 'year', year: String(Number(year) + 1) })}
            />
          </div>
        )}
        {period.kind === 'range' && (
          <div className="flex items-center gap-2">
            <input type="date" className="input h-8 w-auto" value={period.from ?? ''} onChange={(e) => setPeriod({ ...period, from: e.target.value || undefined })} aria-label="Des de" />
            <span className="text-ink-faint">–</span>
            <input type="date" className="input h-8 w-auto" value={period.to ?? ''} onChange={(e) => setPeriod({ ...period, to: e.target.value || undefined })} aria-label="Fins a" />
          </div>
        )}
        <div className="ml-auto">
          <AccountFilter accounts={data.accounts} selected={accountIds} onChange={setAccountIds} />
        </div>
      </div>

      {!charts ? (
        <div className="rounded-xl border border-dashed border-line-strong bg-surface">
          <EmptyState icon="chart" title="No hi ha moviments en aquest període">
            Importa un extracte o tria un altre període per veure les gràfiques.
          </EmptyState>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5">
          <CashflowChart points={charts.cashflow} />
          {charts.breakdown.keys.length > 0 && (
            <CategoryChart breakdown={charts.breakdown} nameOf={nameOf} colorOf={colorOf} selected={trendId ?? undefined} onSelect={setTrendId} />
          )}
          {trendOption && (
            <TrendChart
              series={categoryTrend(charts.txs, view.months, trendOption.id, trendOption.kind)}
              options={trendOptions}
              selected={trendOption.id}
              onSelect={setTrendId}
              name={trendOption.name}
              color={colorOf(trendOption.id)}
              kind={trendOption.kind}
            />
          )}
          <NetWorthChart points={charts.netWorth} accounts={view.accounts} allAccounts={data.accounts} />
        </div>
      )}
    </section>
  );
}
