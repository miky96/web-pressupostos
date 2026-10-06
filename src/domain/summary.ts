import { monthOf } from './dates';
import type { Cents } from './money';
import type { Transaction, TransactionKind } from './types';

export interface TransactionFilter {
  from?: string;
  to?: string;
  accountIds?: string[];
  kinds?: TransactionKind[];
  categoryIds?: string[];
  text?: string;
  includeHidden?: boolean;
  onlyNeedsReview?: boolean;
}

export function filterTransactions(txs: Transaction[], f: TransactionFilter): Transaction[] {
  const text = f.text?.trim().toLowerCase();
  return txs.filter(
    (t) =>
      (f.includeHidden || !t.hidden) &&
      (!f.from || t.date >= f.from) &&
      (!f.to || t.date <= f.to) &&
      (!f.accountIds?.length || f.accountIds.includes(t.accountId)) &&
      (!f.kinds?.length || f.kinds.includes(t.kind)) &&
      (!f.categoryIds?.length || f.categoryIds.includes(t.categoryId ?? '')) &&
      (!f.onlyNeedsReview || !!t.needsReview) &&
      (!text || t.description.toLowerCase().includes(text) || (t.notes ?? '').toLowerCase().includes(text)),
  );
}

export interface PeriodSummary {
  incomeCents: Cents;
  interestCents: Cents;
  /** Despeses brutes (en positiu). */
  grossExpenseCents: Cents;
  refundsCents: Cents;
  reimbursementsCents: Cents;
  /** Despeses reals = brutes - devolucions - reemborsaments. */
  netExpenseCents: Cents;
  /** Ingressos + interessos - despeses reals. */
  savingsCents: Cents;
}

/** Els traspassos, ajustos i moviments amagats no compten ni com a ingrés ni com a despesa. */
export function summarize(txs: Transaction[]): PeriodSummary {
  const s = { incomeCents: 0, interestCents: 0, grossExpenseCents: 0, refundsCents: 0, reimbursementsCents: 0 };
  for (const t of txs) {
    if (t.hidden) continue;
    switch (t.kind) {
      case 'income':
        s.incomeCents += t.amountCents;
        break;
      case 'interest':
        s.interestCents += t.amountCents;
        break;
      case 'expense':
        s.grossExpenseCents -= t.amountCents;
        break;
      case 'refund':
        s.refundsCents += t.amountCents;
        break;
      case 'reimbursement':
        s.reimbursementsCents += t.amountCents;
        break;
      default:
        break;
    }
  }
  const netExpenseCents = s.grossExpenseCents - s.refundsCents - s.reimbursementsCents;
  return { ...s, netExpenseCents, savingsCents: s.incomeCents + s.interestCents - netExpenseCents };
}

export const UNCATEGORIZED = '__sense-categoria__';

/** Despesa neta per categoria (les devolucions i reemborsaments resten de la seva categoria). */
export function netExpenseByCategory(txs: Transaction[]): Map<string, Cents> {
  const out = new Map<string, Cents>();
  for (const t of txs) {
    if (t.hidden) continue;
    if (t.kind !== 'expense' && t.kind !== 'refund' && t.kind !== 'reimbursement') continue;
    const key = t.categoryId ?? UNCATEGORIZED;
    out.set(key, (out.get(key) ?? 0) - t.amountCents);
  }
  return out;
}

export function monthlySummaries(txs: Transaction[]): { month: string; summary: PeriodSummary }[] {
  const byMonth = new Map<string, Transaction[]>();
  for (const t of txs) {
    const m = monthOf(t.date);
    byMonth.set(m, [...(byMonth.get(m) ?? []), t]);
  }
  return [...byMonth.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, list]) => ({ month, summary: summarize(list) }));
}
