import { describe, expect, it } from 'vitest';
import {
  categoryBreakdown,
  categoryTrend,
  endOfMonth,
  monthlyCashflow,
  monthsBetween,
  monthsForRange,
  netWorthByMonth,
  OTHER,
} from '../src/domain/charts';
import { UNCATEGORIZED } from '../src/domain/summary';
import type { Account, Transaction, TransactionKind, Valuation } from '../src/domain/types';

let seq = 0;
function tx(date: string, amountCents: number, kind: TransactionKind, categoryId?: string, extra: Partial<Transaction> = {}): Transaction {
  return {
    id: `t${++seq}`,
    accountId: 'acc',
    date,
    amountCents,
    feeCents: 0,
    currency: 'EUR',
    description: '',
    kind,
    categoryId,
    source: 'manual',
    ...extra,
  };
}

describe('mesos', () => {
  it('llista mesos travessant anys', () => {
    expect(monthsBetween('2025-11', '2026-02')).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
    expect(monthsBetween('2026-03', '2026-02')).toEqual([]);
  });

  it('els extrems oberts del rang venen dels moviments visibles', () => {
    const txs = [tx('2026-01-10T00:00:00', -100, 'expense'), tx('2026-03-02T00:00:00', -100, 'expense'), tx('2026-09-01T00:00:00', -1, 'expense', undefined, { hidden: true })];
    expect(monthsForRange(txs, {})).toEqual(['2026-01', '2026-02', '2026-03']);
    expect(monthsForRange(txs, { from: '2026-02-01T00:00:00' })).toEqual(['2026-02', '2026-03']);
    expect(monthsForRange([], {})).toEqual([]);
  });

  it('final de mes té en compte els anys de traspàs', () => {
    expect(endOfMonth('2024-02')).toBe('2024-02-29T23:59:59');
    expect(endOfMonth('2026-02')).toBe('2026-02-28T23:59:59');
    expect(endOfMonth('2026-12')).toBe('2026-12-31T23:59:59');
  });
});

describe('flux mensual', () => {
  it('omple mesos buits i ignora traspassos', () => {
    const txs = [
      tx('2026-01-28T00:00:00', 200000, 'income'),
      tx('2026-01-05T00:00:00', -50000, 'expense', 'supermercat'),
      tx('2026-01-06T00:00:00', 10000, 'reimbursement', 'supermercat'),
      tx('2026-01-07T00:00:00', -90000, 'transfer'),
      tx('2026-03-01T00:00:00', 500, 'interest'),
    ];
    const [jan, feb, mar] = monthlyCashflow(txs, ['2026-01', '2026-02', '2026-03']);
    expect(jan).toMatchObject({ incomeCents: 200000, expenseCents: 40000, savingsCents: 160000, savingsRate: 0.8 });
    expect(feb).toMatchObject({ incomeCents: 0, expenseCents: 0, savingsRate: null });
    expect(mar.incomeCents).toBe(500);
  });
});

describe('despesa per categoria', () => {
  const months = ['2026-01', '2026-02'];
  const cats = ['a', 'b', 'c', 'd'];
  const txs = [
    ...cats.map((c, i) => tx('2026-01-10T00:00:00', -(i + 1) * 1000, 'expense', c)), // a=10, b=20, c=30, d=40
    tx('2026-02-10T00:00:00', -500, 'expense'),
    tx('2026-02-11T00:00:00', 3000, 'refund', 'a'), // devolució més gran que la despesa del mes
  ];

  it('agrupa les petites a Altres i ordena per total', () => {
    const r = categoryBreakdown(txs, months, 2);
    expect(r.keys).toEqual(['d', 'c', OTHER]);
    // Altres = b (20) + sense categoria (5); "a" té total negatiu i no surt.
    expect(r.totals.get(OTHER)).toBe(2500);
    expect(r.rows[0].values).toEqual({ d: 4000, c: 3000, [OTHER]: 3000 }); // a(10)+b(20) a gener
    expect(r.rows[1].values[OTHER]).toBe(0); // 5 - 30 de devolució: no es mostra negatiu
  });

  it('no crea Altres per una sola categoria sobrant', () => {
    const r = categoryBreakdown(txs.slice(0, 3), months, 2);
    expect(r.keys).toEqual(['c', 'b', 'a']);
  });
});

describe('tendència de categoria', () => {
  it('despesa neta per mes amb mitjana', () => {
    const txs = [tx('2026-01-10T00:00:00', -3000, 'expense', 'oci'), tx('2026-03-10T00:00:00', -6000, 'expense', 'oci'), tx('2026-03-11T00:00:00', 1000, 'refund', 'oci')];
    const r = categoryTrend(txs, ['2026-01', '2026-02', '2026-03'], 'oci', 'expense');
    expect(r.points.map((p) => p.cents)).toEqual([3000, 0, 5000]);
    expect(r.averageCents).toBe(2667);
  });

  it('ingressos per categoria i despesa sense categoria', () => {
    const txs = [tx('2026-01-28T00:00:00', 200000, 'income', 'nomina'), tx('2026-01-02T00:00:00', -700, 'expense')];
    expect(categoryTrend(txs, ['2026-01'], 'nomina', 'income').points[0].cents).toBe(200000);
    expect(categoryTrend(txs, ['2026-01'], UNCATEGORIZED, 'expense').points[0].cents).toBe(700);
  });
});

describe('patrimoni', () => {
  const bank: Account = { id: 'acc', name: 'Banc', type: 'bank', balanceMode: 'transactions', currency: 'EUR', opening: { date: '2026-01-01T00:00:00', balanceCents: 100000 } };
  const fund: Account = { id: 'fund', name: 'Fons', type: 'investment', balanceMode: 'valuations', currency: 'EUR' };
  const valuations: Valuation[] = [{ id: 'v1', accountId: 'fund', date: '2026-02-15T00:00:00', valueCents: 500000 }];

  it('saldo a final de cada mes, fins avui per al mes en curs', () => {
    const txs = [
      tx('2026-01-10T00:00:00', -20000, 'expense'),
      tx('2026-02-03T00:00:00', 300000, 'income'),
      tx('2026-03-20T00:00:00', -1000, 'expense'), // posterior a "avui"
    ];
    const r = netWorthByMonth([bank, fund], txs, valuations, ['2026-01', '2026-02', '2026-03'], '2026-03-15T12:00:00');
    expect(r.map((p) => p.byAccount.acc)).toEqual([80000, 380000, 380000]);
    expect(r.map((p) => p.byAccount.fund)).toEqual([0, 500000, 500000]);
    expect(r[1].totalCents).toBe(880000);
    expect(r[1].estimated).toBe(false);
  });
});
