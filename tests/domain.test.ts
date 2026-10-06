import { describe, expect, it } from 'vitest';
import { applyClosure, createAccount } from '../src/domain/accounts';
import { accountBalance } from '../src/domain/balances';
import { classify, type Rule } from '../src/domain/classification';
import {
  averageDailyBalance,
  effectiveTae,
  estimateValue,
  monthsToReach,
  observedAnnualRate,
  project,
  tinToTae,
} from '../src/domain/interest';
import { accountPerformance } from '../src/domain/investments';
import { parseDecimalToCents, parseUserAmount } from '../src/domain/money';
import { netExpenseByCategory, summarize } from '../src/domain/summary';
import { bulkEditTransactions, createManualTransaction, createManualTransfer, editTransaction } from '../src/domain/transactions';
import { parseCsv } from '../src/importers/csv';

describe('money', () => {
  it('converteix a cèntims sense errors de coma flotant', () => {
    expect(parseDecimalToCents('3084.08')).toBe(308408);
    expect(parseDecimalToCents('-0.01')).toBe(-1);
    expect(parseDecimalToCents('-0.00')).toBe(0);
    expect(parseDecimalToCents('12.5')).toBe(1250);
    expect(parseUserAmount('12,50')).toBe(1250);
    expect(() => parseDecimalToCents('abc')).toThrow();
  });
});

describe('csv', () => {
  it('suporta cometes, cometes escapades, BOM i CRLF', () => {
    const text = '﻿a,b\r\n"x, y","di ""hola"""\r\n\r\n';
    expect(parseCsv(text)).toEqual([
      ['a', 'b'],
      ['x, y', 'di "hola"'],
    ]);
  });
});

describe('regles', () => {
  const rules: Rule[] = [
    { id: 'cat', name: 'super', priority: 100, when: { descriptionMatches: 'mercadona' }, then: { categoryId: 'supermercat' } },
    { id: 'card', name: 'targeta', priority: 10, when: { bankTypes: ['Card Payment'], direction: 'out' }, then: { kind: 'expense' } },
    { id: 'off', name: 'desactivada', priority: 1, when: {}, then: { kind: 'income' }, enabled: false },
  ];

  it('combina tipus i categoria de regles diferents per prioritat', () => {
    const c = classify({ description: 'MERCADONA 123', amountCents: -1000, bankType: 'Card Payment' }, rules);
    expect(c).toMatchObject({ kind: 'expense', categoryId: 'supermercat', needsReview: false });
    expect(c.matchedRuleIds).toEqual(['card', 'cat']);
  });

  it('sense regla de tipus: dedueix pel signe i marca per revisar', () => {
    expect(classify({ description: '???', amountCents: 500 }, rules)).toMatchObject({ kind: 'income', needsReview: true });
  });

  it('una regla amb una expressió regular invàlida no peta', () => {
    const bad: Rule = { id: 'x', name: 'x', priority: 1, when: { descriptionMatches: '([' }, then: { kind: 'income' } };
    expect(classify({ description: 'a', amountCents: -1 }, [bad]).kind).toBe('expense');
  });
});

describe('moviments manuals (efectiu, comptes sense export)', () => {
  const cash = createAccount({ name: 'Efectiu', type: 'cash', initialBalanceCents: 5000, initialDate: '2026-01-01T00:00:00' }, 'cash');
  const bank = createAccount({ name: 'Banc', type: 'bank' }, 'bank');

  it('el signe el decideix el tipus', () => {
    const exp = createManualTransaction({ accountId: 'cash', date: '2026-02-01', amountCents: 1200, description: 'Mercat', kind: 'expense' }, cash, 'm1');
    const inc = createManualTransaction({ accountId: 'cash', date: '2026-02-02', amountCents: 3000, description: 'Cobrament en mà', kind: 'income' }, cash, 'm2');
    expect(exp.amountCents).toBe(-1200);
    expect(exp.date).toBe('2026-02-01T00:00:00');
    expect(inc.amountCents).toBe(3000);
    expect(accountBalance(cash, [exp, inc], [], '2026-12-31T00:00:00').cents).toBe(5000 - 1200 + 3000);
  });

  it('un traspàs manual genera dues potes enllaçades que no compten al resum', () => {
    const [a, b] = createManualTransfer({ fromAccountId: 'bank', toAccountId: 'cash', date: '2026-03-01', amountCents: 2000, description: '' }, bank, cash, ['t1', 't2']);
    expect([a.amountCents, b.amountCents]).toEqual([-2000, 2000]);
    expect(a.transferGroupId).toBe(b.transferGroupId);
    expect(summarize([a, b]).savingsCents).toBe(0);
  });

  it('editar protegeix el moviment de reaplicar regles', () => {
    const exp = createManualTransaction({ accountId: 'cash', date: '2026-02-01', amountCents: 1200, description: 'x', kind: 'expense' }, cash, 'm1');
    const edited = editTransaction({ ...exp, userEdited: false, needsReview: true }, { categoryId: 'oci', notes: 'sopar' });
    expect(edited).toMatchObject({ categoryId: 'oci', notes: 'sopar', userEdited: true, needsReview: false });
  });
});

