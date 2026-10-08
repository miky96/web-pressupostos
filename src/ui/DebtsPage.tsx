import { useMemo, useState, type FormEvent } from 'react';
import { todayIso } from '../domain/dates';
import { addRepayment, isSettled, knownPeople, lastRepaymentDate, linkRepaymentTx, pendingCents, releaseDebtTxs, removeRepayment, repaidCents, saveDebt, summarizeDebts } from '../domain/debts';
import { pendingRecoveries, setRecoveryClosed, suggestRepaymentTxs, type RecoveryStatus } from '../domain/recoveries';
import { formatCents, parseUserAmount } from '../domain/money';
import type { Debt } from '../domain/types';
import { Button } from './kit/Button';
import { Card, PageHeader, Stat } from './kit/Card';
import { cx } from './kit/cx';
import { Drawer } from './kit/Drawer';
import { Alert, Badge, EmptyState } from './kit/Feedback';
import { Icon } from './kit/Icon';
import { formatDate, formatLongDate } from './labels';
import { newId, type BudgetState } from './useBudget';

const today = () => todayIso().slice(0, 10);
const centsToInput = (c: number) => (c / 100).toFixed(2).replace('.', ',');
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

function PersonAvatar({ name, className }: { name: string; className?: string }) {
  return <div className={cx('grid size-9 shrink-0 place-items-center rounded-full bg-accent-soft text-[13px] font-semibold text-accent-ink uppercase', className)}>{name.charAt(0)}</div>;
}

function Progress({ debt }: { debt: Debt }) {
  const ratio = Math.min(repaidCents(debt) / debt.amountCents, 1);
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-subtle">
      <div className="h-full rounded-full bg-pos" style={{ width: `${ratio * 100}%` }} />
    </div>
  );
}

type Open = { mode: 'new'; person?: string } | { mode: 'view'; id: string } | null;

