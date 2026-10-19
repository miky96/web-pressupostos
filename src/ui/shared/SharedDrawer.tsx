import { useMemo, useState, type FormEvent } from 'react';
import { todayIso } from '../../domain/dates';
import { formatCents, parseUserAmount } from '../../domain/money';
import {
  linkCandidates,
  participantName,
  releaseTx,
  removeExpense,
  removeSettlement,
  saveExpense,
  saveSettlement,
  splitByWeights,
  summarizeShared,
  txForLink,
  type ExpandedExpense,
} from '../../domain/shared';
import { ME, type SharedItem, type SharedSettlement, type Transaction } from '../../domain/types';
import { Button } from '../kit/Button';
import { Stat } from '../kit/Card';
import { cx } from '../kit/cx';
import { Drawer } from '../kit/Drawer';
import { Alert, Badge, Segmented } from '../kit/Feedback';
import { Icon } from '../kit/Icon';
import { formatDate } from '../labels';
import { newId, type BudgetState } from '../useBudget';
import { SharedForm } from './SharedForm';

const today = () => todayIso().slice(0, 10);
const centsToInput = (c: number) => (c / 100).toFixed(2).replace('.', ',');
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const amountOrZero = (s: string) => (s.trim() ? parseUserAmount(s) : 0);

type Editing = { kind: 'expense'; id?: string } | { kind: 'settlement'; preset?: Partial<SharedSettlement> } | null;

