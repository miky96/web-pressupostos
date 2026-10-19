import { useState } from 'react';
import { planImport, requiredAccounts, type ImportPlan } from '../application/importService';
import { applyClosure, createAccount, mergeOpening } from '../domain/accounts';
import { formatCents } from '../domain/money';
import type { Account, TransactionKind } from '../domain/types';
import { importCsv, IMPORTERS } from '../importers/registry';
import type { ImportResult } from '../importers/types';
import { Button } from './kit/Button';
import { Card, CardHeader, PageHeader, Stat } from './kit/Card';
import { cx } from './kit/cx';
import { Alert, Badge } from './kit/Feedback';
import { Icon } from './kit/Icon';
import { formatDate, KIND_LABELS } from './labels';
import { newId, type BudgetState } from './useBudget';

/** Provisionals de subscripcions substituïts (la resta de replacedIds són moviments manuals fusionats). */
const subscriptionReplaced = (plan: ImportPlan) => plan.replacedIds.length - plan.manualMatches.length;

interface Preview {
  fileName: string;
  result: ImportResult;
  plan: ImportPlan;
  /** Comptes a crear o actualitzar (saldo inicial). */
  accounts: Account[];
  newAccountIds: Set<string>;
  /** Comptes nous o modificats (saldo inicial, tancament) que cal desar. */
  changedAccounts: Account[];
}

