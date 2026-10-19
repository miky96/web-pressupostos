import { useMemo, useState, type FormEvent } from 'react';
import { accountBalance } from '../../domain/balances';
import { CATEGORY_COLORS } from '../../domain/categories';
import { todayIso } from '../../domain/dates';
import { addContribution, goalProgress, PACE_DAYS, removeContribution, saveGoal, sharedAccountIds, sortGoals, type GoalProgress, type GoalStatus } from '../../domain/goals';
import { formatCents, parseUserAmount } from '../../domain/money';
import type { SavingsGoal } from '../../domain/types';
import { Button } from '../kit/Button';
import { Card, Stat } from '../kit/Card';
import { cx } from '../kit/cx';
import { Drawer } from '../kit/Drawer';
import { Alert, Badge, EmptyState } from '../kit/Feedback';
import { Icon } from '../kit/Icon';
import { formatDate, formatLongDate, formatMonth } from '../labels';
import { newId, type BudgetState } from '../useBudget';
import { centsToInput, errorText, ProgressBar } from './shared';

const today = () => todayIso().slice(0, 10);
const DEFAULT_COLOR = CATEGORY_COLORS[0];

const STATUS: Record<GoalStatus, { label: string; tone: 'pos' | 'warn' | 'neg' } | null> = {
  reached: { label: 'Aconseguit', tone: 'pos' },
  'on-track': { label: 'Vas bé', tone: 'pos' },
  behind: { label: 'Vas just', tone: 'warn' },
  overdue: { label: 'Fora de termini', tone: 'neg' },
  'no-date': null,
};

/** Una frase que resumeix què cal fer (o com vas) per a cada objectiu. */
function outlook(goal: SavingsGoal, p: GoalProgress): string {
  const pace = p.paceMonthlyCents > 0 ? `${formatCents(p.paceMonthlyCents)}/mes` : null;
  switch (p.status) {
    case 'reached':
      return goal.archived ? 'Aconseguit.' : "Aconseguit! Quan vulguis, arxiva'l.";
    case 'overdue':
      return `La data (${formatDate(goal.targetDate!)}) ja ha passat i falten ${formatCents(p.remainingCents)}.`;
    case 'on-track':
    case 'behind':
      return `Cal estalviar ${formatCents(p.requiredMonthlyCents!)}/mes fins al ${formatDate(goal.targetDate!)}.` + (pace ? ` Ara hi poses ${pace}.` : '');
    default:
      return p.etaMonth ? `Al ritme actual (${pace}) hi arribes el ${formatMonth(p.etaMonth).toLowerCase()}.` : 'Els últims 3 mesos no hi has afegit res.';
  }
}

type Open = { mode: 'new' } | { mode: 'view'; id: string } | null;

