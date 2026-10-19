import { describe, expect, it } from 'vitest';
import { planImport } from '../src/application/importService';
import { planCategoryDeletion } from '../src/domain/categories';
import {
  isPlaceholder,
  monthlyEquivalent,
  nextOccurrence,
  occurrenceDate,
  occurrencesBetween,
  planSubscriptionRun,
  reconcileImport,
  saveSubscription,
  suggestSubscriptions,
  unlinkSubscription,
} from '../src/domain/subscriptions';
import type { Subscription, Transaction } from '../src/domain/types';

const TODAY = '2026-10-19T10:00:00';

const gym = (extra: Partial<Subscription> = {}): Subscription => ({
  ...saveSubscription({ name: 'Gimnàs', amountCents: 8300, kind: 'expense', everyMonths: 1, startDate: '2026-08-01', accountId: 'caixa', categoryId: 'esport' }, 'gym'),
  ...extra,
});

let n = 0;
const tx = (date: string, amountCents: number, extra: Partial<Transaction> = {}): Transaction => ({
  id: `t${++n}`,
  accountId: 'caixa',
  date,
  amountCents,
  feeCents: 0,
  currency: 'EUR',
  description: 'x',
  kind: amountCents < 0 ? 'expense' : 'income',
  source: 'import',
  ...extra,
});

describe('calendari de cobraments', () => {
  it('cau el mateix dia cada mes i, si no existeix, l\'últim dia', () => {
    const s = { startDate: '2026-01-31T00:00:00', everyMonths: 1 };
    expect([0, 1, 2, 12].map((i) => occurrenceDate(s, i))).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2027-01-31']);
    expect(occurrenceDate({ startDate: '2026-11-15', everyMonths: 3 }, 1)).toBe('2027-02-15');
  });

  it('respecta fins on ja s\'ha generat i la data de baixa', () => {
    expect(occurrencesBetween(gym(), undefined, TODAY)).toEqual(['2026-08-01', '2026-09-01', '2026-10-01']);
    expect(occurrencesBetween(gym({ generatedThrough: '2026-09-01T00:00:00' }), '2026-09-01T00:00:00', TODAY)).toEqual(['2026-10-01']);
    expect(occurrencesBetween(gym({ endDate: '2026-09-15T00:00:00' }), undefined, TODAY)).toEqual(['2026-08-01', '2026-09-01']);
    expect(nextOccurrence(gym(), TODAY)).toBe('2026-11-01');
    expect(nextOccurrence(gym({ endDate: '2026-10-20T00:00:00' }), TODAY)).toBeUndefined();
  });

  it('valida i calcula el cost mensual equivalent', () => {
    expect(() => saveSubscription({ name: ' ', amountCents: 1, kind: 'expense', everyMonths: 1, startDate: '2026-01-01', accountId: 'a' }, 's')).toThrow();
    expect(() => saveSubscription({ name: 'x', amountCents: 0, kind: 'expense', everyMonths: 1, startDate: '2026-01-01', accountId: 'a' }, 's')).toThrow();
    expect(() => saveSubscription({ name: 'x', amountCents: 1, kind: 'expense', everyMonths: 5, startDate: '2026-01-01', accountId: 'a' }, 's')).toThrow();
    expect(monthlyEquivalent({ amountCents: 12000, everyMonths: 12 })).toBe(1000);
  });
});

describe('passada automàtica', () => {
  it('crea els cobraments vençuts en un compte que no s\'importa i avança generatedThrough', () => {
    const run = planSubscriptionRun([gym()], [], TODAY);
    expect(run.transactions.map((t) => [t.id, t.date, t.amountCents, t.categoryId])).toEqual([
      ['sub_gym_20260801', '2026-08-01T00:00:00', -8300, 'esport'],
      ['sub_gym_20260901', '2026-09-01T00:00:00', -8300, 'esport'],
      ['sub_gym_20261001', '2026-10-01T00:00:00', -8300, 'esport'],
    ]);
    expect(run.transactions.every(isPlaceholder)).toBe(true);
    expect(run.subscriptions[0].generatedThrough).toBe('2026-10-01T00:00:00');
    // Una segona passada no fa res; esborrar-ne un no el fa tornar.
    expect(planSubscriptionRun(run.subscriptions, [], TODAY).transactions).toEqual([]);
  });

  it('vincula el moviment que ja existeix (importat o apuntat a mà) en lloc de duplicar-lo', () => {
    const imported = tx('2026-09-02T08:00:00', -8300, { categoryId: 'altres', needsReview: true });
    const manual = tx('2026-08-01T00:00:00', -8300, { source: 'manual', userEdited: true, categoryId: 'mine' });
    const other = tx('2026-10-01T09:00:00', -8300, { accountId: 'revolut' });
    const run = planSubscriptionRun([gym()], [imported, manual, other], TODAY);
    expect(run.linked).toBe(2);
    expect(run.created.map((c) => c.date)).toEqual(['2026-10-01']);
    const linked = run.transactions.find((t) => t.id === imported.id)!;
    expect(linked).toMatchObject({ subscriptionId: 'gym', categoryId: 'esport' });
    expect(linked.needsReview).toBeUndefined();
    // Si l'usuari ja l'havia categoritzat, es respecta.
    expect(run.transactions.find((t) => t.id === manual.id)).toMatchObject({ subscriptionId: 'gym', categoryId: 'mine' });
  });

  it('no vincula imports massa diferents ni d\'una altra data', () => {
    const run = planSubscriptionRun([gym({ startDate: '2026-10-01T00:00:00' })], [tx('2026-10-01', -9900), tx('2026-10-10', -8300), tx('2026-10-01', 8300)], TODAY);
    expect(run.linked).toBe(0);
    expect(run.created).toHaveLength(1);
  });
});