export function DebtsPage({ budget }: { budget: BudgetState }) {
  const { data } = budget;
  const [open, setOpen] = useState<Open>(null);
  const [showSettled, setShowSettled] = useState(false);
  const debts = useMemo(() => data?.debts ?? [], [data]);
  const summary = useMemo(() => summarizeDebts(debts), [debts]);
  const shared = useMemo(() => pendingRecoveries(data?.transactions ?? []), [data]);
  if (!data) return null;
  const sharedPending = shared.reduce((s, r) => s + r.pendingCents, 0);

  const settled = debts.filter(isSettled).sort((a, b) => (lastRepaymentDate(b) ?? b.date).localeCompare(lastRepaymentDate(a) ?? a.date));
  const openDebt = open?.mode === 'view' ? debts.find((d) => d.id === open.id) : undefined;

  const debtRow = (d: Debt) => (
    <li key={d.id}>
      <button className="group flex w-full items-center gap-4 px-4 py-3 text-left hover:bg-subtle/60" onClick={() => setOpen({ mode: 'view', id: d.id })}>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{d.reason || 'Sense motiu'}</div>
          <div className="mt-0.5 text-xs text-ink-muted">
            {formatDate(d.date)}
            {d.repayments.length > 0 && ` · ${d.repayments.length} ${d.repayments.length === 1 ? 'retorn' : 'retorns'}`}
          </div>
          {!isSettled(d) && d.repayments.length > 0 && (
            <div className="mt-2 max-w-48">
              <Progress debt={d} />
            </div>
          )}
        </div>
        <div className="text-right">
          {isSettled(d) ? (
            <>
              <div className="amount text-sm font-medium text-ink-muted line-through">{formatCents(d.amountCents)}</div>
              <div className="text-xs text-pos">Saldat {lastRepaymentDate(d) ? formatDate(lastRepaymentDate(d)!) : ''}</div>
            </>
          ) : (
            <>
              <div className="amount text-sm font-semibold">{formatCents(pendingCents(d))}</div>
              {d.repayments.length > 0 && <div className="amount text-xs text-ink-faint">de {formatCents(d.amountCents)}</div>}
            </>
          )}
        </div>
        <Icon name="chevronRight" className="size-4 text-ink-faint opacity-0 transition group-hover:opacity-100" />
      </button>
    </li>
  );

  return (
    <section className="max-w-4xl">
      <PageHeader
        title="Deutes"
        subtitle="Diners que t'han de tornar: préstecs (pots crear-los des d'un Bizum enviat) i despeses que has pagat per altres. Enllaça els Bizums que et fan perquè no comptin com a ingrés."
        actions={
          <Button variant="primary" icon="plus" onClick={() => setOpen({ mode: 'new' })}>
            Nou deute
          </Button>
        }
      />

      {shared.length > 0 && <SharedExpenses items={shared} total={sharedPending} budget={budget} />}

      {debts.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line-strong bg-surface">
          <EmptyState
            icon="users"
            title={shared.length ? 'Cap préstec pendent' : 'Ningú et deu diners'}
            action={
              <Button variant="primary" icon="plus" onClick={() => setOpen({ mode: 'new' })}>
                Apuntar un deute
              </Button>
            }
          >
            Quan deixis diners a algú, apunta-ho aquí per no perdre'n el compte.
          </EmptyState>
        </div>
      ) : (
        <>
          <Card className="mb-8 grid grid-cols-2 gap-5 p-5 sm:grid-cols-3 sm:p-6">
            <Stat label="Et deuen" value={formatCents(summary.pendingCents)} className="col-span-2 sm:col-span-1" />
            <Stat label="Deixat en total" value={formatCents(summary.lentCents)} size="md" />
            <Stat label="Ja retornat" value={formatCents(summary.repaidCents)} tone="pos" size="md" />
          </Card>

          {summary.byPerson.length === 0 && (
            <Alert tone="pos" className="mb-8">
              Tot saldat: ningú et deu res.
            </Alert>
          )}

          <div className="space-y-4">
            {summary.byPerson.map((p) => (
              <Card key={p.person}>
                <div className="flex items-center gap-3 border-b border-line px-4 py-3">
                  <PersonAvatar name={p.person} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold">{p.person}</div>
                    <div className="text-xs text-ink-muted">
                      {p.debts.length} {p.debts.length === 1 ? 'deute pendent' : 'deutes pendents'}
                    </div>
                  </div>
                  <div className="amount text-lg font-semibold">{formatCents(p.pendingCents)}</div>
                  <Button variant="ghost" size="sm" icon="plus" onClick={() => setOpen({ mode: 'new', person: p.person })} aria-label={`Nou deute de ${p.person}`} title="Nou deute d'aquesta persona" />
                </div>
                <ul className="divide-y divide-line">{p.debts.map(debtRow)}</ul>
              </Card>
            ))}
          </div>

          {settled.length > 0 && (
            <div className="mt-8">
              <button className="mb-3 inline-flex items-center gap-1 text-[13px] font-semibold text-ink-muted hover:text-ink" onClick={() => setShowSettled((s) => !s)}>
                <Icon name={showSettled ? 'chevronDown' : 'chevronRight'} className="size-4" />
                Saldats ({settled.length})
              </button>
              {showSettled && (
                <ul className="divide-y divide-line rounded-xl border border-line bg-surface opacity-80 shadow-card">
                  {settled.map((d) => debtRow({ ...d, reason: `${d.person} · ${d.reason || 'Sense motiu'}` }))}
                </ul>
              )}
            </div>
          )}
        </>
      )}

      {open?.mode === 'new' && (
        <Drawer open onClose={() => setOpen(null)} title="Nou deute" subtitle="Diners que has deixat">
          <DebtForm budget={budget} initialPerson={open.person} onDone={(id) => setOpen({ mode: 'view', id })} onCancel={() => setOpen(null)} />
        </Drawer>
      )}
      {openDebt && <DebtDrawer key={openDebt.id} budget={budget} debt={openDebt} onClose={() => setOpen(null)} />}
    </section>
  );
}

