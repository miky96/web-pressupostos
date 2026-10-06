import { useState } from 'react';
import { planImport, requiredAccounts, type ImportPlan } from '../application/importService';
import { createAccount, mergeOpening } from '../domain/accounts';
import { formatCents } from '../domain/money';
import type { Account, TransactionKind } from '../domain/types';
import { importCsv, IMPORTERS } from '../importers/registry';
import type { ImportResult } from '../importers/types';
import { KIND_LABELS } from './labels';
import { newId, type BudgetState } from './useBudget';

interface Preview {
  fileName: string;
  result: ImportResult;
  plan: ImportPlan;
  /** Comptes a crear o actualitzar (saldo inicial). */
  accounts: Account[];
  newAccountIds: Set<string>;
}

export function ImportPage({ budget }: { budget: BudgetState }) {
  const { data, run, setError } = budget;
  const [preview, setPreview] = useState<Preview | null>(null);
  const [done, setDone] = useState<string | null>(null);
  if (!data) return null;

  async function onFile(file: File) {
    setDone(null);
    setPreview(null);
    try {
      const { result } = importCsv(await file.text());
      const accounts: Account[] = [];
      const newAccountIds = new Set<string>();
      for (const req of requiredAccounts(result, data!.rules)) {
        const existing = data!.accounts.find((a) => a.importKey === req.key);
        if (existing) {
          accounts.push(existing);
        } else {
          const acc = createAccount(
            {
              name: req.suggestedName,
              type: req.suggestedType,
              currency: req.currency,
              institution: result.importerId,
              importKey: req.key,
              balanceMode: req.mirrorOnly ? 'valuations' : 'transactions',
            },
            newId('acc'),
          );
          accounts.push(acc);
          newAccountIds.add(acc.id);
        }
      }
      for (const d of result.accounts) {
        const i = accounts.findIndex((a) => a.importKey === d.key);
        accounts[i] = mergeOpening(accounts[i], { date: d.openingDate, balanceCents: d.openingBalanceCents });
      }
      const plan = planImport(result, {
        rules: data!.rules,
        accountIdByKey: Object.fromEntries(accounts.map((a) => [a.importKey!, a.id])),
        existingIds: new Set(data!.transactions.map((t) => t.id)),
      });
      setPreview({ fileName: file.name, result, plan, accounts, newAccountIds });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function confirm() {
    if (!preview) return;
    await run(async (repo) => {
      await repo.upsertAccounts(preview.accounts);
      await repo.upsertTransactions(preview.plan.transactions);
    });
    setDone(`S'han importat ${preview.plan.transactions.length} moviments de ${preview.fileName}.`);
    setPreview(null);
  }

  const errors = preview?.plan.issues.filter((i) => i.level === 'error') ?? [];
  const warnings = preview?.plan.issues.filter((i) => i.level === 'warning') ?? [];

  return (
    <section>
      <h2>Importar extracte</h2>
      <p className="muted">
        Bancs suportats: {IMPORTERS.map((i) => i.label).join(', ')}. El fitxer es llegeix al teu navegador; no es guarda
        l'original.
      </p>
      <input type="file" accept=".csv,text/csv" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
      {done && <p className="ok">{done}</p>}

      {preview && (
        <div className="card">
          <h3>{preview.fileName}</h3>
          {errors.length > 0 && (
            <div className="error">
              <strong>{errors.length} files amb errors (no s'importaran):</strong>
              <ul>
                {errors.slice(0, 10).map((i, n) => (
                  <li key={n}>Línia {i.line}: {i.message}</li>
                ))}
              </ul>
            </div>
          )}
          {warnings.length > 0 ? (
            <div className="warning">
              <strong>Atenció, el saldo no quadra en {warnings.length} punts:</strong>
              <ul>
                {warnings.slice(0, 10).map((i, n) => (
                  <li key={n}>Línia {i.line}: {i.message}</li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="ok">✓ Els saldos del fitxer quadren amb tots els moviments.</p>
          )}

          <table>
            <thead>
              <tr>
                <th>Compte</th>
                <th>Moviments al fitxer</th>
                <th>Saldo final (fitxer)</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {preview.accounts.map((a) => {
                const d = preview.result.accounts.find((x) => x.key === a.importKey);
                return (
                  <tr key={a.id}>
                    <td>{a.name}</td>
                    <td>{d?.rowCount ?? '—'}</td>
                    <td>{d ? formatCents(d.closingBalanceCents, d.currency) : "no surt a l'export (valoració manual)"}</td>
                    <td>{preview.newAccountIds.has(a.id) ? <span className="badge">nou</span> : ''}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <ul className="stats">
            <li>
              <strong>{preview.plan.transactions.length}</strong> moviments nous
            </li>
            <li>
              <strong>{preview.plan.duplicates}</strong> ja importats (s'ignoren)
            </li>
            <li>
              <strong>{preview.plan.skipped.length}</strong> pendents o anul·lats (s'ignoren)
            </li>
            <li>
              <strong>{preview.plan.needsReview}</strong> per revisar
            </li>
          </ul>
          <p className="muted">
            {(Object.entries(preview.plan.byKind) as [TransactionKind, number][])
              .filter(([, n]) => n > 0)
              .map(([k, n]) => `${KIND_LABELS[k]}: ${n}`)
              .join(' · ')}
          </p>
          <button className="primary" disabled={preview.plan.transactions.length === 0} onClick={confirm}>
            Importar {preview.plan.transactions.length} moviments
          </button>{' '}
          <button onClick={() => setPreview(null)}>Cancel·lar</button>
        </div>
      )}
    </section>
  );
}