export function SavingsGoals({ budget }: { budget: BudgetState }) {
  const data = budget.data!;
  const [open, setOpen] = useState<Open>(null);
  const [showArchived, setShowArchived] = useState(false);
  const now = `${todayIso().slice(0, 10)}T23:59:59`;

  const goals = useMemo(() => sortGoals(data.goals), [data.goals]);
  const progress = useMemo(() => new Map(goals.map((g) => [g.id, goalProgress(g, data, now)])), [goals, data, now]);
  const shared = useMemo(() => sharedAccountIds(goals), [goals]);
  const active = goals.filter((g) => !g.archived);
  const archived = goals.filter((g) => g.archived);
  const openGoal = open?.mode === 'view' ? goals.find((g) => g.id === open.id) : undefined;

  const totals = active.reduce(
    (s, g) => {
      const p = progress.get(g.id)!;
      return { saved: s.saved + Math.min(p.savedCents, g.targetCents), target: s.target + g.targetCents };
    },
    { saved: 0, target: 0 },
  );

  const newButton = (
    <Button variant="primary" icon="plus" onClick={() => setOpen({ mode: 'new' })}>
      Nou objectiu
    </Button>
  );

  const card = (g: SavingsGoal) => {
    const p = progress.get(g.id)!;
    const status = STATUS[p.status];
    return (
      <button
        key={g.id}
        onClick={() => setOpen({ mode: 'view', id: g.id })}
        className={cx('group flex flex-col rounded-xl border border-line bg-surface p-5 text-left shadow-card transition hover:border-line-strong', g.archived && 'opacity-75')}
      >
        <div className="flex items-start gap-3">
          <div className="grid size-9 shrink-0 place-items-center rounded-lg" style={{ backgroundColor: `color-mix(in srgb, ${g.color ?? DEFAULT_COLOR} 16%, transparent)`, color: g.color ?? DEFAULT_COLOR }}>
            <Icon name="target" className="size-[18px]" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate font-semibold">{g.name}</div>
            <div className="text-xs text-ink-muted">{g.targetDate ? `Per al ${formatDate(g.targetDate)}` : 'Sense data'}</div>
          </div>
          {status && <Badge tone={status.tone}>{status.label}</Badge>}
        </div>
        <div className="mt-5 flex items-baseline justify-between gap-2">
          <span className="amount text-xl font-semibold tracking-tight">{formatCents(p.savedCents)}</span>
          <span className="amount text-sm text-ink-muted">de {formatCents(g.targetCents)}</span>
        </div>
        <ProgressBar className="mt-2" ratio={p.ratio} color={g.color ?? DEFAULT_COLOR} />
        <div className="mt-1.5 flex justify-between text-xs text-ink-muted">
          <span>{Math.round(p.ratio * 100)} %</span>
          {p.remainingCents > 0 && <span className="amount">Falten {formatCents(p.remainingCents)}</span>}
        </div>
        <p className="mt-4 border-t border-line pt-3 text-[13px] text-ink-muted">{outlook(g, p)}</p>
      </button>
    );
  };

  return (
    <>
      {goals.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line-strong bg-surface">
          <EmptyState icon="target" title="Encara no tens cap objectiu" action={newButton}>
            Un cotxe, un viatge, un coixí d'emergència... Posa-hi un import i, si vols, una data i els comptes on guardes els diners.
          </EmptyState>
        </div>
      ) : (
        <>
          <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
            <Card className="grid flex-1 grid-cols-2 gap-5 p-5 sm:grid-cols-3">
              <Stat label="Estalviat" value={formatCents(totals.saved)} className="col-span-2 sm:col-span-1" />
              <Stat label="Objectius" value={formatCents(totals.target)} size="md" hint={`${active.length} ${active.length === 1 ? 'actiu' : 'actius'}`} />
              <Stat label="Falta" value={formatCents(Math.max(totals.target - totals.saved, 0))} size="md" />
            </Card>
            {newButton}
          </div>

          {shared.size > 0 && (
            <Alert tone="warn" className="mb-6">
              Hi ha comptes vinculats a més d'un objectiu: el seu saldo compta sencer a cadascun. Si els comparteixen, millor fer servir aportacions manuals.
            </Alert>
          )}

          {active.length > 0 ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{active.map(card)}</div>
          ) : (
            <Alert tone="pos">Tots els objectius estan arxivats. Crea'n un de nou quan vulguis.</Alert>
          )}

          {archived.length > 0 && (
            <div className="mt-8">
              <button className="mb-3 inline-flex items-center gap-1 text-[13px] font-semibold text-ink-muted hover:text-ink" onClick={() => setShowArchived((s) => !s)}>
                <Icon name={showArchived ? 'chevronDown' : 'chevronRight'} className="size-4" />
                Arxivats ({archived.length})
              </button>
              {showArchived && <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{archived.map(card)}</div>}
            </div>
          )}
        </>
      )}

      {open?.mode === 'new' && (
        <Drawer open onClose={() => setOpen(null)} title="Nou objectiu" subtitle="Per a què estalvies?">
          <GoalForm budget={budget} onDone={(id) => setOpen({ mode: 'view', id })} onCancel={() => setOpen(null)} />
        </Drawer>
      )}
      {openGoal && <GoalDrawer key={openGoal.id} budget={budget} goal={openGoal} progress={progress.get(openGoal.id)!} onClose={() => setOpen(null)} />}
    </>
  );
}

