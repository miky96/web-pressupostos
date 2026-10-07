import { useState, type FormEvent } from 'react';
import { todayIso } from '../domain/dates';
import { parseUserAmount } from '../domain/money';
import { createManualTransaction, createManualTransfer } from '../domain/transactions';
import { TRANSACTION_KINDS, type TransactionKind } from '../domain/types';
import { Button } from './kit/Button';
import { cx } from './kit/cx';
import { KIND_LABELS } from './labels';
import { newId, type BudgetState } from './useBudget';

/** Alta manual: despeses en efectiu, cobraments que no passen pel banc, aportacions a comptes sense export... */
export function TransactionForm({ budget, onDone }: { budget: BudgetState; onDone: () => void }) {
  const { data, run, setError, lookups } = budget;
  const accounts = (data?.accounts ?? []).filter((a) => !a.archived);
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? '');
  const [toAccountId, setToAccountId] = useState(accounts[1]?.id ?? '');
  const [kind, setKind] = useState<TransactionKind>('expense');
  const [date, setDate] = useState(todayIso().slice(0, 10));
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [notes, setNotes] = useState('');

  if (!data) return null;
  if (accounts.length === 0) return <p className="text-sm text-ink-muted">Primer crea un compte (pestanya Comptes) o importa un extracte.</p>;

  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      const amountCents = parseUserAmount(amount);
      const account = lookups.accounts.get(accountId)!;
      if (kind === 'transfer') {
        const to = lookups.accounts.get(toAccountId);
        if (!to) throw new Error('Tria el compte de destí');
        const legs = createManualTransfer(
          { fromAccountId: accountId, toAccountId, date, amountCents, description, notes: notes || undefined },
          account,
          to,
          [newId('tx'), newId('tx')],
        );
        await run((repo) => repo.upsertTransactions(legs));
      } else {
        const tx = createManualTransaction(
          { accountId, date, amountCents, description, kind, categoryId: categoryId || undefined, notes: notes || undefined },
          account,
          newId('tx'),
        );
        await run((repo) => repo.upsertTransactions([tx]));
      }
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const categoryKind = kind === 'income' || kind === 'interest' ? 'income' : 'expense';

  const common: TransactionKind[] = ['expense', 'income', 'transfer'];
  const others = TRANSACTION_KINDS.filter((k) => !common.includes(k));
  const isOther = !common.includes(kind);

  return (
    <form className="space-y-5" onSubmit={submit}>
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
        Import (€)
        <input
          className="input h-12 text-xl font-semibold tabular-nums"
          inputMode="decimal"
          autoFocus
          placeholder={kind === 'adjustment' ? 'p.ex. -12,50' : '0,00'}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          required
        />
      </label>

      <label className="label">
        Descripció
        <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} required={kind !== 'transfer'} placeholder="Mercat, sopar, Bizum..." />
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

      {kind !== 'transfer' && kind !== 'adjustment' && (
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
      <label className="label">
        Notes
        <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Opcional" />
      </label>
      <div className="flex gap-2 pt-2">
        <Button variant="primary" type="submit" className="flex-1">
          Afegir moviment
        </Button>
        <Button onClick={onDone}>Cancel·lar</Button>
      </div>
    </form>
  );
}
