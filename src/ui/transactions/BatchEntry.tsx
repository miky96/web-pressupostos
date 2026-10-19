import { useMemo, useState } from 'react';
import { todayIso } from '../../domain/dates';
import { formatCents, parseUserAmount } from '../../domain/money';
import { createManualTransaction, knownDescriptions, suggestFromHistory } from '../../domain/transactions';
import type { Transaction } from '../../domain/types';
import { Button } from '../kit/Button';
import { cx } from '../kit/cx';
import { Alert } from '../kit/Feedback';
import { KIND_LABELS } from '../labels';
import { newId, type BudgetState } from '../useBudget';
import { tryAmount } from './SharedSplit';

/** Tipus que té sentit apuntar en sèrie (el repàs setmanal de despeses i Bizums). */
const BATCH_KINDS = ['expense', 'income', 'reimbursement', 'refund'] as const;
type BatchKind = (typeof BATCH_KINDS)[number];

interface BatchRow {
  key: string;
  date: string;
  description: string;
  amount: string;
  kind: BatchKind;
  categoryId: string;
  accountId: string;
}

let seq = 0;
const blank = (from: Pick<BatchRow, 'date' | 'accountId' | 'kind'>): BatchRow => ({ key: `b${++seq}`, description: '', amount: '', categoryId: '', ...from });
const isEmpty = (r: BatchRow) => !r.description.trim() && !r.amount.trim();
const signed = (r: BatchRow, cents: number) => (r.kind === 'expense' ? -Math.abs(cents) : Math.abs(cents));

/**
 * Graella per apuntar molts moviments de cop. Cada fila nova hereta la data i el compte de
 * l'anterior; Enter a l'import afegeix una fila. Les files buides s'ignoren.
 */