function DebtForm({ budget, debt, initialPerson, onDone, onCancel }: { budget: BudgetState; debt?: Debt; initialPerson?: string; onDone: (id: string) => void; onCancel: () => void }) {
  const [person, setPerson] = useState(debt?.person ?? initialPerson ?? '');
  const [amount, setAmount] = useState(debt ? centsToInput(debt.amountCents) : '');
  const [date, setDate] = useState(debt?.date.slice(0, 10) ?? today());
  const [reason, setReason] = useState(debt?.reason ?? '');
  const [notes, setNotes] = useState(debt?.notes ?? '');
  const [error, setError] = useState<string | null>(null);
  const people = knownPeople(budget.data?.debts ?? []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      const saved = saveDebt({ person, amountCents: parseUserAmount(amount), reason, date, notes }, debt?.id ?? newId('debt'), debt);
      await budget.run((repo) => repo.upsertDebts([saved]));
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
        A qui
        <input className="input" value={person} onChange={(e) => setPerson(e.target.value)} list="debt-people" placeholder="Nom" required autoFocus={!initialPerson} />
        <datalist id="debt-people">
          {people.map((p) => (
            <option key={p} value={p} />
          ))}
        </datalist>
      </label>
      <div className="grid grid-cols-2 gap-4">
        <label className="label">
          Import (€)
          <input className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0,00" required autoFocus={!!initialPerson} />
        </label>
        <label className="label">
          Dia que els vas deixar
          <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </label>
      </div>
      <label className="label">
        Motiu
        <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="p.ex. Entrades del concert" />
      </label>
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

function DebtDrawer({ budget, debt, onClose }: { budget: BudgetState; debt: Debt; onClose: () => void }) {
  const pending = pendingCents(debt);
  const settled = isSettled(debt);
  const [editing, setEditing] = useState(false);
  const [amount, setAmount] = useState(centsToInput(pending));
  const [date, setDate] = useState(today());
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const txs = budget.data?.transactions ?? [];
  const origin = debt.txId ? txs.find((t) => t.id === debt.txId) : undefined;
  const candidates = settled ? [] : suggestRepaymentTxs(debt, txs, budget.data?.debts ?? []);

  async function linkTx(tx: (typeof txs)[number]) {
    try {
      const r = linkRepaymentTx(debt, tx, newId('rep'));
      await budget.run(async (repo) => {
        await repo.upsertDebts([r.debt]);
        await repo.upsertTransactions([r.tx]);
      });
      setAmount(centsToInput(pendingCents(r.debt)));
    } catch (err) {
      setError(errorText(err));
    }
  }

  async function dropRepayment(id: string) {
    const released = releaseDebtTxs(debt, txs, new Set([id]));
    await budget.run(async (repo) => {
      await repo.upsertDebts([removeRepayment(debt, id)]);
      if (released.length) await repo.upsertTransactions(released);
    });
  }

  async function repay(amountCents: number) {
    try {
      const next = addRepayment(debt, { date, amountCents, note }, newId('rep'));
      await budget.run((repo) => repo.upsertDebts([next]));
      setAmount(centsToInput(pendingCents(next)));
      setNote('');
    } catch (err) {
      setError(errorText(err));
    }
  }

  async function submitRepayment(e: FormEvent) {
    e.preventDefault();
    try {
      await repay(parseUserAmount(amount));
    } catch (err) {
      setError(errorText(err));
    }
  }

  async function remove() {
    const released = releaseDebtTxs(debt, txs);
    const extra = released.length ? `\n\nEls ${released.length} moviments enllaçats tornaran a comptar com a despesa o reemborsament.` : '';
    if (!window.confirm(`Eliminar el deute de ${debt.person} (${formatCents(debt.amountCents)})?${extra}`)) return;
    await budget.run(async (repo) => {
      await repo.deleteDebts([debt.id]);
      if (released.length) await repo.upsertTransactions(released);
    });
    onClose();
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title={debt.person}
      subtitle={debt.reason || 'Sense motiu'}
      footer={
        <>
          <Button variant="danger" icon="trash" onClick={remove}>
            Eliminar
          </Button>
          <div className="flex-1" />
          <Button icon="edit" onClick={() => setEditing((v) => !v)}>
            {editing ? 'Tancar edició' : 'Editar'}
          </Button>
        </>
      }
    >
      {editing ? (
        <DebtForm budget={budget} debt={debt} onDone={() => setEditing(false)} onCancel={() => setEditing(false)} />
      ) : (
        <div className="space-y-7">
          {error && (
            <Alert tone="neg" onClose={() => setError(null)}>
              {error}
            </Alert>
          )}
          <div>
            <div className="flex items-end justify-between gap-3">
              <Stat label={settled ? 'Saldat' : 'Pendent'} value={formatCents(Math.max(pending, 0))} tone={settled ? 'pos' : undefined} />
              {settled ? <Badge tone="pos">Tornat</Badge> : debt.repayments.length > 0 && <Badge tone="warn">Retornat en part</Badge>}
            </div>
            <div className="mt-4">
              <Progress debt={debt} />
            </div>
            <dl className="mt-4 divide-y divide-line border-t border-line text-sm">
              <div className="flex justify-between py-2">
                <dt className="text-ink-muted">Deixat</dt>
                <dd className="amount font-medium">{formatCents(debt.amountCents)}</dd>
              </div>
              <div className="flex justify-between py-2">
                <dt className="text-ink-muted">Dia</dt>
                <dd>{formatLongDate(debt.date)}</dd>
              </div>
              {origin && (
                <div className="flex justify-between gap-4 py-2">
                  <dt className="text-ink-muted">Moviment</dt>
                  <dd className="flex min-w-0 items-center gap-1.5 truncate">
                    <Icon name="link" className="size-3.5 shrink-0 text-ink-faint" />
                    <span className="truncate">{origin.description}</span>
                  </dd>
                </div>
              )}
              <div className="flex justify-between py-2">
                <dt className="text-ink-muted">Retornat</dt>
                <dd className="amount font-medium text-pos">{formatCents(repaidCents(debt))}</dd>
              </div>
              {debt.notes && (
                <div className="py-2">
                  <dt className="text-ink-muted">Notes</dt>
                  <dd className="mt-1 whitespace-pre-wrap">{debt.notes}</dd>
                </div>
              )}
            </dl>
          </div>

          {!settled && (
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">Registrar un retorn</h3>
                <Button size="sm" variant="primary" icon="check" onClick={() => repay(pending)}>
                  Ho ha tornat tot
                </Button>
              </div>
              <form className="space-y-2" onSubmit={submitRepayment}>
                <div className="flex gap-2">
                  <input className="input w-auto" type="date" value={date} onChange={(e) => setDate(e.target.value)} required aria-label="Data del retorn" />
                  <input className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Import (€)" required aria-label="Import retornat" />
                  <Button type="submit" icon="plus" aria-label="Afegir retorn" title="Afegir retorn" />
                </div>
                <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Nota (opcional): efectiu..." />
              </form>
              {candidates.length > 0 && (
                <div className="space-y-2 pt-2">
                  <h4 className="text-xs font-semibold text-ink-muted">O enllaça un Bizum o una transferència rebuda</h4>
                  <ul className="divide-y divide-line rounded-lg border border-line">
                    {candidates.map((t) => (
                      <li key={t.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-medium">{t.description}</div>
                          <div className="text-xs text-ink-muted">{formatDate(t.date)}</div>
                        </div>
                        <span className="amount font-medium text-pos">{formatCents(t.amountCents)}</span>
                        <Button size="sm" icon="link" onClick={() => linkTx(t)}>
                          Enllaçar
                        </Button>
                      </li>
                    ))}
                  </ul>
                  <p className="hint">Així el Bizum no compta com a ingrés ni com a devolució: només salda el deute.</p>
                </div>
              )}
            </section>
          )}

          <section className="space-y-3">
            <h3 className="text-sm font-semibold">Retorns</h3>
            {debt.repayments.length === 0 ? (
              <p className="text-sm text-ink-muted">Encara no t'ha tornat res.</p>
            ) : (
              <ul className="divide-y divide-line rounded-lg border border-line">
                {debt.repayments.map((r) => (
                  <li key={r.id} className="group flex items-center gap-3 px-3 py-2 text-sm">
                    <span className="text-ink-muted">{formatDate(r.date)}</span>
                    <span className="flex min-w-0 flex-1 items-center gap-1 truncate text-xs text-ink-faint">
                      {r.txId && <Icon name="link" className="size-3.5 shrink-0" aria-label="Enllaçat a un moviment" />}
                      <span className="truncate">{r.note}</span>
                    </span>
                    <span className="amount font-medium text-pos">{formatCents(r.amountCents)}</span>
                    <button
                      className="text-ink-faint opacity-0 group-hover:opacity-100 hover:text-neg max-lg:opacity-100"
                      onClick={() => dropRepayment(r.id)}
                      aria-label="Eliminar retorn"
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

/** Despeses que has pagat per altres i de les quals encara esperes cobrar una part. */
function SharedExpenses({ items, total, budget }: { items: RecoveryStatus[]; total: number; budget: BudgetState }) {
  return (
    <Card className="mb-8">
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div>
          <div className="font-semibold">Despeses compartides pendents</div>
          <div className="text-xs text-ink-muted">Enllaça els Bizums des del detall del moviment a Moviments.</div>
        </div>
        <div className="amount text-lg font-semibold">{formatCents(total)}</div>
      </div>
      <ul className="divide-y divide-line">
        {items.map((s) => (
          <li key={s.expense.id} className="flex items-center gap-4 px-4 py-3">
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{s.expense.description}</div>
              <div className="mt-0.5 text-xs text-ink-muted">
                {formatDate(s.expense.date)} · recuperat {formatCents(s.recoveredCents)} de {formatCents(s.expectedCents)}
              </div>
            </div>
            <div className="amount text-sm font-semibold">{formatCents(s.pendingCents)}</div>
            <Button
              size="sm"
              variant="ghost"
              title="Ja no espero cobrar-ne més: el que falta passa a ser despesa meva"
              onClick={() => budget.run((repo) => repo.upsertTransactions([setRecoveryClosed(s.expense, true)]))}
            >
              Tancar
            </Button>
          </li>
        ))}
      </ul>
    </Card>
  );
}