export function ImportPage({ budget }: { budget: BudgetState }) {
  const { data, run, setError } = budget;
  const [preview, setPreview] = useState<Preview | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
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
        accounts[i] = applyClosure(mergeOpening(accounts[i], { date: d.openingDate, balanceCents: d.openingBalanceCents }), d.closedAt);
      }
      const changedAccounts = accounts.filter((a) => newAccountIds.has(a.id) || data!.accounts.find((x) => x.id === a.id) !== a);
      const plan = planImport(result, {
        rules: data!.rules,
        accountIdByKey: Object.fromEntries(accounts.map((a) => [a.importKey!, a.id])),
        existingIds: new Set(data!.transactions.map((t) => t.id)),
        existingTransactions: data!.transactions,
        subscriptions: data!.subscriptions,
        debts: data!.debts,
      });
      setPreview({ fileName: file.name, result, plan, accounts, newAccountIds, changedAccounts });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function confirm() {
    if (!preview) return;
    await run(async (repo) => {
      await repo.upsertAccounts(preview.changedAccounts);
      await repo.upsertTransactions(preview.plan.transactions);
      // Enllaços (Bizums, deutes) que apuntaven als moviments manuals que ara són els del banc.
      if (preview.plan.updatedTransactions.length) await repo.upsertTransactions(preview.plan.updatedTransactions);
      if (preview.plan.updatedDebts.length) await repo.upsertDebts(preview.plan.updatedDebts);
      // Primer el real i després s'esborra el provisional: si falla a mig camí, no es perd el cobrament.
      if (preview.plan.replacedIds.length) await repo.deleteTransactions(preview.plan.replacedIds);
      if (preview.plan.subscriptions.length) await repo.upsertSubscriptions(preview.plan.subscriptions);
    });
    const archived = preview.changedAccounts.filter((a) => a.archived && a.closedAt).map((a) => a.name);
    setDone(
      `S'han importat ${preview.plan.transactions.length} moviments de ${preview.fileName}.` +
        (subscriptionReplaced(preview.plan) ? ` ${subscriptionReplaced(preview.plan)} cobraments de subscripcions ja són els reals del banc.` : '') +
        (preview.plan.manualMatches.length ? ` ${preview.plan.manualMatches.length} moviments apuntats a mà s'han fusionat amb els del banc.` : '') +
        (archived.length ? ` Comptes tancats pel banc i arxivats: ${archived.join(', ')}.` : ''),
    );
    setPreview(null);
  }

  const errors = preview?.plan.issues.filter((i) => i.level === 'error') ?? [];
  const warnings = preview?.plan.issues.filter((i) => i.level === 'warning') ?? [];

  return (
    <section>
      <PageHeader title="Importar extracte" subtitle={`Bancs suportats: ${IMPORTERS.map((i) => i.label).join(', ')}. El fitxer es llegeix al teu navegador; no es guarda l'original.`} />

      {done && (
        <Alert tone="pos" className="mb-6" onClose={() => setDone(null)}>
          {done}
        </Alert>
      )}

      {!preview && (
        <label
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const f = e.dataTransfer.files[0];
            if (f) onFile(f);
          }}
          className={cx(
            'flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-16 text-center transition',
            dragging ? 'border-accent bg-accent-soft' : 'border-line-strong bg-surface hover:border-accent/60 hover:bg-subtle/50',
          )}
        >
          <div className="mb-4 grid size-12 place-items-center rounded-full bg-accent-soft text-accent">
            <Icon name="upload" className="size-5" />
          </div>
          <div className="font-semibold">Arrossega aquí el CSV del banc</div>
          <div className="mt-1 text-sm text-ink-muted">o fes clic per triar-lo</div>
          <input type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
        </label>
      )}

      {preview && (
        <Card>
          <CardHeader
            title={
              <span className="flex items-center gap-2">
                <Icon name="file" className="text-ink-muted" /> {preview.fileName}
              </span>
            }
            subtitle="Revisa el resum abans d'importar."
          />
          <div className="space-y-6 p-5">
            <div className="grid grid-cols-2 gap-4 rounded-xl bg-subtle p-4 sm:grid-cols-4">
              <Stat label="Moviments nous" value={preview.plan.transactions.length} size="md" />
              <Stat label="Ja importats" value={preview.plan.duplicates} size="md" hint="s'ignoren" />
              <Stat label="Pendents o anul·lats" value={preview.plan.skipped.length} size="md" hint="s'ignoren" />
              <Stat label="Per revisar" value={preview.plan.needsReview} size="md" />
            </div>

            <div className="flex flex-wrap gap-1.5">
              {(Object.entries(preview.plan.byKind) as [TransactionKind, number][])
                .filter(([, n]) => n > 0)
                .map(([k, n]) => (
                  <Badge key={k}>
                    {KIND_LABELS[k]}: {n}
                  </Badge>
                ))}
            </div>

            {subscriptionReplaced(preview.plan) > 0 && (
              <Alert tone="info" title="Subscripcions">
                {subscriptionReplaced(preview.plan) === 1
                  ? 'Un cobrament provisional de subscripció se substituirà'
                  : `${subscriptionReplaced(preview.plan)} cobraments provisionals de subscripcions se substituiran`}{' '}
                pel moviment real del banc.
              </Alert>
            )}
            {preview.plan.manualMatches.length > 0 && (
              <Alert tone="info" title={`${preview.plan.manualMatches.length} moviments que ja havies apuntat a mà`}>
                Es fusionaran amb el del banc: es manté la teva descripció, categoria i enllaços (Bizums, deutes), i el saldo quadra amb l'extracte.
                <ul className="mt-2 space-y-0.5 text-xs">
                  {preview.plan.manualMatches.slice(0, 12).map((m) => (
                    <li key={m.manual.id} className="flex gap-2">
                      <span className="text-ink-muted">{formatDate(m.manual.date)}</span>
                      <span className="min-w-0 flex-1 truncate">
                        {m.manual.description} <span className="text-ink-faint">↔ {m.imported.description}</span>
                      </span>
                      <span className="amount">{formatCents(m.imported.amountCents)}</span>
                    </li>
                  ))}
                  {preview.plan.manualMatches.length > 12 && <li className="text-ink-faint">i {preview.plan.manualMatches.length - 12} més…</li>}
                </ul>
              </Alert>
            )}
            {errors.length > 0 && (
              <Alert tone="neg" title={`${errors.length} files amb errors (no s'importaran)`}>
                <ul className="mt-1 list-disc pl-4">
                  {errors.slice(0, 10).map((i, n) => (
                    <li key={n}>
                      Línia {i.line}: {i.message}
                    </li>
                  ))}
                </ul>
              </Alert>
            )}
            {warnings.length > 0 ? (
              <Alert tone="warn" title={`Atenció, el saldo no quadra en ${warnings.length} punts`}>
                <ul className="mt-1 list-disc pl-4">
                  {warnings.slice(0, 10).map((i, n) => (
                    <li key={n}>
                      Línia {i.line}: {i.message}
                    </li>
                  ))}
                </ul>
              </Alert>
            ) : (
              <Alert tone="pos">Els saldos del fitxer quadren amb tots els moviments.</Alert>
            )}

            <div>
              <h4 className="mb-2 text-sm font-semibold">Comptes</h4>
              <ul className="divide-y divide-line rounded-lg border border-line">
                {preview.accounts.map((a) => {
                  const d = preview.result.accounts.find((x) => x.key === a.importKey);
                  return (
                    <li key={a.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 font-medium">
                          {a.name}
                          {preview.newAccountIds.has(a.id) && <Badge tone="accent">nou</Badge>}
                          {d?.closedAt && preview.changedAccounts.includes(a) && a.archived && (
                            <Badge tone="warn" title={`Tancat pel banc el ${d.closedAt.slice(0, 10)}`}>
                              tancat → s'arxivarà
                            </Badge>
                          )}
                        </div>
                        <div className="text-xs text-ink-muted">{d ? `${d.rowCount} moviments al fitxer` : "No surt a l'export (valoració manual)"}</div>
                      </div>
                      {d && (
                        <div className="text-right">
                          <div className="amount font-semibold">{formatCents(d.closingBalanceCents, d.currency)}</div>
                          <div className="text-xs text-ink-faint">saldo final</div>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 border-t border-line px-5 py-4">
            <Button variant="primary" disabled={preview.plan.transactions.length === 0 && preview.changedAccounts.length === 0} onClick={confirm}>
              {preview.plan.transactions.length > 0 ? `Importar ${preview.plan.transactions.length} moviments` : 'Actualitzar comptes'}
            </Button>
            <Button onClick={() => setPreview(null)}>Cancel·lar</Button>
          </div>
        </Card>
      )}
    </section>
  );
}