describe('importació', () => {
  it('el moviment real substitueix el provisional, en conserva notes i aprèn la descripció del banc', () => {
    const ph = { ...planSubscriptionRun([gym()], [], TODAY).transactions[2], notes: 'pujada?' };
    const real = tx('2026-10-02T07:12:00', -8300, { description: 'ZONA FIT SL', categoryId: 'altres' });
    const rec = reconcileImport([real, tx('2026-10-02', -1250)], [ph], [gym()]);
    expect(rec.replacedIds).toEqual([ph.id]);
    expect(rec.transactions.find((t) => t.id === real.id)).toMatchObject({ subscriptionId: 'gym', categoryId: 'esport', notes: 'pujada?' });
    expect(rec.subscriptions[0].bankDescription).toBe('ZONA FIT SL');
  });

  it('un cop sap la descripció, accepta canvis de preu però no altres conceptes', () => {
    const sub = gym({ bankDescription: 'ZONA FIT SL' });
    const ph = planSubscriptionRun([sub], [], TODAY).transactions[2];
    const rec = reconcileImport([tx('2026-10-01', -8300, { description: 'ALTRA COSA' }), tx('2026-10-04', -9000, { description: 'Zona Fit SL' })], [ph], [sub]);
    expect(rec.transactions.filter((t) => t.subscriptionId).map((t) => t.amountCents)).toEqual([-9000]);
  });

  it('planImport retorna els provisionals a esborrar', () => {
    const ph = planSubscriptionRun([gym()], [], TODAY).transactions[2];
    const result = {
      importerId: 'test',
      accounts: [],
      rows: [{ externalId: 'r1', accountKey: 'k', date: '2026-10-01T09:00:00', amountCents: -8300, feeCents: 0, currency: 'EUR', description: 'ZONA FIT', bankType: 'Card Payment' }],
      skipped: [],
      issues: [],
    } as unknown as Parameters<typeof planImport>[0];
    const plan = planImport(result, { rules: [], accountIdByKey: { k: 'caixa' }, existingIds: new Set(), existingTransactions: [ph], subscriptions: [gym()] });
    expect(plan.replacedIds).toEqual([ph.id]);
    expect(plan.transactions[0].subscriptionId).toBe('gym');
  });
});

describe('suggeriments i manteniment', () => {
  it('detecta despeses mensuals amb el mateix concepte i ignora les esporàdiques', () => {
    const txs = [
      ...['2026-07-05', '2026-08-05', '2026-09-05', '2026-10-05'].map((d) => tx(d, -1299, { description: 'Netflix' })),
      ...['2026-03-10', '2026-06-10', '2026-09-10'].map((d) => tx(d, -4000, { description: 'Restaurant' })),
      ...['2026-08-01', '2026-08-15', '2026-09-01', '2026-10-01'].map((d) => tx(d, -3000, { description: 'Súper' })),
    ];
    const s = suggestSubscriptions(txs, [], TODAY);
    expect(s.map((x) => [x.name, x.months, x.firstDate])).toEqual([['Netflix', 4, '2026-07-05']]);
    expect(suggestSubscriptions(txs, [gym({ name: 'Netflix' })], TODAY)).toEqual([]);
  });

  it('esborrar la subscripció deixa els moviments; esborrar la categoria la reassigna', () => {
    const run = planSubscriptionRun([gym()], [], TODAY);
    expect(unlinkSubscription('gym', run.transactions).every((t) => !t.subscriptionId)).toBe(true);
    const plan = planCategoryDeletion('esport', 'oci', {
      transactions: [],
      rules: [],
      categories: [
        { id: 'esport', name: 'Esport', kind: 'expense' },
        { id: 'oci', name: 'Oci', kind: 'expense' },
      ],
      subscriptions: [gym()],
    });
    expect(plan.subscriptions.map((s) => s.categoryId)).toEqual(['oci']);
  });
});
