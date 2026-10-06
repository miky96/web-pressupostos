import { useState, type FormEvent } from 'react';
import { todayIso } from '../domain/dates';
import { parseUserAmount } from '../domain/money';
import { createManualTransaction, createManualTransfer } from '../domain/transactions';
import { TRANSACTION_KINDS, type TransactionKind } from '../domain/types';
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
  if (accounts.length === 0) return <p className="muted">Primer crea un compte (pestanya Comptes) o importa un extracte.</p>;

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

  return (
    <form className="card form-grid" onSubmit={submit}>
      <label>
        Tipus
        <select value={kind} onChange={(e) => setKind(e.target.value as TransactionKind)}>
          {TRANSACTION_KINDS.map((k) => (
            <option key={k} value={k}>
              {KIND_LABELS[k]}
            </option>
          ))}
        </select>
      </label>
      <label>
        {kind === 'transfer' ? 'Des de' : 'Compte'}
        <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </label>
      {kind === 'transfer' && (
        <label>
          Cap a
          <select value={toAccountId} onChange={(e) => setToAccountId(e.target.value)}>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <label>
        Data
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
      </label>
      <label>
        Import (€)
        <input inputMode="decimal" placeholder={kind === 'adjustment' ? 'p.ex. -12,50' : '12,50'} value={amount} onChange={(e) => setAmount(e.target.value)} required />
      </label>
      <label className="wide">
        Descripció
        <input value={description} onChange={(e) => setDescription(e.target.value)} required={kind !== 'transfer'} />
      </label>
      {kind !== 'transfer' && kind !== 'adjustment' && (
        <label>
          Categoria
          <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
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
      <label className="wide">
        Notes
        <input value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>
      <div className="wide">
        <button className="primary" type="submit">
          Afegir
        </button>{' '}
        <button type="button" onClick={onDone}>
          Tancar
        </button>
      </div>
    </form>
  );
}
