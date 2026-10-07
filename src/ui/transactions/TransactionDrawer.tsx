import { useState, type ReactNode } from 'react';
import { formatCents } from '../../domain/money';
import { TRANSACTION_KINDS, type Category, type Transaction, type TransactionKind } from '../../domain/types';
import { CategoryDot } from '../CategoryAvatar';
import { Button } from '../kit/Button';
import { cx } from '../kit/cx';
import { Drawer } from '../kit/Drawer';
import { Alert, Badge, Switch } from '../kit/Feedback';
import { formatLongDate, KIND_LABELS } from '../labels';
import type { BudgetState } from '../useBudget';
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
}) {
  const { data, lookups } = budget;
  const [showAllCats, setShowAllCats] = useState(false);
  const account = lookups.accounts.get(tx.accountId);
  const noCategory = tx.kind === 'transfer' || tx.kind === 'adjustment';
  const preferred: Category['kind'] = INCOME_KINDS.includes(tx.kind) ? 'income' : 'expense';
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
          <Row label="Origen">{tx.source === 'import' ? 'Importat' : tx.source === 'manual' ? 'Afegit a mà' : 'Derivat'}</Row>
        </dl>
      </div>
    </Drawer>
  );
}