describe('interessos i previsions', () => {
  it('TIN -> TAE', () => {
    expect(tinToTae(0.03, 'monthly')).toBeCloseTo(0.030416, 5);
    expect(effectiveTae({ rate: 0.025, rateType: 'TAE', compounding: 'daily' })).toBe(0.025);
  });

  it('estima el valor d\'un fons amb interès diari', () => {
    // 1000 € durant 365 dies al 2,5 % TAE = 1025 €
    expect(estimateValue(undefined, [{ date: '2025-01-01T00:00:00', amountCents: 100000 }], 0.025, '2026-01-01T00:00:00')).toBe(102500);
  });

  it('previsió amb aportacions mensuals i temps per arribar a un objectiu', () => {
    const points = project({ initialCents: 0, monthlyContributionCents: 10000, tae: 0, months: 12 });
    expect(points.at(-1)!.balanceCents).toBe(120000);
    const withInterest = project({ initialCents: 100000, monthlyContributionCents: 0, tae: 0.03, months: 24 });
    expect(withInterest.at(-1)!.balanceCents).toBe(106090);
    expect(monthsToReach(120000, { initialCents: 0, monthlyContributionCents: 10000, tae: 0 })).toBe(12);
    expect(monthsToReach(1, { initialCents: 0, monthlyContributionCents: 0, tae: 0 }, 24)).toBeNull();
  });

  it('rendiment real observat a partir dels interessos cobrats', () => {
    const avg = averageDailyBalance(
      [
        { date: '2026-01-01T00:00:00', balanceCents: 100000 },
        { date: '2026-01-11T00:00:00', balanceCents: 200000 },
      ],
      '2026-01-01T00:00:00',
      '2026-01-21T00:00:00',
    );
    expect(avg).toBe(150000);
    expect(observedAnnualRate(0, 150000, 20)).toBe(0);
    expect(observedAnnualRate(1000, 100000, 365)).toBeCloseTo(0.01, 6);
  });
});

describe('comptes valorats a mà (Flexible Cash Funds, borsa)', () => {
  const fund = createAccount({ name: 'Fons', type: 'savings', balanceMode: 'valuations', interest: { rate: 0.025, rateType: 'TAE', compounding: 'daily' } }, 'fund');
  const broker = createAccount({ name: 'Broker', type: 'investment' }, 'broker');
  const flow = (id: string, accountId: string, date: string, amountCents: number) =>
    ({ id, accountId, date, amountCents, feeCents: 0, currency: 'EUR', description: 'aportació', kind: 'transfer', source: 'derived' }) as const;

  it('fons: última valoració + aportacions posteriors + interès estimat', () => {
    const txs = [flow('a', 'fund', '2025-01-01T00:00:00', 100000), flow('b', 'fund', '2026-01-01T00:00:00', 50000)];
    const vals = [{ id: 'v', accountId: 'fund', date: '2025-07-01T00:00:00', valueCents: 101500 }];
    const b = accountBalance(fund, txs, vals, '2026-01-01T00:00:00');
    expect(b.estimated).toBe(true);
    // 1015 € creixen 184 dies al 2,5 % + 500 € d'avui
    expect(b.cents).toBe(Math.round(101500 * 1.025 ** (184 / 365)) + 50000);
  });

  it('broker sense TAE: el valor és l\'última valoració; guany = valor - aportacions', () => {
    const txs = [flow('a', 'broker', '2025-01-01T00:00:00', 500000)];
    const vals = [{ id: 'v', accountId: 'broker', date: '2026-06-01T00:00:00', valueCents: 560000 }];
    const p = accountPerformance(broker, txs, vals, '2026-09-01T00:00:00');
    expect(p).toMatchObject({ valueCents: 560000, contributedCents: 500000, gainCents: 60000, estimated: false });
    expect(p.gainRatio).toBeCloseTo(0.12);
  });
});

