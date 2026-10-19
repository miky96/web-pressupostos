import { isPlaceholder } from '../../domain/subscriptions';
import { useState, type ReactNode } from 'react';
import { formatCents, parseUserAmount } from '../../domain/money';
import { editManualDetails, type ManualDetails } from '../../domain/transactions';
import { isNeutralKind, TRANSACTION_KINDS, type Category, type Transaction, type TransactionKind } from '../../domain/types';
import { CategoryDot } from '../CategoryAvatar';
import { Button } from '../kit/Button';
import { cx } from '../kit/cx';
import { Drawer } from '../kit/Drawer';
import { Alert, Badge, Switch } from '../kit/Feedback';
import { formatLongDate, KIND_LABELS } from '../labels';
import type { BudgetState } from '../useBudget';
import { isRecovery } from '../../domain/recoveries';
import { RecoverySection } from './RecoverySection';
import { Amount } from './TransactionList';

const INCOME_KINDS: TransactionKind[] = ['income', 'interest'];

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5 text-sm">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="min-w-0 text-right">{children}</dd>
    </div>
  );
}

/** Els moviments afegits a mà es poden corregir del tot (els importats, no: mana l'extracte). */
function ManualDetailsEditor({ tx, budget }: { tx: Transaction; budget: BudgetState }) {
  const { data, run } = budget;
  const [error, setError] = useState<string | null>(null);
  const accounts = (data?.accounts ?? []).filter((a) => !a.archived || a.id === tx.accountId);
  const isLeg = !!tx.transferGroupId;

  async function save(details: ManualDetails) {
    try {
      setError(null);
      const changed = editManualDetails(tx, details, data?.transactions ?? []);
      await run((repo) => repo.upsertTransactions(changed));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const abs = (Math.abs(tx.amountCents) / 100).toFixed(2).replace('.', ',');
  return (
    <section className="space-y-3 rounded-xl border border-line p-4">
      <h3 className="text-sm font-semibold">Dades del moviment</h3>
      {error && (
        <Alert tone="neg" onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      <label className="label">
        Descripció
        <input
          key={`d:${tx.description}`}
          className="input"
          defaultValue={tx.description}
          onBlur={(e) => e.target.value.trim() !== tx.description && save({ description: e.target.value })}
        />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="label">
          Import (€)
          <input
            key={`a:${tx.amountCents}`}
            className="input tabular-nums"
            inputMode="decimal"
            defaultValue={abs}
            onBlur={(e) => {
              if (e.target.value === abs) return;
              try {
                void save({ amountCents: parseUserAmount(e.target.value) });
              } catch (err) {
                setError(err instanceof Error ? err.message : String(err));
              }
            }}
          />
        </label>
        <label className="label">
          Data
          <input key={`t:${tx.date}`} className="input" type="date" defaultValue={tx.date.slice(0, 10)} onChange={(e) => e.target.value && save({ date: e.target.value })} />
        </label>
      </div>
      {!isLeg && (
        <label className="label">
          Compte
          <select className="input" value={tx.accountId} onChange={(e) => save({ accountId: e.target.value })}>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {isLeg && <p className="hint">És un traspàs: l'import i la data també es corregeixen a l'altra pota.</p>}
    </section>
  );
}

export function TransactionDrawer({
  tx,
  budget,
  learn,
  onLearnChange,
  onSave,
  onChangeCategory,
  onDelete,
  onPrev,
  onNext,
  onClose,
  onOpenTx,
}: {
  tx: Transaction;
  budget: BudgetState;
  learn: boolean;
  onLearnChange: (v: boolean) => void;
  onSave: (patch: Partial<Transaction>) => Promise<void>;
  onChangeCategory: (categoryId: string | undefined) => Promise<void>;
  onDelete: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  onClose: () => void;
  /** Obre un altre moviment (p.ex. la despesa enllaçada). */
  onOpenTx: (id: string) => void;
}) {
  const { data, lookups } = budget;
  const [showAllCats, setShowAllCats] = useState(false);
  const account = lookups.accounts.get(tx.accountId);
  const noCategory = isNeutralKind(tx.kind);
  const preferred: Category['kind'] = INCOME_KINDS.includes(tx.kind) ? 'income' : 'expense';
  // Una entrada per enllaçar (Bizum, devolució) es resol enllaçant-la: la categoria ve de la despesa.
  const linkFirst = isRecovery(tx) && !tx.recoversTxId;
  const recovery = <RecoverySection key={tx.id} tx={tx} budget={budget} onOpenTx={onOpenTx} />;
  const categories = (data?.categories ?? []).filter((c) => showAllCats || c.kind === preferred || c.id === tx.categoryId);

  return (
    <Drawer
      open
      onClose={onClose}
      title={tx.description}
      subtitle={`${formatLongDate(tx.date)}${account ? ` · ${account.name}` : ''}`}
      headerActions={
        <div className="flex">
          <Button variant="ghost" size="sm" icon="chevronLeft" disabled={!onPrev} onClick={onPrev} aria-label="Anterior" />
          <Button variant="ghost" size="sm" icon="chevronRight" disabled={!onNext} onClick={onNext} aria-label="Següent" />
        </div>
      }
      footer={
        <>
          <Button variant="danger" icon="trash" onClick={onDelete}>
            Eliminar
          </Button>
          <div className="flex-1" />
          <Button onClick={onClose}>Tancar</Button>
        </>
      }
    >
      <div className="mb-6 flex items-end justify-between gap-3">
        <Amount tx={tx} className="text-3xl tracking-tight" />
        <div className="flex gap-1.5">
          <Badge>{KIND_LABELS[tx.kind]}</Badge>
          {tx.source !== 'import' && <Badge tone="accent">{tx.source === 'manual' ? 'manual' : 'derivat'}</Badge>}
        </div>
      </div>

      {tx.needsReview && (
        <Alert
          tone="warn"
          title="Per revisar"
          className="mb-6"
          action={
            <Button size="sm" icon="check" onClick={() => onSave({})}>
              És correcte
            </Button>
          }
        >
          Cap regla l'ha pogut classificar amb seguretat. Tria'n la categoria o marca'l com a correcte.
        </Alert>
      )}

      <div className="space-y-6">
        {tx.source === 'manual' && <ManualDetailsEditor key={tx.id} tx={tx} budget={budget} />}

        <label className="label">
          Tipus
          <select className="input" value={tx.kind} onChange={(e) => onSave({ kind: e.target.value as TransactionKind })}>
            {TRANSACTION_KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </label>

        {linkFirst && recovery}

        {!noCategory && (
          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-medium">Categoria</span>
              <button className="text-xs font-medium text-accent" onClick={() => setShowAllCats((s) => !s)}>
                {showAllCats ? 'Només les habituals' : 'Totes'}
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {categories.map((c) => {
                const active = c.id === tx.categoryId;
                return (
                  <button
                    key={c.id}
                    onClick={() => onChangeCategory(active ? undefined : c.id)}
                    className={cx(
                      'inline-flex h-8 items-center gap-2 rounded-full border px-3 text-[13px] transition',
                      active ? 'border-accent bg-accent-soft font-medium text-accent-ink' : 'border-line hover:border-line-strong hover:bg-subtle',
                    )}
                  >
                    <CategoryDot color={c.color} />
                    {c.name}
                  </button>
                );
              })}
            </div>
            {tx.source === 'import' && (
              <label className="mt-3 flex cursor-pointer items-start gap-3 rounded-lg bg-subtle px-3 py-2.5 text-[13px]">
                <Switch checked={learn} onChange={onLearnChange} label="Aplicar als moviments iguals" />
                <span className="text-ink-muted">
                  <span className="font-medium text-ink">Aplicar a tots els "{tx.description}"</span>
                  <br />
                  Crea una regla perquè els moviments amb la mateixa descripció (i els futurs) tinguin aquesta categoria.
                </span>
              </label>
            )}
          </div>
        )}

        {!linkFirst && recovery}

        <label className="label">
          Notes
          <textarea
            key={tx.id}
            className="input h-auto min-h-20 py-2"
            defaultValue={tx.notes ?? ''}
            placeholder="Afegeix una nota…"
            onBlur={(e) => e.target.value !== (tx.notes ?? '') && onSave({ notes: e.target.value || undefined })}
          />
        </label>

        <label className="flex cursor-pointer items-center justify-between gap-3 text-sm">
          <span>
            <span className="font-medium">Amagar dels llistats</span>
            <span className="hint block">Continua comptant per al saldo, però no surt als totals.</span>
          </span>
          <Switch checked={!!tx.hidden} onChange={(v) => onSave({ hidden: v || undefined })} label="Amagar" />
        </label>

        <dl className="divide-y divide-line border-t border-line pt-2">
          {tx.bankType && <Row label="Tipus al banc">{tx.bankType}</Row>}
          {tx.feeCents > 0 && <Row label="Comissió">{formatCents(tx.feeCents, tx.currency)}</Row>}
          {tx.balanceAfterCents !== undefined && <Row label="Saldo després">{formatCents(tx.balanceAfterCents, tx.currency)}</Row>}
          {tx.transferGroupId && <Row label="Enllaçat">Té una parella (traspàs o anul·lació)</Row>}
          {tx.subscriptionId && (
            <Row label="Subscripció">
              {data?.subscriptions.find((s) => s.id === tx.subscriptionId)?.name ?? 'Eliminada'}
              {isPlaceholder(tx) && account?.importKey && <span className="hint block">Provisional: se substituirà pel moviment real en importar.</span>}
            </Row>
          )}
          <Row label="Origen">{tx.source === 'import' ? 'Importat' : tx.source === 'manual' ? 'Afegit a mà' : 'Derivat'}</Row>
        </dl>
      </div>
    </Drawer>
  );
}
