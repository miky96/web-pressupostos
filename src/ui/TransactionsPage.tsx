import { useMemo, useState } from 'react';
import { reclassify } from '../application/importService';
import type { Rule } from '../domain/classification';
import { formatCents } from '../domain/money';
import { filterTransactions, summarize, type TransactionFilter } from '../domain/summary';
import { editTransaction } from '../domain/transactions';
import { TRANSACTION_KINDS, type Transaction, type TransactionKind } from '../domain/types';
import { formatDate, KIND_LABELS } from './labels';
import { TransactionForm } from './TransactionForm';
import { newId, type BudgetState } from './useBudget';

const PAGE = 200;

export function TransactionsPage({ budget }: { budget: BudgetState }) {
  const { data, run, lookups } = budget;
  const [filter, setFilter] = useState<TransactionFilter>({});
  const [limit, setLimit] = useState(PAGE);
  const [showForm, setShowForm] = useState(false);
  const [learn, setLearn] = useState(true);

  const rows = useMemo(
    () => (data ? filterTransactions(data.transactions, filter).sort((a, b) => b.date.localeCompare(a.date)) : []),
    [data, filter],
  );
  const totals = useMemo(() => summarize(rows), [rows]);
  if (!data) return null;

  const set = (patch: Partial<TransactionFilter>) => {
    setFilter((f) => ({ ...f, ...patch }));
    setLimit(PAGE);
  };

  const save = (tx: Transaction, patch: Partial<Transaction>) => run((repo) => repo.upsertTransactions([editTransaction(tx, patch)]));

  /** Canviar la categoria pot crear una regla perquè els moviments iguals (i els futurs) també canviïn. */
  async function changeCategory(tx: Transaction, categoryId: string | undefined) {
    await run(async (repo) => {
      await repo.upsertTransactions([editTransaction(tx, { categoryId })]);
      if (!learn || !categoryId || tx.source !== 'import') return;
      const rule: Rule = {
        id: newId('rule'),
        name: `"${tx.description}" → ${lookups.categories.get(categoryId)?.name ?? categoryId}`,
        priority: 90,
        when: { descriptionContains: tx.description },
        then: { categoryId },
      };
      await repo.upsertRules([rule]);
      const keyById = Object.fromEntries(data!.accounts.map((a) => [a.id, a.importKey ?? '']));
      const others = data!.transactions.filter((t) => t.id !== tx.id);
      const updated = reclassify(others, [rule, ...data!.rules], keyById).filter(
        (t, i) => t.categoryId !== others[i].categoryId || t.kind !== others[i].kind || t.hidden !== others[i].hidden,
      );
      await repo.upsertTransactions(updated);
    });
  }

  async function remove(tx: Transaction) {
    const group = tx.transferGroupId ? data!.transactions.filter((t) => t.transferGroupId === tx.transferGroupId) : [tx];
    const msg = group.length > 1 ? `Eliminar aquest moviment i la seva parella (${group.length})?` : 'Eliminar aquest moviment?';
    if (!window.confirm(msg)) return;
    await run((repo) => repo.deleteTransactions(group.map((t) => t.id)));
  }

  return (
    <section>
      <div className="row-between">
        <h2>Moviments</h2>
        <button className="primary" onClick={() => setShowForm((s) => !s)}>
          + Afegir moviment
        </button>
      </div>
      {showForm && <TransactionForm budget={budget} onDone={() => setShowForm(false)} />}

      <div className="filters">
        <input placeholder="Cerca descripció o notes" value={filter.text ?? ''} onChange={(e) => set({ text: e.target.value })} />
        <label>
          Des de <input type="date" value={filter.from?.slice(0, 10) ?? ''} onChange={(e) => set({ from: e.target.value ? `${e.target.value}T00:00:00` : undefined })} />
        </label>
        <label>
          Fins <input type="date" value={filter.to?.slice(0, 10) ?? ''} onChange={(e) => set({ to: e.target.value ? `${e.target.value}T23:59:59` : undefined })} />
        </label>
        <select value={filter.accountIds?.[0] ?? ''} onChange={(e) => set({ accountIds: e.target.value ? [e.target.value] : undefined })}>
          <option value="">Tots els comptes</option>
          {data.accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <select value={filter.kinds?.[0] ?? ''} onChange={(e) => set({ kinds: e.target.value ? [e.target.value as TransactionKind] : undefined })}>
          <option value="">Tots els tipus</option>
          {TRANSACTION_KINDS.map((k) => (
            <option key={k} value={k}>
              {KIND_LABELS[k]}
            </option>
          ))}
        </select>
        <select value={filter.categoryIds?.[0] ?? ''} onChange={(e) => set({ categoryIds: e.target.value ? [e.target.value] : undefined })}>
          <option value="">Totes les categories</option>
          {data.categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <label>
          <input type="checkbox" checked={!!filter.onlyNeedsReview} onChange={(e) => set({ onlyNeedsReview: e.target.checked })} /> Per revisar
        </label>
        <label>
          <input type="checkbox" checked={!!filter.includeHidden} onChange={(e) => set({ includeHidden: e.target.checked })} /> Mostrar amagats
        </label>
      </div>

      <ul className="stats">
        <li>Ingressos <strong>{formatCents(totals.incomeCents + totals.interestCents)}</strong></li>
        <li>Despesa real <strong>{formatCents(totals.netExpenseCents)}</strong></li>
        <li>Estalvi <strong>{formatCents(totals.savingsCents)}</strong></li>
        <li className="muted">{rows.length} moviments (els traspassos no compten)</li>
      </ul>
      <label className="muted">
        <input type="checkbox" checked={learn} onChange={(e) => setLearn(e.target.checked)} /> En canviar una categoria, aplica-la també als moviments amb la mateixa descripció (crea una regla)
      </label>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Data</th>
              <th>Compte</th>
              <th>Descripció</th>
              <th>Tipus</th>
              <th>Categoria</th>
              <th className="num">Import</th>
              <th>Notes</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, limit).map((t) => (
              <tr key={t.id} className={t.hidden ? 'hidden-row' : t.needsReview ? 'review-row' : ''}>
                <td className="nowrap">{formatDate(t.date)}</td>
                <td>{lookups.accounts.get(t.accountId)?.name ?? '?'}</td>
                <td>
                  {t.description}
                  {t.source !== 'import' && <span className="badge">{t.source === 'manual' ? 'manual' : 'derivat'}</span>}
                  {t.feeCents > 0 && <span className="muted"> (comissió {formatCents(t.feeCents)})</span>}
                </td>
                <td>
                  <select value={t.kind} onChange={(e) => save(t, { kind: e.target.value as TransactionKind })}>
                    {TRANSACTION_KINDS.map((k) => (
                      <option key={k} value={k}>
                        {KIND_LABELS[k]}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  {t.kind === 'transfer' || t.kind === 'adjustment' ? (
                    <span className="muted">—</span>
                  ) : (
                    <select value={t.categoryId ?? ''} onChange={(e) => changeCategory(t, e.target.value || undefined)}>
                      <option value="">— sense categoria —</option>
                      {data.categories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  )}
                </td>
                <td className={`num ${t.amountCents < 0 ? 'neg' : 'pos'}`}>{formatCents(t.amountCents, t.currency)}</td>
                <td>
                  <input
                    className="notes"
                    defaultValue={t.notes ?? ''}
                    onBlur={(e) => e.target.value !== (t.notes ?? '') && save(t, { notes: e.target.value || undefined })}
                  />
                </td>
                <td>
                  <button className="link" title="Eliminar" onClick={() => remove(t)}>
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > limit && <button onClick={() => setLimit((l) => l + PAGE)}>Mostrar més ({rows.length - limit} restants)</button>}
    </section>
  );
}
