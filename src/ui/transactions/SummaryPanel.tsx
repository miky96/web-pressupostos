import { useState, type ReactNode } from 'react';
import { formatCents, type Cents } from '../../domain/money';
import { relativeChange } from '../../domain/periods';
import { UNCATEGORIZED, type PeriodSummary } from '../../domain/summary';
import type { ReportingView } from '../../domain/recoveries';
import type { Category } from '../../domain/types';
import { CategoryDot } from '../CategoryAvatar';
import { Card } from '../kit/Card';
import { cx } from '../kit/cx';
import { Icon } from '../kit/Icon';
import { formatPct } from '../labels';

const TOP = 6;

function Delta({ current, previous, label, inverse }: { current: number; previous?: number; label: string; inverse?: boolean }) {
  if (previous === undefined) return null;
  const change = relativeChange(current, previous);
  if (change === null || !Number.isFinite(change)) return <span className="text-ink-faint">— vs {label}</span>;
  const good = inverse ? change <= 0 : change >= 0;
  return (
    <span className="inline-flex items-center gap-1">
      <span className={cx('font-medium', Math.abs(change) < 0.005 ? 'text-ink-muted' : good ? 'text-pos' : 'text-neg')}>
        {change > 0 ? '↑' : change < 0 ? '↓' : ''} {formatPct(Math.abs(change), 0)}
      </span>
      <span className="text-ink-faint">vs {label}</span>
    </span>
  );
}

function Kpi({ label, value, tone, children }: { label: string; value: string; tone?: 'pos' | 'neg'; children?: ReactNode }) {
  return (
    <div className="min-w-0 px-3 py-3 sm:px-5 sm:py-4">
      <div className="text-xs font-medium text-ink-muted sm:text-[13px]">{label}</div>
      <div className={cx('amount mt-1 text-base leading-tight sm:text-[26px] font-semibold tracking-tight', tone === 'pos' && 'text-pos', tone === 'neg' && 'text-neg')}>
        {value}
      </div>
      <div className="mt-1 text-[11px] sm:text-xs">{children}</div>
    </div>
  );
}

