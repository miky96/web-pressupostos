import type { Cents } from './money';
import { periodRange, shiftMonth } from './periods';
import { filterTransactions, netExpenseByCategory } from './summary';
import type { Category, SpendingLimit, Transaction } from './types';

export const limitId = (categoryId: string) => `limit_${categoryId}`;

/** Crea o actualitza el límit d'una categoria de despesa (només un per categoria). */
export function saveLimit(input: { categoryId: string; monthlyCents: Cents }, categories: Category[]): SpendingLimit {
  const cat = categories.find((c) => c.id === input.categoryId);
  if (!cat) throw new Error('Tria una categoria');
  if (cat.kind !== 'expense') throw new Error('Només es poden limitar categories de despesa');
  if (!(input.monthlyCents > 0)) throw new Error('El límit ha de ser més gran que 0');
  return { id: limitId(cat.id), categoryId: cat.id, monthlyCents: input.monthlyCents };
}

export function daysInMonth(month: string): number {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Fracció del mes ja passada a `today` (0 si és futur, 1 si ja ha acabat). */
export function elapsedFraction(month: string, today: string): number {
  const current = today.slice(0, 7);
  if (month < current) return 1;
  if (month > current) return 0;
  return Number(today.slice(8, 10)) / daysInMonth(month);
}

export type LimitTone = 'ok' | 'warn' | 'over';

export interface LimitStatus {
  limit: SpendingLimit;
  spentCents: Cents;
  /** Pot ser > 1 si t'has passat. */
  ratio: number;
  /** Negatiu si t'has passat. */
  remainingCents: Cents;
  /** Quant "tocaria" portar gastat avui per anar al ritme del límit. */
  paceCents: Cents;
  tone: LimitTone;
}

/** Avís si ja has gastat el 80 % o, a mig mes, vas per sobre del ritme (i ja portes la meitat). */
export function limitTone(spentCents: Cents, limitCents: Cents, elapsed: number): LimitTone {
  if (spentCents > limitCents) return 'over';
  const ratio = spentCents / limitCents;
  if (ratio >= 0.8) return 'warn';
  if (elapsed < 1 && ratio >= 0.5 && spentCents > limitCents * elapsed) return 'warn';
  return 'ok';
}

export interface MonthLimits {
  month: string;
  elapsed: number;
  daysLeft: number;
  rows: LimitStatus[];
  totalLimitCents: Cents;
  totalSpentCents: Cents;
  /** Despesa del mes en categories sense límit (inclou "sense categoria"). */
  unlimitedSpentCents: Cents;
}

/**
 * Estat dels límits d'un mes. `txs` ha de venir ja atribuït a la vista que es vulgui
 * (attributeForView), així el consum real resta els Bizums enllaçats de la seva categoria.
 */
export function monthLimits(limits: SpendingLimit[], txs: Transaction[], month: string, today: string): MonthLimits {
  const spent = netExpenseByCategory(filterTransactions(txs, periodRange({ kind: 'month', month })));
  const elapsed = elapsedFraction(month, today);
  const limited = new Set(limits.map((l) => l.categoryId));
  const rows = limits.map((limit): LimitStatus => {
    const spentCents = Math.max(spent.get(limit.categoryId) ?? 0, 0);
    return {
      limit,
      spentCents,
      ratio: spentCents / limit.monthlyCents,
      remainingCents: limit.monthlyCents - spentCents,
      paceCents: Math.round(limit.monthlyCents * elapsed),
      tone: limitTone(spentCents, limit.monthlyCents, elapsed),
    };
  });
  let unlimitedSpentCents = 0;
  for (const [cat, cents] of spent) if (!limited.has(cat)) unlimitedSpentCents += Math.max(cents, 0);
  const daysLeft = elapsed >= 1 ? 0 : elapsed <= 0 ? daysInMonth(month) : daysInMonth(month) - Number(today.slice(8, 10)) + 1;
  return {
    month,
    elapsed,
    daysLeft,
    rows: rows.sort((a, b) => b.ratio - a.ratio),
    totalLimitCents: limits.reduce((s, l) => s + l.monthlyCents, 0),
    totalSpentCents: rows.reduce((s, r) => s + r.spentCents, 0),
    unlimitedSpentCents,
  };
}

/**
 * Despesa mitjana mensual d'una categoria en els `months` mesos complets anteriors a `month`
 * (serveix per suggerir un límit). Els mesos sense cap moviment al pressupost no compten.
 */
export function averageMonthlySpend(txs: Transaction[], categoryId: string, month: string, months = 3): Cents {
  const firstDate = txs.reduce((min, t) => (t.hidden || (min && min <= t.date) ? min : t.date), '');
  if (!firstDate) return 0;
  const values: Cents[] = [];
  for (let i = 1; i <= months; i++) {
    const m = shiftMonth(month, -i);
    if (m < firstDate.slice(0, 7)) break;
    const spent = netExpenseByCategory(filterTransactions(txs, periodRange({ kind: 'month', month: m }))).get(categoryId) ?? 0;
    values.push(Math.max(spent, 0));
  }
  return values.length ? Math.round(values.reduce((s, v) => s + v, 0) / values.length) : 0;
}

/** Quant pots gastar per dia la resta del mes sense passar-te (0 si ja t'has passat o el mes ha acabat). */
export function dailyAllowance(remainingCents: Cents, daysLeft: number): Cents {
  return daysLeft > 0 && remainingCents > 0 ? Math.floor(remainingCents / daysLeft) : 0;
}