function GoalForm({ budget, goal, onDone, onCancel }: { budget: BudgetState; goal?: SavingsGoal; onDone: (id: string) => void; onCancel: () => void }) {
  const data = budget.data!;
  const [name, setName] = useState(goal?.name ?? '');
  const [target, setTarget] = useState(goal ? centsToInput(goal.targetCents) : '');
  const [date, setDate] = useState(goal?.targetDate?.slice(0, 10) ?? '');
  const [accountIds, setAccountIds] = useState<string[]>(goal?.accountIds ?? []);
  const [color, setColor] = useState(goal?.color ?? DEFAULT_COLOR);
  const [notes, setNotes] = useState(goal?.notes ?? '');
  const [error, setError] = useState<string | null>(null);
  const now = `${todayIso().slice(0, 10)}T23:59:59`;
  const accounts = data.accounts.filter((a) => !a.archived || accountIds.includes(a.id));

  const toggle = (id: string) => setAccountIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));

  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      const saved = saveGoal({ name, targetCents: parseUserAmount(target), targetDate: date || undefined, accountIds, color, notes }, goal?.id ?? newId('goal'), now, goal);
      await budget.run((repo) => repo.upsertGoals([saved]));
      onDone(saved.id);
    } catch (err) {
      setError(errorText(err));
    }
  }

  return (
    <form className="space-y-5" onSubmit={submit}>
      {error && (
        <Alert tone="neg" onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      <label className="label">
        Nom
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="p.ex. Cotxe nou" required autoFocus={!goal} />
      </label>
      <div className="grid grid-cols-2 gap-4">
        <label className="label">
          Import objectiu (€)
          <input className="input" inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="0,00" required />
        </label>
        <label className="label">
          Data límit
          <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} min={goal ? undefined : today()} />
        </label>
      </div>
      <fieldset className="space-y-2">
        <legend className="text-[13px] font-medium">Comptes vinculats</legend>
        <p className="hint">El saldo actual dels comptes que marquis compta com a estalviat. Si no en marques cap, apunta les aportacions a mà.</p>
        {accounts.length === 0 ? (
          <p className="text-sm text-ink-muted">No tens comptes creats.</p>
        ) : (
          <ul className="divide-y divide-line rounded-lg border border-line">
            {accounts.map((a) => (
              <li key={a.id}>
                <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-subtle/60">
                  <input type="checkbox" className="size-4 accent-[var(--color-accent)]" checked={accountIds.includes(a.id)} onChange={() => toggle(a.id)} />
                  <span className="min-w-0 flex-1 truncate">{a.name}</span>
                  <span className="amount text-ink-muted">{formatCents(accountBalance(a, data.transactions, data.valuations, now).cents)}</span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </fieldset>
      <fieldset>
        <legend className="mb-2 text-[13px] font-medium">Color</legend>
        <div className="flex flex-wrap gap-2">
          {CATEGORY_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setColor(c)}
              className={cx('size-7 rounded-full ring-offset-2 ring-offset-surface transition', c === color && 'ring-2 ring-ink')}
              style={{ backgroundColor: c }}
              aria-label={`Color ${c}`}
              aria-pressed={c === color}
            />
          ))}
        </div>
      </fieldset>
      <label className="label">
        Notes
        <textarea className="input h-auto min-h-20 py-2" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Opcional" />
      </label>
      <div className="flex gap-2">
        <Button variant="primary" type="submit">
          Desar
        </Button>
        <Button onClick={onCancel}>Cancel·lar</Button>
      </div>
    </form>
  );
}

function GoalDrawer({ budget, goal, progress: p, onClose }: { budget: BudgetState; goal: SavingsGoal; progress: GoalProgress; onClose: () => void }) {
  const data = budget.data!;
  const [editing, setEditing] = useState(false);
  const [date, setDate] = useState(today());
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const now = `${todayIso().slice(0, 10)}T23:59:59`;
  const linked = goal.accountIds.map((id) => data.accounts.find((a) => a.id === id)).filter((a) => !!a);
  const status = STATUS[p.status];

  async function submitContribution(e: { preventDefault(): void }, sign: 1 | -1) {
    e.preventDefault();
    try {
      const cents = Math.abs(parseUserAmount(amount)) * sign;
      await budget.run((repo) => repo.upsertGoals([addContribution(goal, { date, amountCents: cents, note }, newId('ctb'))]));
      setAmount('');
      setNote('');
    } catch (err) {
      setError(errorText(err));
    }
  }

  async function remove() {
    if (!window.confirm(`Eliminar l'objectiu "${goal.name}"? Els comptes i moviments no es toquen.`)) return;
    await budget.run((repo) => repo.deleteGoals([goal.id]));
    onClose();
  }

  const toggleArchived = () => budget.run((repo) => repo.upsertGoals([{ ...goal, archived: !goal.archived || undefined }]));

  return (
    <Drawer
      open
      onClose={onClose}
      title={goal.name}
      subtitle={goal.targetDate ? `Per al ${formatLongDate(goal.targetDate)}` : 'Sense data límit'}
      footer={
        <>
          <Button variant="danger" icon="trash" onClick={remove}>
            Eliminar
          </Button>
          <div className="flex-1" />
          <Button onClick={toggleArchived}>{goal.archived ? 'Desarxivar' : 'Arxivar'}</Button>
          <Button icon="edit" onClick={() => setEditing((v) => !v)}>
            {editing ? 'Tancar edició' : 'Editar'}
          </Button>
        </>
      }
    >
      {editing ? (
        <GoalForm budget={budget} goal={goal} onDone={() => setEditing(false)} onCancel={() => setEditing(false)} />
      ) : (
        <div className="space-y-7">
          {error && (
            <Alert tone="neg" onClose={() => setError(null)}>
              {error}
            </Alert>
          )}
          <div>
            <div className="flex items-end justify-between gap-3">
              <Stat label="Estalviat" value={formatCents(p.savedCents)} hint={`de ${formatCents(goal.targetCents)} · ${Math.round(p.ratio * 100)} %`} />
              {status && <Badge tone={status.tone}>{status.label}</Badge>}
            </div>
            <ProgressBar className="mt-4" ratio={p.ratio} color={goal.color ?? DEFAULT_COLOR} />
            <p className="mt-3 text-sm text-ink-muted">{outlook(goal, p)}</p>
            <dl className="mt-4 divide-y divide-line border-t border-line text-sm">
              {linked.map((a) => (
                <div key={a.id} className="flex justify-between gap-4 py-2">
                  <dt className="flex min-w-0 items-center gap-1.5 text-ink-muted">
                    <Icon name="link" className="size-3.5 shrink-0" />
                    <span className="truncate">{a.name}</span>
                  </dt>
                  <dd className="amount font-medium">{formatCents(accountBalance(a, data.transactions, data.valuations, now).cents)}</dd>
                </div>
              ))}
              {(goal.contributions.length > 0 || linked.length === 0) && (
                <div className="flex justify-between py-2">
                  <dt className="text-ink-muted">Aportacions manuals</dt>
                  <dd className="amount font-medium">{formatCents(p.manualCents)}</dd>
                </div>
              )}
              {p.remainingCents > 0 && (
                <div className="flex justify-between py-2">
                  <dt className="text-ink-muted">Falten</dt>
                  <dd className="amount font-medium">{formatCents(p.remainingCents)}</dd>
                </div>
              )}
              <div className="flex justify-between py-2">
                <dt className="text-ink-muted" title={`Variació de l'estalviat els últims ${PACE_DAYS} dies`}>
                  Ritme (últims 3 mesos)
                </dt>
                <dd className={cx('amount font-medium', p.paceMonthlyCents < 0 && 'text-neg')}>{formatCents(p.paceMonthlyCents)}/mes</dd>
              </div>
              {p.requiredMonthlyCents !== undefined && (
                <div className="flex justify-between py-2">
                  <dt className="text-ink-muted">Necessari per arribar-hi</dt>
                  <dd className="amount font-medium">{formatCents(p.requiredMonthlyCents)}/mes</dd>
                </div>
              )}
              {goal.notes && (
                <div className="py-2">
                  <dt className="text-ink-muted">Notes</dt>
                  <dd className="mt-1 whitespace-pre-wrap">{goal.notes}</dd>
                </div>
              )}
            </dl>
          </div>

          <section className="space-y-3">
            <div>
              <h3 className="text-sm font-semibold">Aportació manual</h3>
              <p className="hint">Per a diners que no són a cap compte vinculat (efectiu, un altre banc...).</p>
            </div>
            <form className="space-y-2" onSubmit={(e) => submitContribution(e, 1)}>
              <div className="flex gap-2">
                <input className="input w-auto" type="date" value={date} onChange={(e) => setDate(e.target.value)} required aria-label="Data" />
                <input className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Import (€)" required aria-label="Import" />
              </div>
              <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Nota (opcional)" />
              <div className="flex gap-2">
                <Button type="submit" size="sm" variant="primary" icon="plus">
                  Afegir
                </Button>
                <Button size="sm" onClick={(e) => submitContribution(e, -1)} disabled={!amount}>
                  Treure
                </Button>
              </div>
            </form>
            {goal.contributions.length > 0 && (
              <ul className="divide-y divide-line rounded-lg border border-line">
                {[...goal.contributions].reverse().map((c) => (
                  <li key={c.id} className="group flex items-center gap-3 px-3 py-2 text-sm">
                    <span className="text-ink-muted">{formatDate(c.date)}</span>
                    <span className="min-w-0 flex-1 truncate text-xs text-ink-faint">{c.note}</span>
                    <span className={cx('amount font-medium', c.amountCents > 0 ? 'text-pos' : 'text-neg')}>{formatCents(c.amountCents)}</span>
                    <button
                      className="text-ink-faint opacity-0 group-hover:opacity-100 hover:text-neg max-lg:opacity-100"
                      onClick={() => budget.run((repo) => repo.upsertGoals([removeContribution(goal, c.id)]))}
                      aria-label="Eliminar aportació"
                    >
                      <Icon name="trash" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </Drawer>
  );
}