export function BatchEntry({ budget, onDone }: { budget: BudgetState; onDone: (count: number) => void }) {
  const { data, run, lookups } = budget;
  const accounts = (data?.accounts ?? []).filter((a) => !a.archived);
  const [rows, setRows] = useState<BatchRow[]>(() => [blank({ date: todayIso().slice(0, 10), accountId: accounts[0]?.id ?? '', kind: 'expense' })]);
  const [error, setError] = useState<string | null>(null);
  const descriptions = useMemo(() => knownDescriptions(data?.transactions ?? []), [data]);
  if (!data) return null;
  if (accounts.length === 0) return <p className="text-sm text-ink-muted">Primer crea un compte (pestanya Comptes) o importa un extracte.</p>;

  const patch = (key: string, p: Partial<BatchRow>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...p } : r)));
  const focusRow = (key: string) => setTimeout(() => document.querySelector<HTMLInputElement>(`[data-row="${key}"] [data-field="desc"]`)?.focus(), 0);

  function addRow(after?: BatchRow) {
    const last = after ?? rows.at(-1)!;
    // El tipus no s'hereta: un Bizum enmig no ha de convertir les següents despeses en reemborsaments.
    const next = blank({ date: last.date, accountId: last.accountId, kind: 'expense' });
    setRows((rs) => {
      const i = rs.findIndex((r) => r.key === last.key);
      return [...rs.slice(0, i + 1), next, ...rs.slice(i + 1)];
    });
    focusRow(next.key);
  }

  function removeRow(key: string) {
    setRows((rs) => (rs.length > 1 ? rs.filter((r) => r.key !== key) : rs.map((r) => ({ ...r, description: '', amount: '', categoryId: '' }))));
  }

  function suggest(r: BatchRow) {
    if (r.categoryId) return;
    const s = suggestFromHistory(r.description, data!.transactions);
    if (!s) return;
    const kind = (BATCH_KINDS as readonly string[]).includes(s.kind) ? (s.kind as BatchKind) : r.kind;
    patch(r.key, { kind, categoryId: s.categoryId && lookups.categories.has(s.categoryId) ? s.categoryId : '' });
  }

  const filled = rows.filter((r) => !isEmpty(r));
  const totalCents = filled.reduce((s, r) => {
    const c = tryAmount(r.amount);
    return c === null ? s : s + signed(r, c);
  }, 0);

  async function save() {
    const txs: Transaction[] = [];
    try {
      setError(null);
      rows.forEach((r, i) => {
        if (isEmpty(r)) return;
        const where = `Fila ${i + 1}`;
        try {
          const account = lookups.accounts.get(r.accountId);
          if (!account) throw new Error('tria un compte');
          txs.push(
            createManualTransaction(
              { accountId: r.accountId, date: r.date, amountCents: parseUserAmount(r.amount), description: r.description, kind: r.kind, categoryId: r.categoryId || undefined },
              account,
              newId('tx'),
            ),
          );
        } catch (e) {
          throw new Error(`${where}: ${e instanceof Error ? e.message : String(e)}`, { cause: e });
        }
      });
      if (txs.length === 0) throw new Error('No hi ha cap moviment per desar');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return;
    }
    await run((repo) => repo.upsertTransactions(txs));
    onDone(txs.length);
  }

  const cols = 'grid grid-cols-2 gap-2 sm:grid-cols-[8.75rem_minmax(0,1fr)_6.5rem_8.5rem_10rem_9rem_2rem] sm:items-center';

  return (
    <div className="space-y-4">
      {error && (
        <Alert tone="neg" onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      <div className={cx(cols, 'px-1 text-xs font-medium text-ink-muted max-sm:hidden')}>
        <span>Data</span>
        <span>Descripció</span>
        <span className="text-right">Import (€)</span>
        <span>Tipus</span>
        <span>Categoria</span>
        <span>Compte</span>
        <span />
      </div>
      <ul className="space-y-2 sm:space-y-1.5">
        {rows.map((r, i) => {
          const catKind = r.kind === 'income' ? 'income' : 'expense';
          const invalid = !isEmpty(r) && r.amount.trim() !== '' && tryAmount(r.amount) === null;
          return (
            <li key={r.key} data-row={r.key} className={cx(cols, 'rounded-lg max-sm:border max-sm:border-line max-sm:p-2.5')}>
              <input className="input" type="date" aria-label="Data" value={r.date} onChange={(e) => patch(r.key, { date: e.target.value })} />
              <input
                className="input max-sm:order-first max-sm:col-span-2"
                data-field="desc"
                aria-label="Descripció"
                placeholder={i === 0 ? 'Cafè, mercat, Bizum de…' : ''}
                list="batch-descriptions"
                value={r.description}
                onChange={(e) => patch(r.key, { description: e.target.value })}
                onBlur={() => suggest(r)}
                autoFocus={i === 0}
              />
              <input
                className={cx('input text-right tabular-nums', invalid && 'border-neg', r.kind !== 'expense' && r.amount && 'text-pos')}
                inputMode="decimal"
                aria-label="Import"
                placeholder="0,00"
                value={r.amount}
                onChange={(e) => patch(r.key, { amount: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter') return;
                  e.preventDefault();
                  const next = rows[i + 1];
                  if (next) focusRow(next.key);
                  else addRow(r);
                }}
              />
              <select className="input" aria-label="Tipus" value={r.kind} onChange={(e) => patch(r.key, { kind: e.target.value as BatchKind, categoryId: '' })}>
                {BATCH_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {KIND_LABELS[k]}
                  </option>
                ))}
              </select>
              <select className="input" aria-label="Categoria" value={r.categoryId} onChange={(e) => patch(r.key, { categoryId: e.target.value })}>
                <option value="">— categoria —</option>
                {data.categories
                  .filter((c) => c.kind === catKind)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </select>
              <select className="input" aria-label="Compte" value={r.accountId} onChange={(e) => patch(r.key, { accountId: e.target.value })}>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
              <Button variant="ghost" size="sm" icon="x" aria-label="Treure la fila" title="Treure la fila" onClick={() => removeRow(r.key)} className="max-sm:justify-self-end" />
            </li>
          );
        })}
      </ul>
      <datalist id="batch-descriptions">
        {descriptions.map((d) => (
          <option key={d} value={d} />
        ))}
      </datalist>
      <div className="flex flex-wrap items-center gap-3">
        <Button icon="plus" onClick={() => addRow()}>
          Afegir fila
        </Button>
        <span className="hint">Enter a l'import passa a la fila següent. La data i el compte s'hereten de la fila anterior; la categoria es proposa si ja havies apuntat la mateixa descripció.</span>
      </div>
      <p className="hint">Per a un sopar pagat per altres amb els seus Bizums, fes servir “Afegir moviment” → Despesa compartida.</p>
      <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
        <Button variant="primary" onClick={save} disabled={filled.length === 0}>
          Desar {filled.length || ''} {filled.length === 1 ? 'moviment' : 'moviments'}
        </Button>
        <span className="text-sm text-ink-muted">
          Net: <span className={cx('amount font-medium', totalCents > 0 ? 'text-pos' : 'text-ink')}>{formatCents(totalCents)}</span>
        </span>
      </div>
    </div>
  );
}
