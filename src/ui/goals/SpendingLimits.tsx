import { useMemo, useState, type FormEvent } from 'react';
import { todayIso } from '../../domain/dates';
import { averageMonthlySpend, dailyAllowance, limitTone, monthLimits, saveLimit, type LimitStatus, type LimitTone } from '../../domain/limits';
import { formatCents, parseUserAmount } from '../../domain/money';
import { shiftMonth } from '../../domain/periods';
import { attributeForView } from '../../domain/recoveries';
import type { Category, SpendingLimit, Transaction } from '../../domain/types';
import { CategoryAvatar } from '../CategoryAvatar';
import { Button } from '../kit/Button';
import { Card, Stat } from '../kit/Card';
import { cx } from '../kit/cx';
import { Drawer } from '../kit/Drawer';
import { Alert, Badge, EmptyState, Segmented } from '../kit/Feedback';
import { Icon } from '../kit/Icon';
import { formatMonth } from '../labels';
import type { BudgetState } from '../useBudget';
import { useReportingView, VIEW_HINT, VIEW_OPTIONS } from '../useReportingView';
import { centsToInput, errorText, ProgressBar } from './shared';

const TONE_BAR: Record<LimitTone, 'accent' | 'warn' | 'neg'> = { ok: 'accent', warn: 'warn', over: 'neg' };

type Open = { mode: 'new' } | { mode: 'edit'; limit: SpendingLimit } | null;