export function SummaryPanel({
  totals,
  previous,
  previousLabel,
  byCategory,
  categories,
  activeCategoryId,
  onPickCategory,
  reportingView,
  elsewhereCents = 0,
  pendingRecoveryCents = 0,
  pendingDebtCents = 0,
  onOpenPending,
}: {
  totals: PeriodSummary;
  previous?: PeriodSummary;
  previousLabel: string;
  byCategory: Map<string, Cents>;
  categories: Map<string, Category>;
  activeCategoryId?: string;
  onPickCategory: (id: string | undefined) => void;
  reportingView: ReportingView;
  /** Recuperacions d'aquest període que la vista de consum compta al mes de la compra. */
  elsewhereCents?: Cents;
  pendingRecoveryCents?: Cents;
  pendingDebtCents?: Cents;
  onOpenPending?: () => void;
}) {
  const pendingTotal = pendingRecoveryCents + pendingDebtCents;
  const [showAll, setShowAll] = useState(false);
  const income = totals.incomeCents + totals.interestCents;
  const prevIncome = previous && previous.incomeCents + previous.interestCents;
  const savingsRate = income > 0 ? totals.savingsCents / income : null;

  const rows = [...byCategory.entries()].filter(([, c]) => c > 0).sort((a, b) => b[1] - a[1]);
  const totalExpense = rows.reduce((s, [, c]) => s + c, 0);
  const visible = showAll ? rows : rows.slice(0, TOP);
  const colorOf = (id: string) => (id === UNCATEGORIZED ? '#c4c9d4' : categories.get(id)?.color);
  const nameOf = (id: string) => (id === UNCATEGORIZED ? 'Sense categoria' : (categories.get(id)?.name ?? id));

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
      <Card className="grid grid-cols-3 divide-x divide-line lg:col-span-5">
        <Kpi label="Ingressos" value={formatCents(income)}>
          <Delta current={income} previous={prevIncome} label={previousLabel} />
        </Kpi>
        <Kpi label="Despesa real" value={formatCents(totals.netExpenseCents)}>
          <Delta current={totals.netExpenseCents} previous={previous?.netExpenseCents} label={previousLabel} inverse />
          {totals.refundsCents + totals.reimbursementsCents > 0 && (
            <div className="mt-0.5 text-ink-faint max-sm:hidden">
              ja descomptats {formatCents(totals.refundsCents + totals.reimbursementsCents)}{' '}
              {reportingView === 'consumption' ? 'de devolucions i del que esperes recuperar' : 'de devolucions'}
            </div>
          )}
          {elsewhereCents > 0 && (
            <div className="mt-0.5 text-ink-faint max-sm:hidden" title="Devolucions i Bizums d'aquest període enllaçats a compres d'altres períodes">
              {formatCents(elsewhereCents)} recuperats compten al mes de la compra
            </div>
          )}
        </Kpi>
        <Kpi label="Estalvi" value={formatCents(totals.savingsCents)} tone={totals.savingsCents < 0 ? 'neg' : 'pos'}>
          {savingsRate !== null ? (
            <span className="text-ink-muted">
              Taxa d'estalvi <span className="font-medium text-ink">{formatPct(savingsRate, 0)}</span>
            </span>
          ) : (
            <span className="text-ink-faint">Sense ingressos en aquest període</span>
          )}
        </Kpi>
      </Card>

      {pendingTotal > 0 && (
        <button
          onClick={onOpenPending}
          disabled={!onOpenPending}
          className="flex min-w-0 items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3 text-left text-sm shadow-card transition enabled:hover:bg-subtle lg:col-span-5"
        >
          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-accent-soft text-accent-ink">
            <Icon name="link" className="size-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="font-medium">Pendent de cobrar: {formatCents(pendingTotal)}</span>
            <span className="block truncate text-xs text-ink-muted">
              {[pendingRecoveryCents > 0 && `${formatCents(pendingRecoveryCents)} de despeses compartides`, pendingDebtCents > 0 && `${formatCents(pendingDebtCents)} de deutes`]
                .filter(Boolean)
                .join(' · ')}
            </span>
          </span>
          {onOpenPending && <Icon name="chevronRight" className="size-4 text-ink-faint" />}
        </button>
      )}

      {rows.length > 0 && (
        <Card className="px-5 py-4 lg:col-span-5">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-[15px] font-semibold">On van els diners</h3>
            {activeCategoryId && (
              <button className="inline-flex items-center gap-1 text-xs font-medium text-accent" onClick={() => onPickCategory(undefined)}>
                <Icon name="x" className="size-3.5" /> Treure filtre
              </button>
            )}
          </div>
          {/* Barra apilada */}
          <div className="mb-4 flex h-2.5 overflow-hidden rounded-full bg-subtle">
            {rows.map(([id, c]) => (
              <div
                key={id}
                title={`${nameOf(id)}: ${formatCents(c)}`}
                className={cx('h-full transition-opacity', activeCategoryId && activeCategoryId !== id && 'opacity-25')}
                style={{ width: `${(c / totalExpense) * 100}%`, backgroundColor: colorOf(id) }}
              />
            ))}
          </div>
          <ul className="grid gap-x-8 gap-y-1 md:grid-cols-2">
            {visible.map(([id, c]) => {
              const active = activeCategoryId === id;
              return (
                <li key={id}>
                  <button
                    onClick={() => onPickCategory(active ? undefined : id)}
                    className={cx(
                      '-mx-2 flex w-[calc(100%+1rem)] items-center gap-3 rounded-lg px-2 py-1.5 text-left text-sm transition hover:bg-subtle',
                      active && 'bg-accent-soft hover:bg-accent-soft',
                      activeCategoryId && !active && 'opacity-50',
                    )}
                  >
                    <CategoryDot color={colorOf(id)} />
                    <span className="min-w-0 flex-1 truncate">{nameOf(id)}</span>
                    <span className="w-10 text-right text-xs text-ink-faint tabular-nums">{Math.round((c / totalExpense) * 100)}%</span>
                    <span className="amount w-24 text-right font-medium">{formatCents(c)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          {rows.length > TOP && (
            <button className="mt-2 text-xs font-medium text-accent" onClick={() => setShowAll((s) => !s)}>
              {showAll ? 'Mostrar menys' : `Veure totes (${rows.length})`}
            </button>
          )}
        </Card>
      )}
    </div>
  );
}