describe('resums', () => {
  const t = (kind: string, amountCents: number, categoryId?: string, hidden?: boolean) =>
    ({ id: Math.random().toString(), accountId: 'a', date: '2026-01-01T00:00:00', amountCents, feeCents: 0, currency: 'EUR', description: '', kind, categoryId, source: 'manual', hidden }) as never;

  it('les devolucions i reemborsaments resten de la despesa de la seva categoria', () => {
    const txs = [t('expense', -6000, 'restaurants'), t('reimbursement', 4000, 'restaurants'), t('expense', -1000, 'oci', true)];
    expect(netExpenseByCategory(txs).get('restaurants')).toBe(2000);
    expect(netExpenseByCategory(txs).has('oci')).toBe(false);
    expect(summarize(txs).netExpenseCents).toBe(2000);
  });
});

describe('applyClosure', () => {
  const acc = createAccount({ name: 'Revolut Estalvi', type: 'savings' }, 'acc1');

  it('arxiva el compte el primer cop que es detecta el tancament', () => {
    expect(applyClosure(acc, '2026-09-10T10:00:01')).toMatchObject({ archived: true, closedAt: '2026-09-10T10:00:01' });
    expect(applyClosure(acc, undefined)).toBe(acc);
  });

  it("si l'usuari el desarxiva, reimportar el mateix tancament no el torna a arxivar", () => {
    const unarchived = { ...applyClosure(acc, '2026-09-10T10:00:01'), archived: false };
    expect(applyClosure(unarchived, '2026-09-10T10:00:01')).toBe(unarchived);
    expect(applyClosure(unarchived, '2027-01-01T00:00:00').archived).toBe(true);
  });
});

describe('bulkEditTransactions', () => {
  const base = (id: string, extra: Partial<import('../src/domain/types').Transaction> = {}) => ({
    id,
    accountId: 'a',
    date: '2026-09-01T10:00:00',
    amountCents: 2000,
    feeCents: 0,
    currency: 'EUR',
    description: 'Payment from Anna',
    kind: 'reimbursement' as const,
    source: 'import' as const,
    needsReview: true,
    ...extra,
  });

  it('un patch buit només els marca com a revisats', () => {
    const [t] = bulkEditTransactions([base('1', { categoryId: 'restaurants' })], {});
    expect(t).toMatchObject({ needsReview: false, userEdited: true, kind: 'reimbursement', categoryId: 'restaurants' });
  });

  it('aplica tipus i categoria, i null treu la categoria', () => {
    const out = bulkEditTransactions([base('1'), base('2', { categoryId: 'oci' })], { kind: 'income', categoryId: 'altres-ingressos' });
    expect(out.map((t) => [t.kind, t.categoryId])).toEqual([
      ['income', 'altres-ingressos'],
      ['income', 'altres-ingressos'],
    ]);
    expect(bulkEditTransactions([base('3', { categoryId: 'oci' })], { categoryId: null })[0].categoryId).toBeUndefined();
  });

  it('els traspassos no porten categoria', () => {
    expect(bulkEditTransactions([base('1', { categoryId: 'oci' })], { kind: 'transfer', categoryId: 'oci' })[0].categoryId).toBeUndefined();
  });

  it('notes: substituir, afegir i esborrar', () => {
    const t = base('1', { notes: 'sopar' });
    expect(bulkEditTransactions([t], { notes: 'viatge' })[0].notes).toBe('viatge');
    expect(bulkEditTransactions([t], { notes: 'viatge', appendNotes: true })[0].notes).toBe('sopar · viatge');
    expect(bulkEditTransactions([base('2')], { notes: 'viatge', appendNotes: true })[0].notes).toBe('viatge');
    expect(bulkEditTransactions([t], { notes: null })[0].notes).toBeUndefined();
  });
});