export function SpendingLimits({ budget }: { budget: BudgetState }) {
  const data = budget.data!;
  const now = `${todayIso().slice(0, 10)}T23:59:59`;
  const currentMonth = now.slice(0, 7);
  const [month, setMonth] = useState(currentMonth);
  const [view, setView] = useReportingView();
  const [open, setOpen] = useState<Open>(null);

  const effective = useMemo(() => attributeForView(data.transactions, view), [data.transactions, view]);
  const ml = useMemo(() => monthLimits(data.limits, effective, month, now), [data.limits, effective, month, now]);
  const categories = useMemo(() => new Map(data.categories.map((c) => [c.id, c])), [data.categories]);
  const isCurrent = month === currentMonth;
  const remaining = ml.totalLimitCents - ml.totalSpentCents;
  const totalTone = ml.totalLimitCents ? limitTone(ml.totalSpentCents, ml.totalLimitCents, ml.elapsed) : 'ok';

  const newButton = (
    <Button variant="primary" icon="plus" onClick={() => setOpen({ mode: 'new' })}>
      Nou límit
    </Button>
  );

  return (
    <>
      {data.limits.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line-strong bg-surface">
          <EmptyState icon="sliders" title="Encara no tens cap límit" action={newButton}>
            Posa un màxim mensual a les categories on se t'escapen els diners (restaurants, compres, oci...) i mira com vas durant el mes.
          </EmptyState>
        </div>
      ) : (
        <>
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-1">
              <Button variant="ghost" icon="chevronLeft" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Mes anterior" />
              <span className="min-w-36 text-center text-[15px] font-semibold">{formatMonth(month)}</span>
              <Button variant="ghost" icon="chevronRight" onClick={() => setMonth(shiftMonth(month, 1))} aria-label="Mes següent" disabled={month >= currentMonth} />
              {!isCurrent && (
                <Button variant="ghost" size="sm" onClick={() => setMonth(currentMonth)}>
                  Avui
                </Button>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span title={VIEW_HINT[view]}>
                <Segmented value={view} options={VIEW_OPTIONS} onChange={setView} />
              </span>
              {newButton}
            </div>
          </div>

          <Card className="mb-6 p-5 sm:p-6">
            <div className="grid grid-cols-2 gap-5 sm:grid-cols-3">
              <Stat label="Gastat" value={formatCents(ml.totalSpentCents)} hint={`de ${formatCents(ml.totalLimitCents)} pressupostats`} className="col-span-2 sm:col-span-1" />
              <Stat label={remaining >= 0 ? 'Et queda' : "T'has passat"} value={formatCents(Math.abs(remaining))} tone={remaining < 0 ? 'neg' : undefined} size="md" />
              {isCurrent ? (
                <Stat
                  label="Pots gastar"
                  value={`${formatCents(dailyAllowance(remaining, ml.daysLeft))}/dia`}
                  hint={`${ml.daysLeft} ${ml.daysLeft === 1 ? 'dia' : 'dies'} fins a final de mes`}
                  size="md"
                />
              ) : (
                <Stat label="Límits complerts" value={`${ml.rows.filter((r) => r.tone !== 'over').length} de ${ml.rows.length}`} size="md" />
              )}
            </div>
            <ProgressBar className="mt-5" ratio={ml.totalLimitCents ? ml.totalSpentCents / ml.totalLimitCents : 0} marker={isCurrent ? ml.elapsed : undefined} tone={TONE_BAR[totalTone]} />
            {isCurrent && <p className="mt-2 text-xs text-ink-muted">La marca indica on hauries de ser avui si gastessis al mateix ritme tot el mes.</p>}
          </Card>

          <Card>
            <ul className="divide-y divide-line">
              {ml.rows.map((r) => (
                <LimitRow key={r.limit.id} row={r} category={categories.get(r.limit.categoryId)} marker={isCurrent ? ml.elapsed : undefined} onClick={() => setOpen({ mode: 'edit', limit: r.limit })} />
              ))}
            </ul>
          </Card>
          {ml.unlimitedSpentCents > 0 && (
            <p className="mt-3 px-1 text-sm text-ink-muted">
              A més, aquest mes has gastat <span className="amount font-medium text-ink">{formatCents(ml.unlimitedSpentCents)}</span> en categories sense límit.
            </p>
          )}
        </>
      )}

      {open && (
        <Drawer open onClose={() => setOpen(null)} title={open.mode === 'new' ? 'Nou límit' : 'Editar límit'} subtitle="Màxim que vols gastar cada mes">
          <LimitForm
            key={open.mode === 'edit' ? open.limit.id : 'new'}
            budget={budget}
            limit={open.mode === 'edit' ? open.limit : undefined}
            transactions={effective}
            month={currentMonth}
            onDone={() => setOpen(null)}
          />
        </Drawer>
      )}
    </>
  );
}

function LimitRow({ row, category, marker, onClick }: { row: LimitStatus; category?: Category; marker?: number; onClick: () => void }) {
  return (
    <li>
      <button className="group flex w-full items-center gap-4 px-4 py-3.5 text-left hover:bg-subtle/60" onClick={onClick}>
        <CategoryAvatar category={category} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-3">
            <span className="truncate text-sm font-medium">{category?.name ?? 'Categoria eliminada'}</span>
            <span className="amount shrink-0 text-sm">
              <span className="font-semibold">{formatCents(row.spentCents)}</span>
              <span className="text-ink-muted"> / {formatCents(row.limit.monthlyCents)}</span>
            </span>
          </div>
          <ProgressBar className="mt-2" ratio={row.ratio} marker={marker} tone={TONE_BAR[row.tone]} />
          <div className="mt-1.5 flex justify-between text-xs">
            <span className={cx(row.tone === 'over' ? 'text-neg' : row.tone === 'warn' ? 'text-warn' : 'text-ink-muted')}>
              {row.tone === 'over' ? `T'has passat ${formatCents(-row.remainingCents)}` : `Queden ${formatCents(row.remainingCents)}`}
            </span>
            <span className="text-ink-faint">{Math.round(row.ratio * 100)} %</span>
          </div>
        </div>
        <Icon name="chevronRight" className="size-4 text-ink-faint opacity-0 transition group-hover:opacity-100" />
      </button>
    </li>
  );
}

function LimitForm({
  budget,
  limit,
  transactions,
  month,
  onDone,
}: {
  budget: BudgetState;
  limit?: SpendingLimit;
  transactions: Transaction[];
  month: string;
  onDone: () => void;
}) {
  const data = budget.data!;
  const taken = new Set(data.limits.map((l) => l.categoryId));
  const options = data.categories
    .filter((c) => c.kind === 'expense' && (!taken.has(c.id) || c.id === limit?.categoryId))
    .sort((a, b) => a.name.localeCompare(b.name, 'ca'));
  const [categoryId, setCategoryId] = useState(limit?.categoryId ?? options[0]?.id ?? '');
  const [amount, setAmount] = useState(limit ? centsToInput(limit.monthlyCents) : '');
  const [error, setError] = useState<string | null>(null);
  const average = useMemo(() => (categoryId ? averageMonthlySpend(transactions, categoryId, month) : 0), [transactions, categoryId, month]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      const saved = saveLimit({ categoryId, monthlyCents: parseUserAmount(amount) }, data.categories);
      await budget.run((repo) => repo.upsertLimits([saved]));
      onDone();
    } catch (err) {
      setError(errorText(err));
    }
  }

  async function remove() {
    if (!limit) return;
    await budget.run((repo) => repo.deleteLimits([limit.id]));
    onDone();
  }

  if (!limit && options.length === 0) {
    return <Alert tone="info">Totes les categories de despesa ja tenen límit.</Alert>;
  }

  return (
    <form className="space-y-5" onSubmit={submit}>
      {error && (
        <Alert tone="neg" onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      <label className="label">
        Categoria
        <select className="input" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} disabled={!!limit} required>
          {options.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <label className="label">
        Límit mensual (€)
        <input className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0,00" required autoFocus />
      </label>
      {average > 0 && (
        <div className="flex items-center justify-between gap-3 rounded-lg bg-subtle px-3 py-2 text-sm">
          <span className="text-ink-muted">
            Mitjana dels últims 3 mesos: <span className="amount font-medium text-ink">{formatCents(average)}</span>
          </span>
          <Button size="sm" variant="ghost" onClick={() => setAmount(centsToInput(Math.ceil(average / 1000) * 1000))}>
            Fer-la servir
          </Button>
        </div>
      )}
      <div className="flex gap-2">
        <Button variant="primary" type="submit">
          Desar
        </Button>
        {limit && (
          <>
            <div className="flex-1" />
            <Button variant="danger" icon="trash" onClick={remove}>
              Treure el límit
            </Button>
          </>
        )}
      </div>
      {limit && <Badge tone="neutral">Els canvis s'apliquen a tots els mesos</Badge>}
    </form>
  );
}
