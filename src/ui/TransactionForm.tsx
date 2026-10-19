import { useMemo, useRef, useState, type FormEvent } from 'react';
import { todayIso } from '../domain/dates';
import { knownPeople } from '../domain/debts';
import { formatCents, parseUserAmount } from '../domain/money';
import { splitExpense } from '../domain/sharedExpenses';
import { createManualTransaction, createManualTransfer, knownDescriptions, suggestFromHistory } from '../domain/transactions';
import { isNeutralKind, TRANSACTION_KINDS, type Debt, type Transaction, type TransactionKind } from '../domain/types';
import { Button } from './kit/Button';
import { cx } from './kit/cx';
import { Alert, Switch } from './kit/Feedback';
import { Icon } from './kit/Icon';
import { KIND_LABELS } from './labels';
import { buildShares, initialSplit, SharedSplit, tryAmount, type SplitState } from './transactions/SharedSplit';
import { newId, type BudgetState } from './useBudget';

/** Moviments afegits mentre el formulari és obert (per poder-los desfer). */
interface Added {
  key: string;
  label: string;
  amountCents: number;
  txIds: string[];
  debtIds: string[];
}

const today = () => todayIso().slice(0, 10);

/**
 * Alta manual: despeses en efectiu, sopars que pagues per altres (amb els seus Bizums), cobraments
 * que no passen pel banc... Amb "Afegir i continuar" el formulari es queda obert i recorda el compte,
 * la data i el tipus, per apuntar-ne uns quants seguits.
 */
