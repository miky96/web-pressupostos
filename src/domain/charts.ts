/**
 * Sèries per a la vista de gràfiques. Tot es calcula al client a partir dels moviments:
 * funcions pures, sense dependències de la llibreria de gràfiques.
 */
import { accountBalance } from './balances';
import { monthOf } from './dates';
import type { Cents } from './money';
import { shiftMonth } from './periods';
import { netExpenseByCategory, summarize } from './summary';
import type { Account, Category, Transaction, Valuation } from './types';

/** Clau de la sèrie que agrupa les categories petites. */
export const OTHER = '__altres__';

/** Mesos (YYYY-MM) de `from` a `to`, tots dos inclosos. */
export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let m = from; m <= to && out.length < 1200; m = shiftMonth(m, 1)) out.push(m);
  return out;
}

/** Mesos que cobreix un rang de dates; els extrems oberts s'omplen amb el primer/últim moviment. */
export function monthsForRange(txs: Transaction[], range: { from?: string; to?: string }): string[] {
  let first = '';
  let last = '';
  for (const t of txs) {
    if (t.hidden) continue;
    if (!first || t.date < first) first = t.date;
    if (t.date > last) last = t.date;
  }
  const from = range.from ? monthOf(range.from) : first && monthOf(first);
  const to = range.to ? monthOf(range.to) : last && monthOf(last);
  return from && to ? monthsBetween(from, to) : [];
}

function groupByMonth(txs: Transaction[]): Map<string, Transaction[]> {
  const out = new Map<string, Transaction[]>();
  for (const t of txs) {
    const m = monthOf(t.date);
    const list = out.get(m);
    if (list) list.push(t);
    else out.set(m, [t]);
  }
  return out;
}

export interface CashflowPoint {
  month: string;
  /** Ingressos + interessos. */
  incomeCents: Cents;
  /** Despesa real (bruta - devolucions - reemborsaments). */
  expenseCents: Cents;
  savingsCents: Cents;
  /** null si el mes no té ingressos. */
  savingsRate: number | null;
}

/** Ingressos, despesa real i estalvi per mes (els mesos sense moviments surten a 0). */
export function monthlyCashflow(txs: Transaction[], months: string[]): CashflowPoint[] {
  const byMonth = groupByMonth(txs);
  return months.map((month) => {
    const s = summarize(byMonth.get(month) ?? []);
    const incomeCents = s.incomeCents + s.interestCents;
    return {
      month,
      incomeCents,
      expenseCents: s.netExpenseCents,
      savingsCents: s.savingsCents,
      savingsRate: incomeCents > 0 ? s.savingsCents / incomeCents : null,
    };
  });
}

export interface CategoryBreakdown {
  /** Categories mostrades, de més a menys despesa; OTHER (si n'hi ha) sempre al final. */
  keys: string[];
  /** Despesa neta del període per clau (inclou OTHER). */
  totals: Map<string, Cents>;
  /** Despesa per mes i clau. Mai negativa: un mes amb més devolucions que despesa es mostra a 0. */
  rows: { month: string; values: Record<string, Cents> }[];
}

/** Despesa neta per categoria i mes, amb les `top` categories principals i la resta a OTHER. */
export function categoryBreakdown(txs: Transaction[], months: string[], top = 6): CategoryBreakdown {
  const ranked = [...netExpenseByCategory(txs).entries()].filter(([, c]) => c > 0).sort((a, b) => b[1] - a[1]);
  // Si només en sobraria una, no cal "Altres": es mostra tal qual.
  const shown = ranked.length <= top + 1 ? ranked : ranked.slice(0, top);
  const shownIds = new Set(shown.map(([id]) => id));
  const keyOf = (id: string) => (shownIds.has(id) ? id : OTHER);

  const totals = new Map<string, Cents>(shown);
  const otherTotal = ranked.filter(([id]) => !shownIds.has(id)).reduce((s, [, c]) => s + c, 0);
  if (otherTotal > 0) totals.set(OTHER, otherTotal);

  const byMonth = groupByMonth(txs);
  const rows = months.map((month) => {
    const values: Record<string, Cents> = {};
    for (const [id, cents] of netExpenseByCategory(byMonth.get(month) ?? [])) {
      const key = keyOf(id);
      values[key] = (values[key] ?? 0) + cents;
    }
    for (const k of Object.keys(values)) values[k] = Math.max(0, values[k]);
    return { month, values };
  });
  return { keys: [...shown.map(([id]) => id), ...(otherTotal > 0 ? [OTHER] : [])], totals, rows };
}

export interface TrendSeries {
  points: { month: string; cents: Cents }[];
  /** Mitjana mensual del període (mesos a 0 inclosos). */
  averageCents: Cents;
}

/**
 * Evolució mensual d'una categoria (UNCATEGORIZED per a la despesa sense categoria). Les de despesa es mesuren com a despesa neta;
 * les d'ingrés, com la suma d'ingressos i interessos amb aquesta categoria.
 */
export function categoryTrend(txs: Transaction[], months: string[], categoryId: string, kind: Category['kind']): TrendSeries {
  const byMonth = groupByMonth(txs);
  const points = months.map((month) => {
    const list = byMonth.get(month) ?? [];
    const cents =
      kind === 'expense'
        ? (netExpenseByCategory(list).get(categoryId) ?? 0)
        : list
            .filter((t) => !t.hidden && (t.kind === 'income' || t.kind === 'interest') && t.categoryId === categoryId)
            .reduce((s, t) => s + t.amountCents, 0);
    return { month, cents };
  });
  const averageCents = points.length ? Math.round(points.reduce((s, p) => s + p.cents, 0) / points.length) : 0;
  return { points, averageCents };
}

/** Últim instant del mes ("2026-02" -> "2026-02-28T23:59:59"). */
export function endOfMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  const day = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${month}-${String(day).padStart(2, '0')}T23:59:59`;
}

export interface NetWorthPoint {
  month: string;
  totalCents: Cents;
  /** Saldo de cada compte a final de mes. */
  byAccount: Record<string, Cents>;
  /** Algun saldo és estimat (interessos o aportacions posteriors a l'última valoració). */
  estimated: boolean;
}

/**
 * Patrimoni a final de cada mes (o a `today` per al mes en curs).
 * Inclou els comptes arxivats: formen part de l'historial.
 */
export function netWorthByMonth(
  accounts: Account[],
  txs: Transaction[],
  valuations: Valuation[],
  months: string[],
  today: string,
): NetWorthPoint[] {
  const txsByAccount = new Map<string, Transaction[]>();
  for (const t of txs) {
    const list = txsByAccount.get(t.accountId);
    if (list) list.push(t);
    else txsByAccount.set(t.accountId, [t]);
  }
  return months.map((month) => {
    const end = endOfMonth(month);
    const asOf = end < today ? end : today;
    const byAccount: Record<string, Cents> = {};
    let totalCents = 0;
    let estimated = false;
    for (const a of accounts) {
      const b = accountBalance(a, txsByAccount.get(a.id) ?? [], valuations, asOf);
      byAccount[a.id] = b.cents;
      totalCents += b.cents;
      estimated ||= b.estimated && b.cents !== 0;
    }
    return { month, totalCents, byAccount, estimated };
  });
}