export function SharedDrawer({ budget, item, onClose }: { budget: BudgetState; item: SharedItem; onClose: () => void }) {
  const data = budget.data!;
  const s = useMemo(() => summarizeShared(item, data.transactions), [item, data.transactions]);
  const [editingItem, setEditingItem] = useState(false);
  const [editing, setEditing] = useState<Editing>(null);
  const [error, setError] = useState<string | null>(null);
  const txById = useMemo(() => new Map(data.transactions.map((t) => [t.id, t])), [data.transactions]);
  const name = (id: string) => (id === ME ? 'Tu' : participantName(item, id));

  async function save(next: SharedItem, txs: Transaction[] = []) {
    await budget.run(async (repo) => {
      await repo.upsertShared([next]);
      if (txs.length) await repo.upsertTransactions(txs);
    });
  }

  async function dropExpense(e: ExpandedExpense) {
    if (!window.confirm(`Eliminar la despesa "${e.description}" (${formatCents(e.totalCents)})?`)) return;
    const tx = e.txId ? txById.get(e.txId) : undefined;
    await save(removeExpense(item, e.id), tx ? [releaseTx(tx)] : []);
  }

  async function dropSettlement(st: SharedSettlement) {
    const tx = st.txId ? txById.get(st.txId) : undefined;
    await save(removeSettlement(item, st.id), tx ? [releaseTx(tx)] : []);
  }

  async function remove() {
    const linked = [...item.expenses.map((e) => e.txId), ...item.settlements.map((x) => x.txId)].flatMap((id) => (id && txById.get(id) ? [txById.get(id)!] : []));
    const extra = linked.length ? `\n\nEls ${linked.length} moviments enllaçats tornaran a comptar sencers i quedaran per revisar.` : '';
    if (!window.confirm(`Eliminar "${item.name}" amb totes les seves despeses i pagaments?${extra}`)) return;
    await budget.run(async (repo) => {
      await repo.deleteShared([item.id]);
      if (linked.length) await repo.upsertTransactions(linked.map(releaseTx));
    });
    onClose();
  }

  const others = item.participants.filter((p) => p.id !== ME);

  return (
    <Drawer
      open
      onClose={onClose}
      title={item.name}
      subtitle={`Amb ${others.map((p) => p.name).join(', ')}`}
      footer={
        <>
          <Button variant="danger" icon="trash" onClick={remove}>
            Eliminar
          </Button>
          <div className="flex-1" />
          <Button onClick={() => save({ ...item, archived: item.archived ? undefined : true })}>{item.archived ? 'Desarxivar' : 'Arxivar'}</Button>
          <Button icon="edit" onClick={() => setEditingItem((v) => !v)}>
            {editingItem ? 'Tancar edició' : 'Editar'}
          </Button>
        </>
      }
    >
      {editingItem ? (
        <SharedForm budget={budget} item={item} onDone={() => setEditingItem(false)} onCancel={() => setEditingItem(false)} />
      ) : (
        <div className="space-y-7">
          {error && (
            <Alert tone="neg" onClose={() => setError(null)}>
              {error}
            </Alert>
          )}
          <div>
            <div className="flex items-end justify-between gap-3">
              <Stat
                label={s.myNetCents > 0 ? "T'han de tornar" : s.myNetCents < 0 ? 'Has de pagar' : 'El teu saldo'}
                value={formatCents(Math.abs(s.myNetCents))}
                tone={s.myNetCents > 0 ? 'pos' : s.myNetCents < 0 ? 'neg' : undefined}
              />
              {s.settled && s.expenses.length > 0 && <Badge tone="pos">En paus</Badge>}
            </div>
            <dl className="mt-4 divide-y divide-line border-t border-line text-sm">
              <div className="flex justify-between py-2">
                <dt className="text-ink-muted">Total</dt>
                <dd className="amount font-medium">{formatCents(s.totalCents)}</dd>
              </div>
              <div className="flex justify-between py-2">
                <dt className="text-ink-muted">La teva part (el que et costa)</dt>
                <dd className="amount font-medium">{formatCents(s.myShareCents)}</dd>
              </div>
              <div className="flex justify-between py-2">
                <dt className="text-ink-muted">Has pagat</dt>
                <dd className="amount font-medium">{formatCents(s.myPaidCents)}</dd>
              </div>
            </dl>
          </div>

          {s.plan.length > 0 && (
            <section className="space-y-3">
              <h3 className="text-sm font-semibold">Per quedar en paus</h3>
              <ul className="divide-y divide-line rounded-lg border border-line">
                {s.plan.map((t) => (
                  <li key={`${t.fromId}-${t.toId}`} className="flex items-center gap-3 px-3 py-2 text-sm">
                    <span className="min-w-0 flex-1 truncate">
                      <span className={cx(t.fromId === ME && 'font-semibold')}>{name(t.fromId)}</span>
                      <Icon name="chevronRight" className="mx-1 inline size-3.5 text-ink-faint" />
                      <span className={cx(t.toId === ME && 'font-semibold')}>{name(t.toId)}</span>
                    </span>
                    <span className={cx('amount font-medium', t.toId === ME ? 'text-pos' : t.fromId === ME ? 'text-neg' : '')}>{formatCents(t.amountCents)}</span>
                    <Button size="sm" onClick={() => setEditing({ kind: 'settlement', preset: t })}>
                      Apuntar
                    </Button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Despeses</h3>
              <Button size="sm" icon="plus" onClick={() => setEditing({ kind: 'expense' })}>
                Afegir despesa
              </Button>
            </div>
            {editing?.kind === 'expense' && (
              <ExpenseForm
                key={editing.id ?? 'new'}
                budget={budget}
                item={item}
                expense={editing.id ? item.expenses.find((e) => e.id === editing.id) : undefined}
                onSave={async (next, txs) => {
                  await save(next, txs);
                  setEditing(null);
                }}
                onCancel={() => setEditing(null)}
                onError={setError}
              />
            )}
            {s.expenses.length === 0 ? (
              <p className="text-sm text-ink-muted">Encara no hi ha cap despesa.</p>
            ) : (
              <ul className="divide-y divide-line rounded-lg border border-line">
                {s.expenses.map((e) => {
                  const payers = Object.keys(e.paidBy);
                  return (
                    <li key={e.id} className="group flex items-center gap-3 px-3 py-2 text-sm">
                      <button
                        className="min-w-0 flex-1 text-left disabled:cursor-default"
                        disabled={e.fromSubscription}
                        onClick={() => setEditing({ kind: 'expense', id: e.id })}
                        title={e.fromSubscription ? 'Cobrament de la subscripció: es calcula sol' : 'Editar'}
                      >
                        <div className="flex items-center gap-1.5 truncate font-medium">
                          {e.txId && <Icon name="link" className="size-3.5 shrink-0 text-ink-faint" aria-label="Enllaçat a un moviment" />}
                          {e.fromSubscription && <Icon name="repeat" className="size-3.5 shrink-0 text-ink-faint" aria-label="Subscripció" />}
                          <span className="truncate">{e.description}</span>
                        </div>
                        <div className="text-xs text-ink-muted">
                          {formatDate(e.date)} · {payers.length === 1 ? `ha pagat ${name(payers[0])}` : `han pagat ${payers.map(name).join(', ')}`} · la teva part{' '}
                          {formatCents(e.shares[ME] ?? 0)}
                        </div>
                      </button>
                      <span className="amount font-medium">{formatCents(e.totalCents)}</span>
                      {!e.fromSubscription && (
                        <button className="text-ink-faint opacity-0 group-hover:opacity-100 hover:text-neg max-lg:opacity-100" onClick={() => dropExpense(e)} aria-label="Eliminar despesa">
                          <Icon name="trash" />
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Pagaments entre vosaltres</h3>
              <Button size="sm" icon="plus" onClick={() => setEditing({ kind: 'settlement' })}>
                Apuntar pagament
              </Button>
            </div>
            {editing?.kind === 'settlement' && (
              <SettlementForm
                key={JSON.stringify(editing.preset ?? {})}
                budget={budget}
                item={item}
                preset={editing.preset}
                onSave={async (next, txs) => {
                  await save(next, txs);
                  setEditing(null);
                }}
                onCancel={() => setEditing(null)}
                onError={setError}
              />
            )}
            {item.settlements.length === 0 ? (
              <p className="text-sm text-ink-muted">Bizums, transferències o efectiu per quadrar comptes.</p>
            ) : (
              <ul className="divide-y divide-line rounded-lg border border-line">
                {[...item.settlements].reverse().map((st) => (
                  <li key={st.id} className="group flex items-center gap-3 px-3 py-2 text-sm">
                    <span className="text-ink-muted">{formatDate(st.date)}</span>
                    <span className="flex min-w-0 flex-1 items-center gap-1 truncate">
                      {st.txId && <Icon name="link" className="size-3.5 shrink-0 text-ink-faint" aria-label="Enllaçat a un moviment" />}
                      <span className="truncate">
                        {name(st.fromId)} → {name(st.toId)}
                        {st.note && <span className="text-ink-faint"> · {st.note}</span>}
                      </span>
                    </span>
                    <span className={cx('amount font-medium', st.toId === ME ? 'text-pos' : st.fromId === ME ? 'text-neg' : '')}>{formatCents(st.amountCents)}</span>
                    <button className="text-ink-faint opacity-0 group-hover:opacity-100 hover:text-neg max-lg:opacity-100" onClick={() => dropSettlement(st)} aria-label="Eliminar pagament">
                      <Icon name="trash" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="space-y-2">
            <h3 className="text-sm font-semibold">Comptes de cadascú</h3>
            <table className="w-full text-sm">
              <thead className="text-xs text-ink-muted">
                <tr>
                  <th className="py-1 text-left font-medium" />
                  <th className="py-1 text-right font-medium">Ha pagat</th>
                  <th className="py-1 text-right font-medium">Li toca</th>
                  <th className="py-1 text-right font-medium">Saldo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {s.balances.map((b) => (
                  <tr key={b.id}>
                    <td className={cx('py-1.5', b.id === ME && 'font-semibold')}>{name(b.id)}</td>
                    <td className="amount py-1.5 text-right">{formatCents(b.paidCents + b.sentCents - b.receivedCents)}</td>
                    <td className="amount py-1.5 text-right">{formatCents(b.shareCents)}</td>
                    <td className={cx('amount py-1.5 text-right font-medium', b.netCents > 0 && 'text-pos', b.netCents < 0 && 'text-neg')}>{formatCents(b.netCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="hint">"Ha pagat" inclou els pagaments entre vosaltres. Saldo positiu: li deuen diners.</p>
          </section>

          {item.notes && <p className="text-sm whitespace-pre-wrap text-ink-muted">{item.notes}</p>}
        </div>
      )}
    </Drawer>
  );
}

// --- Formularis ----------------------------------------------------------------------------

type SaveFn = (next: SharedItem, txs: Transaction[]) => Promise<void>;

function TxPicker({ candidates, selected, onPick }: { candidates: Transaction[]; selected?: string; onPick: (t: Transaction | undefined) => void }) {
  if (candidates.length === 0) return null;
  return (
    <div className="space-y-1.5">
      <div className="text-xs font-semibold text-ink-muted">Enllaça el teu moviment (opcional)</div>
      <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
        {candidates.map((t) => (
          <li key={t.id}>
            <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm">
              <input type="checkbox" checked={selected === t.id} onChange={(e) => onPick(e.target.checked ? t : undefined)} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{t.description}</span>
                <span className="text-xs text-ink-muted">{formatDate(t.date)}</span>
              </span>
              <span className={cx('amount font-medium', t.amountCents > 0 && 'text-pos')}>{formatCents(t.amountCents)}</span>
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ExpenseForm({
  budget,
  item,
  expense,
  onSave,
  onCancel,
  onError,
}: {
  budget: BudgetState;
  item: SharedItem;
  expense?: SharedItem['expenses'][number];
  onSave: SaveFn;
  onCancel: () => void;
  onError: (msg: string) => void;
}) {
  const data = budget.data!;
  const ids = item.participants.map((p) => p.id);
  const initialPayers = expense ? Object.keys(expense.paidBy) : [ME];
  const [description, setDescription] = useState(expense?.description ?? '');
  const [date, setDate] = useState(expense?.date.slice(0, 10) ?? today());
  const [total, setTotal] = useState(expense ? centsToInput(expense.totalCents) : '');
  const [payer, setPayer] = useState(initialPayers.length === 1 ? initialPayers[0] : 'multi');
  const [paid, setPaid] = useState<Record<string, string>>(Object.fromEntries(ids.map((id) => [id, expense?.paidBy[id] ? centsToInput(expense.paidBy[id]) : ''])));
  // Una despesa desada té les parts congelades: s'editen com a imports exactes.
  const [splitMode, setSplitMode] = useState<'weights' | 'exact'>(expense ? 'exact' : 'weights');
  const [among, setAmong] = useState<Set<string>>(new Set(expense ? Object.keys(expense.shares) : ids.filter((id) => (item.participants.find((p) => p.id === id)?.weight ?? 0) > 0)));
  const [shares, setShares] = useState<Record<string, string>>(Object.fromEntries(ids.map((id) => [id, expense?.shares[id] ? centsToInput(expense.shares[id]) : ''])));
  const [txId, setTxId] = useState(expense?.txId);
  const [notes, setNotes] = useState(expense?.notes ?? '');

  const totalCents = (() => {
    try {
      return amountOrZero(total);
    } catch {
      return 0;
    }
  })();
  const myPaid = (() => {
    if (payer === ME) return totalCents;
    if (payer !== 'multi') return 0;
    try {
      return amountOrZero(paid[ME] ?? '');
    } catch {
      return 0;
    }
  })();
  const preview = (() => {
    if (splitMode !== 'weights' || totalCents <= 0) return null;
    const chosen = item.participants.filter((p) => among.has(p.id));
    if (!chosen.length) return null;
    return splitByWeights(totalCents, chosen.some((p) => p.weight > 0) ? chosen : chosen.map((p) => ({ ...p, weight: 1 })));
  })();

  const candidates = useMemo(() => {
    if (payer !== ME && payer !== 'multi') return [];
    const list = linkCandidates(data.shared.filter((i) => i.id !== item.id).concat({ ...item, expenses: item.expenses.filter((e) => e.id !== expense?.id) }), data.transactions, data.debts, {
      direction: 'out',
      amountCents: myPaid || undefined,
      near: date,
      limit: 5,
    });
    const current = txId ? data.transactions.find((t) => t.id === txId) : undefined;
    return current && !list.some((t) => t.id === current.id) ? [current, ...list] : list;
  }, [data, item, expense?.id, payer, myPaid, date, txId]);

  function pick(t: Transaction | undefined) {
    setTxId(t?.id);
    if (!t) return;
    if (!description.trim()) setDescription(t.description);
    setDate(t.date.slice(0, 10));
    if (payer === ME) setTotal(centsToInput(-t.amountCents));
    else setPaid((p) => ({ ...p, [ME]: centsToInput(-t.amountCents) }));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      const totalC = parseUserAmount(total);
      const paidBy = payer === 'multi' ? Object.fromEntries(ids.map((id) => [id, amountOrZero(paid[id] ?? '')])) : { [payer]: totalC };
      const tx = txId ? data.transactions.find((t) => t.id === txId) : undefined;
      const next = saveExpense(
        item,
        {
          date,
          description,
          totalCents: totalC,
          paidBy,
          shares: splitMode === 'exact' ? Object.fromEntries(ids.map((id) => [id, amountOrZero(shares[id] ?? '')])) : undefined,
          among: [...among],
          txId,
          notes,
        },
        expense?.id ?? newId('sx'),
        tx,
      );
      const txs: Transaction[] = [];
      if (tx) txs.push(txForLink(item, tx));
      const previous = expense?.txId && expense.txId !== txId ? data.transactions.find((t) => t.id === expense.txId) : undefined;
      if (previous) txs.push(releaseTx(previous));
      await onSave(next, txs);
    } catch (err) {
      onError(errorText(err));
    }
  }

  return (
    <form className="space-y-4 rounded-lg border border-line bg-subtle/40 p-3" onSubmit={submit}>
      <div className="grid grid-cols-[1fr_auto] gap-2">
        <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Concepte (p.ex. Hotel, Lloguer d'octubre)" aria-label="Concepte" autoFocus />
        <input className="input w-auto" type="date" value={date} onChange={(e) => setDate(e.target.value)} required aria-label="Data" />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="label">
          Total (€)
          <input className="input" inputMode="decimal" value={total} onChange={(e) => setTotal(e.target.value)} placeholder="0,00" required />
        </label>
        <label className="label">
          Qui ha pagat
          <select className="input" value={payer} onChange={(e) => setPayer(e.target.value)}>
            {item.participants.map((p) => (
              <option key={p.id} value={p.id}>
                {p.id === ME ? 'Tu' : p.name}
              </option>
            ))}
            <option value="multi">Diverses persones</option>
          </select>
        </label>
      </div>
      {payer === 'multi' && (
        <div className="space-y-1.5">
          {item.participants.map((p) => (
            <div key={p.id} className="flex items-center gap-2 text-sm">
              <span className="flex-1">{p.id === ME ? 'Tu' : p.name} ha pagat</span>
              <input className="input w-28 text-right" inputMode="decimal" value={paid[p.id] ?? ''} onChange={(e) => setPaid((x) => ({ ...x, [p.id]: e.target.value }))} placeholder="0,00" />
            </div>
          ))}
        </div>
      )}

      <div className="space-y-2">
        <Segmented
          value={splitMode}
          onChange={setSplitMode}
          options={[
            { value: 'weights', label: 'Segons les parts' },
            { value: 'exact', label: 'Imports exactes' },
          ]}
        />
        {item.participants.map((p) => (
          <div key={p.id} className="flex items-center gap-2 text-sm">
            {splitMode === 'weights' ? (
              <>
                <label className="flex flex-1 items-center gap-2">
                  <input
                    type="checkbox"
                    checked={among.has(p.id)}
                    onChange={(e) =>
                      setAmong((s) => {
                        const n = new Set(s);
                        if (e.target.checked) n.add(p.id);
                        else n.delete(p.id);
                        return n;
                      })
                    }
                  />
                  {p.id === ME ? 'Tu' : p.name}
                </label>
                <span className="amount text-ink-muted">{preview?.[p.id] ? formatCents(preview[p.id]) : '—'}</span>
              </>
            ) : (
              <>
                <span className="flex-1">{p.id === ME ? 'Tu' : p.name}</span>
                <input className="input w-28 text-right" inputMode="decimal" value={shares[p.id] ?? ''} onChange={(e) => setShares((x) => ({ ...x, [p.id]: e.target.value }))} placeholder="0,00" />
              </>
            )}
          </div>
        ))}
      </div>

      <TxPicker candidates={candidates} selected={txId} onPick={pick} />
      {(payer === ME || payer === 'multi') && myPaid > 0 && !txId && candidates.length > 0 && (
        <p className="hint">Si el pagament és en un compte teu, enllaça'l: si no, al consum real comptaria sencer i també la teva part.</p>
      )}
      <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes (opcional)" />
      <div className="flex gap-2">
        <Button variant="primary" type="submit" size="sm">
          Desar despesa
        </Button>
        <Button size="sm" onClick={onCancel}>
          Cancel·lar
        </Button>
      </div>
    </form>
  );
}

function SettlementForm({
  budget,
  item,
  preset,
  onSave,
  onCancel,
  onError,
}: {
  budget: BudgetState;
  item: SharedItem;
  preset?: Partial<SharedSettlement>;
  onSave: SaveFn;
  onCancel: () => void;
  onError: (msg: string) => void;
}) {
  const data = budget.data!;
  const firstOther = item.participants.find((p) => p.id !== ME)?.id ?? ME;
  const [fromId, setFromId] = useState(preset?.fromId ?? firstOther);
  const [toId, setToId] = useState(preset?.toId ?? ME);
  const [amount, setAmount] = useState(preset?.amountCents ? centsToInput(preset.amountCents) : '');
  const [date, setDate] = useState(today());
  const [note, setNote] = useState('');
  const [txId, setTxId] = useState<string>();

  const amountCents = (() => {
    try {
      return amountOrZero(amount);
    } catch {
      return 0;
    }
  })();
  const direction = toId === ME ? 'in' : fromId === ME ? 'out' : null;
  const candidates = useMemo(
    () => (direction ? linkCandidates(data.shared, data.transactions, data.debts, { direction, amountCents: amountCents || undefined, near: date, limit: 5 }) : []),
    [data, direction, amountCents, date],
  );

  function pick(t: Transaction | undefined) {
    setTxId(t?.id);
    if (!t) return;
    setAmount(centsToInput(Math.abs(t.amountCents)));
    setDate(t.date.slice(0, 10));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      const tx = txId ? data.transactions.find((t) => t.id === txId) : undefined;
      const next = saveSettlement(item, { date, fromId, toId, amountCents: parseUserAmount(amount), txId: direction ? txId : undefined, note }, newId('st'), tx);
      await onSave(next, tx && direction ? [txForLink(item, tx)] : []);
    } catch (err) {
      onError(errorText(err));
    }
  }

  const options = item.participants.map((p) => (
    <option key={p.id} value={p.id}>
      {p.id === ME ? 'Tu' : p.name}
    </option>
  ));
  return (
    <form className="space-y-4 rounded-lg border border-line bg-subtle/40 p-3" onSubmit={submit}>
      <div className="grid grid-cols-2 gap-2">
        <label className="label">
          Qui paga
          <select className="input" value={fromId} onChange={(e) => setFromId(e.target.value)}>
            {options}
          </select>
        </label>
        <label className="label">
          A qui
          <select className="input" value={toId} onChange={(e) => setToId(e.target.value)}>
            {options}
          </select>
        </label>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <input className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Import (€)" required aria-label="Import" />
        <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} required aria-label="Data" />
      </div>
      {direction && <TxPicker candidates={candidates} selected={txId} onPick={pick} />}
      <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Nota (opcional): Bizum, efectiu..." />
      <div className="flex gap-2">
        <Button variant="primary" type="submit" size="sm">
          Desar pagament
        </Button>
        <Button size="sm" onClick={onCancel}>
          Cancel·lar
        </Button>
      </div>
    </form>
  );
}