export function TransactionForm({ budget, onDone }: { budget: BudgetState; onDone: () => void }) {
  const { data, run, lookups } = budget;
  const accounts = (data?.accounts ?? []).filter((a) => !a.archived);
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? '');
  const [toAccountId, setToAccountId] = useState(accounts[1]?.id ?? '');
  const [kind, setKind] = useState<TransactionKind>('expense');
  const [date, setDate] = useState(today());
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [notes, setNotes] = useState('');
  const [shared, setShared] = useState(false);
  const [split, setSplit] = useState<SplitState>(() => initialSplit(today()));
  const [added, setAdded] = useState<Added[]>([]);
  const [error, setError] = useState<string | null>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  const descriptions = useMemo(() => knownDescriptions(data?.transactions ?? []), [data]);
  const people = useMemo(() => knownPeople(data?.debts ?? []), [data]);

  if (!data) return null;
  if (accounts.length === 0) return <p className="text-sm text-ink-muted">Primer crea un compte (pestanya Comptes) o importa un extracte.</p>;

  const categoryKind = kind === 'income' || kind === 'interest' ? 'income' : 'expense';
  const isShared = shared && kind === 'expense';

  /** Si ja has apuntat aquesta descripció abans, proposa'n la categoria. */
  function onDescriptionBlur() {
    if (categoryId || isNeutralKind(kind)) return;
    const s = suggestFromHistory(description, data!.transactions);
    if (s?.categoryId && s.kind === kind && lookups.categories.has(s.categoryId)) setCategoryId(s.categoryId);
  }

  function reset() {
    setAmount('');
    setDescription('');
    setCategoryId('');
    setNotes('');
    setShared(false);
    setSplit(initialSplit(date));
    setError(null);
    amountRef.current?.focus();
  }

  async function save(keepOpen: boolean) {
    let txs: Transaction[] = [];
    let debts: Debt[] = [];
    try {
      setError(null);
      const amountCents = parseUserAmount(amount);
      const account = lookups.accounts.get(accountId)!;
      if (kind === 'transfer') {
        const to = lookups.accounts.get(toAccountId);
        if (!to) throw new Error('Tria el compte de destí');
        txs = createManualTransfer({ fromAccountId: accountId, toAccountId, date, amountCents, description, notes: notes || undefined }, account, to, [newId('tx'), newId('tx')]);
      } else {
        const tx = createManualTransaction(
          { accountId, date, amountCents, description, kind, categoryId: categoryId || undefined, notes: notes || undefined },
          account,
          newId('tx'),
        );
        txs = [tx];
        if (isShared) {
          const r = splitExpense(tx, buildShares(split, Math.abs(amountCents), accountId), {
            newId,
            currencyOf: (id) => lookups.accounts.get(id)?.currency,
          });
          txs = [r.expense, ...r.reimbursements];
          debts = r.debts;
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return;
    }
    await run(async (repo) => {
      await repo.upsertTransactions(txs);
      if (debts.length) await repo.upsertDebts(debts);
    });
    if (!keepOpen) return onDone();
    setAdded((a) => [
      { key: txs[0].id, label: txs[0].description, amountCents: txs[0].amountCents, txIds: txs.map((t) => t.id), debtIds: debts.map((d) => d.id) },
      ...a,
    ]);
    reset();
  }

  async function undo(item: Added) {
    await run(async (repo) => {
      await repo.deleteTransactions(item.txIds);
      if (item.debtIds.length) await repo.deleteDebts(item.debtIds);
    });
    setAdded((a) => a.filter((x) => x.key !== item.key));
  }

  const submit = (e: FormEvent) => {
    e.preventDefault();
    // Un cop has començat a apuntar-ne uns quants, Enter continua.
    void save(added.length > 0);
  };

  const common: TransactionKind[] = ['expense', 'income', 'transfer'];
  const others = TRANSACTION_KINDS.filter((k) => !common.includes(k));
  const isOther = !common.includes(kind);
  const totalCents = tryAmount(amount);

  return (
    <form className="space-y-5" onSubmit={submit}>
      {error && (
        <Alert tone="neg" onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      <div className="grid grid-cols-4 gap-1 rounded-lg bg-subtle p-1">
        {[...common, 'other' as const].map((k) => {
          const active = k === 'other' ? isOther : kind === k;
          return (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k === 'other' ? (isOther ? kind : others[0]) : k)}
              className={cx('h-8 rounded-md text-[13px] font-medium transition', active ? 'bg-surface text-ink shadow-xs' : 'text-ink-muted hover:text-ink')}
            >
              {k === 'other' ? 'Altres' : KIND_LABELS[k]}
            </button>
          );
        })}
      </div>
      {isOther && (
        <label className="label">
          Tipus
          <select className="input" value={kind} onChange={(e) => setKind(e.target.value as TransactionKind)}>
            {others.map((k) => (
              <option key={k} value={k}>
                {KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </label>
      )}

      <label className="label">
        {isShared ? 'Total pagat (€)' : 'Import (€)'}
        <input
          ref={amountRef}
          className="input h-12 text-xl font-semibold tabular-nums"
          inputMode="decimal"
          autoFocus
          placeholder={kind === 'adjustment' || kind === 'loan' ? 'p.ex. -12,50' : '0,00'}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          required
        />
      </label>

      <label className="label">
        Descripció
        <input
          className="input"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onBlur={onDescriptionBlur}
          required={kind !== 'transfer'}
          placeholder="Mercat, sopar, Bizum..."
          list="tx-descriptions"
        />
        <datalist id="tx-descriptions">
          {descriptions.map((d) => (
            <option key={d} value={d} />
          ))}
        </datalist>
      </label>

      <div className="grid grid-cols-2 gap-4">
        <label className="label">
          {kind === 'transfer' ? 'Des de' : 'Compte'}
          <select className="input" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        {kind === 'transfer' ? (
          <label className="label">
            Cap a
            <select className="input" value={toAccountId} onChange={(e) => setToAccountId(e.target.value)}>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <label className="label">
            Data
            <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          </label>
        )}
      </div>
      {kind === 'transfer' && (
        <label className="label">
          Data
          <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </label>
      )}

      {!isNeutralKind(kind) && (
        <label className="label">
          Categoria
          <select className="input" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">— sense categoria —</option>
            {data.categories
              .filter((c) => c.kind === categoryKind)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </select>
        </label>
      )}

      {kind === 'expense' && (
        <div className={cx('rounded-xl border p-3', shared ? 'border-accent/40 bg-accent-soft/30' : 'border-line')}>
          <label className="flex cursor-pointer items-center justify-between gap-3 text-sm">
            <span>
              <span className="font-medium">Despesa compartida</span>
              <span className="hint block">Has pagat per altres (un sopar...) i et tornen la seva part.</span>
            </span>
            <Switch checked={shared} onChange={setShared} label="Despesa compartida" />
          </label>
          {shared && (
            <div className="mt-3">
              <SharedSplit totalCents={totalCents !== null ? Math.abs(totalCents) : null} value={split} onChange={setSplit} people={people} defaultDate={today()} />
            </div>
          )}
        </div>
      )}

      <label className="label">
        Notes
        <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Opcional" />
      </label>

      <div className="flex flex-wrap gap-2 pt-2">
        {added.length === 0 ? (
          <>
            <Button variant="primary" type="submit" className="flex-1">
              Afegir
            </Button>
            <Button onClick={() => save(true)} title="Desa i deixa el formulari obert amb el mateix compte i data">
              Afegir i continuar
            </Button>
          </>
        ) : (
          <>
            <Button variant="primary" type="submit" className="flex-1">
              Afegir i continuar
            </Button>
            <Button onClick={onDone}>Fet</Button>
          </>
        )}
        {added.length === 0 && <Button onClick={onDone}>Cancel·lar</Button>}
      </div>

      {added.length > 0 && (
        <div>
          <div className="mb-2 text-xs font-semibold text-ink-muted">Afegits ara ({added.length})</div>
          <ul className="divide-y divide-line rounded-lg border border-line">
            {added.map((a) => (
              <li key={a.key} className="flex items-center gap-3 px-3 py-2 text-sm">
                <Icon name="check" className="size-4 text-pos" />
                <span className="min-w-0 flex-1 truncate">{a.label}</span>
                <span className={cx('amount font-medium', a.amountCents > 0 && 'text-pos')}>{formatCents(a.amountCents)}</span>
                <Button variant="ghost" size="sm" onClick={() => undo(a)} title="Desfer">
                  Desfer
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </form>
  );
}
