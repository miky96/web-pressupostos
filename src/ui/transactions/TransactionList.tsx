import { formatCents } from '../../domain/money';
import { groupByDay } from '../../domain/periods';
import type { Transaction } from '../../domain/types';
import { CategoryAvatar } from '../CategoryAvatar';
import { Badge } from '../kit/Feedback';
import { cx } from '../kit/cx';
import { Icon } from '../kit/Icon';
import { formatDayHeading, KIND_LABELS } from '../labels';
import type { BudgetState } from '../useBudget';

const NEUTRAL_KINDS = new Set(['transfer', 'adjustment']);

/** Import amb signe explícit: les entrades en verd, les despeses en el color del text. */
export function Amount({ tx, className }: { tx: Pick<Transaction, 'amountCents' | 'currency' | 'kind'>; className?: string }) {
  const neutral = NEUTRAL_KINDS.has(tx.kind);
  const text = formatCents(Math.abs(tx.amountCents), tx.currency);
  return (
    <span className={cx('amount font-semibold', neutral ? 'text-ink-muted' : tx.amountCents > 0 ? 'text-pos' : 'text-ink', className)}>
      {tx.amountCents > 0 ? '+' : tx.amountCents < 0 ? '−' : ''}
      {text}
    </span>
  );
}

export function TransactionList({
  rows,
  lookups,
  selected,
  activeId,
  onToggle,
  onToggleDay,
  onOpen,
}: {
  rows: Transaction[];
  lookups: BudgetState['lookups'];
  selected: Set<string>;
  activeId?: string;
  onToggle: (id: string) => void;
  onToggleDay: (ids: string[]) => void;
  onOpen: (tx: Transaction) => void;
}) {
  const selecting = selected.size > 0;
  const multiAccount = lookups.accounts.size > 1;

  return (
    <div className="flex flex-col gap-5">
      {groupByDay(rows).map(({ day, items }) => {
        const net = items.filter((t) => !t.hidden && !NEUTRAL_KINDS.has(t.kind)).reduce((s, t) => s + t.amountCents, 0);
        const ids = items.map((t) => t.id);
        const allSelected = ids.every((id) => selected.has(id));
        return (
          <section key={day}>
            <div className="group/day mb-1.5 flex items-center gap-2 px-1">
              <input
                type="checkbox"
                className={cx('checkbox transition', selecting ? 'opacity-100' : 'opacity-0 group-hover/day:opacity-100 focus:opacity-100')}
                checked={allSelected}
                onChange={() => onToggleDay(ids)}
                aria-label="Seleccionar el dia"
              />
              <h3 className="flex-1 text-[13px] font-semibold text-ink-muted">{formatDayHeading(day)}</h3>
              {net !== 0 && <span className={cx('amount text-xs font-medium', net > 0 ? 'text-pos' : 'text-ink-faint')}>{formatCents(net)}</span>}
            </div>
            <ul className="overflow-hidden rounded-xl border border-line bg-surface shadow-card">
              {items.map((t) => {
                const category = t.categoryId ? lookups.categories.get(t.categoryId) : undefined;
                const isSel = selected.has(t.id);
                const meta = [
                  NEUTRAL_KINDS.has(t.kind) ? KIND_LABELS[t.kind] : (category?.name ?? 'Sense categoria'),
                  multiAccount && lookups.accounts.get(t.accountId)?.name,
                  t.date.slice(11, 16) !== '00:00' && t.date.slice(11, 16),
                ].filter(Boolean);
                return (
                  <li
                    key={t.id}
                    onClick={() => onOpen(t)}
                    className={cx(
                      'group flex cursor-pointer items-center gap-3 border-b border-line px-3 py-2.5 transition last:border-b-0 sm:px-4',
                      isSel ? 'bg-accent-soft' : activeId === t.id ? 'bg-subtle' : 'hover:bg-subtle/70',
                      t.hidden && 'opacity-50',
                    )}
                  >
                    <input
                      type="checkbox"
                      className={cx('checkbox transition', selecting ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus:opacity-100', !selecting && 'max-sm:hidden')}
                      checked={isSel}
                      onClick={(e) => e.stopPropagation()}
                      onChange={() => onToggle(t.id)}
                      aria-label="Seleccionar"
                    />
                    <CategoryAvatar tx={t} category={category} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium">{t.description}</span>
                        {t.needsReview && !t.hidden && (
                          <Badge tone="warn" className="max-sm:hidden">
                            Per revisar
                          </Badge>
                        )}
                        {t.source === 'manual' && <Badge className="max-sm:hidden">manual</Badge>}
                        {t.hidden && (
                          <Icon name="eyeOff" className="size-3.5 text-ink-faint" aria-label="Amagat" />
                        )}
                      </div>
                      <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-ink-muted">
                        <span className={cx('truncate', !category && !NEUTRAL_KINDS.has(t.kind) && t.needsReview && 'text-warn')}>{meta.join(' · ')}</span>
                        {t.notes && (
                          <span className="flex min-w-0 items-center gap-1 text-ink-faint" title={t.notes}>
                            <Icon name="note" className="size-3.5" />
                            <span className="truncate max-sm:hidden">{t.notes}</span>
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="text-right">
                      <Amount tx={t} className="text-sm" />
                      {(t.kind === 'refund' || t.kind === 'reimbursement' || t.kind === 'interest') && (
                        <div className="text-[11px] text-ink-faint">{KIND_LABELS[t.kind]}</div>
                      )}
                      {t.feeCents > 0 && <div className="text-[11px] text-ink-faint">comissió {formatCents(t.feeCents)}</div>}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
