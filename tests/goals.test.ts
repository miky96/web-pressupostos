import { describe, expect, it } from 'vitest';
import { addDays } from '../src/domain/dates';
import { addContribution, goalProgress, removeContribution, saveGoal, sharedAccountIds, sortGoals } from '../src/domain/goals';
import { averageMonthlySpend, dailyAllowance, elapsedFraction, limitTone, monthLimits, saveLimit } from '../src/domain/limits';
import { planCategoryDeletion } from '../src/domain/categories';
import type { Account, Category, Transaction } from '../src/domain/types';

const NOW = '2026-10-09T12:00:00';

const account = (id: string, opening = 0): Account => ({
  id,
  name: id,
  type: 'savings',
  balanceMode: 'transactions',
  currency: 'EUR',
  opening: { date: '2026-01-01T00:00:00', balanceCents: opening },
});

let n = 0;
const tx = (accountId: string, date: string, amountCents: number, extra: Partial<Transaction> = {}): Transaction => ({
  id: `t${++n}`,
  accountId,
  date,
  amountCents,
  feeCents: 0,
  currency: 'EUR',
  description: 'x',
  kind: amountCents < 0 ? 'expense' : 'income',
  source: 'manual',
  ...extra,
});

const goal = (input: Partial<Parameters<typeof saveGoal>[0]> = {}) =>
  saveGoal({ name: 'Cotxe', targetCents: 1_000_000, accountIds: [], ...input }, 'g1', NOW);

describe('objectius d\'estalvi', () => {
  it('valida i normalitza en crear, i en editar manté aportacions i data de creació', () => {
    const g = goal({ name: '  Cotxe ', targetDate: '2027-06-30', accountIds: ['a', 'a'] });
    expect(g).toMatchObject({ name: 'Cotxe', targetDate: '2027-06-30T00:00:00', accountIds: ['a'], contributions: [], createdAt: NOW });
    expect(() => goal({ name: ' ' })).toThrow();
    expect(() => goal({ targetCents: 0 })).toThrow();
    const withC = addContribution(g, { date: '2026-10-01', amountCents: 5000 }, 'c1');
    const edited = saveGoal({ name: 'Cotxe nou', targetCents: 2_000_000, accountIds: [] }, 'g1', '2026-12-01T00:00:00', withC);
    expect(edited.contributions).toHaveLength(1);
    expect(edited.createdAt).toBe(NOW);
  });

  it('les aportacions manuals sumen, es poden treure i no poden ser 0', () => {
    let g = addContribution(goal(), { date: '2026-10-05', amountCents: 30_000 }, 'c2');
    g = addContribution(g, { date: '2026-09-01', amountCents: 50_000 }, 'c1');
    g = addContribution(g, { date: '2026-10-06', amountCents: -10_000, note: 'Imprevist' }, 'c3');
    expect(g.contributions.map((c) => c.id)).toEqual(['c1', 'c2', 'c3']);
    expect(() => addContribution(g, { date: '2026-10-06', amountCents: 0 }, 'c4')).toThrow();
    const p = goalProgress(g, { accounts: [], transactions: [], valuations: [] }, NOW);
    expect(p.savedCents).toBe(70_000);
    expect(p.manualCents).toBe(70_000);
    expect(goalProgress(removeContribution(g, 'c3'), { accounts: [], transactions: [], valuations: [] }, NOW).savedCents).toBe(80_000);
  });

  it('suma el saldo actual dels comptes vinculats i ignora els que ja no existeixen', () => {
    const data = { accounts: [account('a', 100_000), account('b', 999)], transactions: [tx('a', '2026-09-15T10:00:00', 20_000)], valuations: [] };
    const g = addContribution(goal({ accountIds: ['a', 'esborrat'] }), { date: '2026-10-01', amountCents: 5_000 }, 'c1');
    const p = goalProgress(g, data, NOW);
    expect(p).toMatchObject({ accountsCents: 120_000, manualCents: 5_000, savedCents: 125_000, remainingCents: 875_000, status: 'no-date' });
    expect(p.ratio).toBeCloseTo(0.125);
  });

  it('calcula el ritme dels últims 90 dies, la data estimada i si vas bé', () => {
    // 3 aportacions de 1.000 € els últims 3 mesos -> ~1.000 €/mes
    let g = goal({ targetCents: 1_000_000, targetDate: '2027-04-09' });
    g = addContribution(g, { date: '2026-01-01', amountCents: 400_000 }, 'c0');
    g = addContribution(g, { date: addDays(NOW, -80).slice(0, 10), amountCents: 100_000 }, 'c1');
    g = addContribution(g, { date: addDays(NOW, -50).slice(0, 10), amountCents: 100_000 }, 'c2');
    g = addContribution(g, { date: addDays(NOW, -20).slice(0, 10), amountCents: 100_000 }, 'c3');
    const empty = { accounts: [], transactions: [], valuations: [] };
    const p = goalProgress(g, empty, NOW);
    expect(p.savedCents).toBe(700_000);
    expect(p.paceMonthlyCents).toBeGreaterThan(100_000);
    expect(p.paceMonthlyCents).toBeLessThan(102_000);
    // Falten 3.000 € en 6 mesos -> cal 500 €/mes: vas bé
    expect(p.requiredMonthlyCents).toBeGreaterThan(49_000);
    expect(p.requiredMonthlyCents).toBeLessThan(51_000);
    expect(p.status).toBe('on-track');
    expect(p.etaMonth).toBe('2027-01');

    const tight = goalProgress({ ...g, targetDate: '2026-12-09T00:00:00' }, empty, NOW);
    expect(tight.status).toBe('behind');
    expect(goalProgress({ ...g, targetDate: '2026-10-01T00:00:00' }, empty, NOW).status).toBe('overdue');
    expect(goalProgress({ ...g, targetCents: 700_000 }, empty, NOW)).toMatchObject({ status: 'reached', ratio: 1, remainingCents: 0 });
  });

  it("l'últim mes no demana estalviar-ho tot en un dia", () => {
    const g = addContribution(goal({ targetCents: 100_000, targetDate: addDays(NOW, 5).slice(0, 10) }), { date: '2026-01-01', amountCents: 40_000 }, 'c');
    expect(goalProgress(g, { accounts: [], transactions: [], valuations: [] }, NOW).requiredMonthlyCents).toBe(60_000);
  });

  it('detecta comptes compartits entre objectius actius i ordena per data', () => {
    const a = saveGoal({ name: 'B', targetCents: 1, accountIds: ['x', 'y'] }, 'a', NOW);
    const b = saveGoal({ name: 'A', targetCents: 1, accountIds: ['y'], targetDate: '2027-01-01' }, 'b', NOW);
    const c = { ...saveGoal({ name: 'C', targetCents: 1, accountIds: ['x'] }, 'c', NOW), archived: true };
    expect([...sharedAccountIds([a, b, c])]).toEqual(['y']);
    expect(sortGoals([a, c, b]).map((g) => g.id)).toEqual(['b', 'a', 'c']);
  });
});

const categories: Category[] = [
  { id: 'oci', name: 'Oci', kind: 'expense' },
  { id: 'super', name: 'Supermercat', kind: 'expense' },
  { id: 'nomina', name: 'Nòmina', kind: 'income' },
];

describe('límits de despesa', () => {
  it('un límit per categoria de despesa', () => {
    expect(saveLimit({ categoryId: 'oci', monthlyCents: 20_000 }, categories)).toEqual({ id: 'limit_oci', categoryId: 'oci', monthlyCents: 20_000 });
    expect(() => saveLimit({ categoryId: 'nomina', monthlyCents: 1 }, categories)).toThrow();
    expect(() => saveLimit({ categoryId: 'oci', monthlyCents: 0 }, categories)).toThrow();
    expect(() => saveLimit({ categoryId: 'res', monthlyCents: 1 }, categories)).toThrow();
  });

  it('fracció del mes i to segons despesa i ritme', () => {
    expect(elapsedFraction('2026-10', '2026-10-15T00:00:00')).toBeCloseTo(15 / 31);
    expect(elapsedFraction('2026-09', NOW)).toBe(1);
    expect(elapsedFraction('2026-11', NOW)).toBe(0);
    expect(limitTone(10_100, 10_000, 0.5)).toBe('over');
    expect(limitTone(8_000, 10_000, 0.9)).toBe('warn');
    expect(limitTone(6_000, 10_000, 0.4)).toBe('warn'); // per sobre del ritme
    expect(limitTone(3_000, 10_000, 0.1)).toBe('ok'); // una compra gran al principi no avisa
    expect(limitTone(6_000, 10_000, 1)).toBe('ok');
  });

  it('calcula la despesa neta del mes per categoria limitada i la resta sense límit', () => {
    const txs = [
      tx('a', '2026-10-02T10:00:00', -5_000, { categoryId: 'oci' }),
      tx('a', '2026-10-03T10:00:00', -20_000, { categoryId: 'oci' }),
      tx('a', '2026-10-04T10:00:00', 2_000, { categoryId: 'oci', kind: 'refund' }),
      tx('a', '2026-10-05T10:00:00', -30_000, { categoryId: 'super' }),
      tx('a', '2026-10-05T10:00:00', -1_000),
      tx('a', '2026-10-05T10:00:00', -9_000, { categoryId: 'oci', hidden: true }),
      tx('a', '2026-09-30T10:00:00', -7_000, { categoryId: 'oci' }),
    ];
    const res = monthLimits([saveLimit({ categoryId: 'oci', monthlyCents: 20_000 }, categories)], txs, '2026-10', NOW);
    expect(res.rows[0]).toMatchObject({ spentCents: 23_000, remainingCents: -3_000, tone: 'over' });
    expect(res.unlimitedSpentCents).toBe(31_000);
    expect(res.totalLimitCents).toBe(20_000);
    expect(res.daysLeft).toBe(23);
    expect(dailyAllowance(23_000, 23)).toBe(1_000);
    expect(dailyAllowance(-1, 23)).toBe(0);
  });

  it('suggereix la mitjana dels mesos complets anteriors amb dades', () => {
    const txs = [
      tx('a', '2026-08-10T10:00:00', -10_000, { categoryId: 'oci' }),
      tx('a', '2026-09-10T10:00:00', -20_000, { categoryId: 'oci' }),
      tx('a', '2026-10-01T10:00:00', -99_000, { categoryId: 'oci' }),
    ];
    // Juliol no té dades -> mitjana d'agost i setembre
    expect(averageMonthlySpend(txs, 'oci', '2026-10')).toBe(15_000);
    expect(averageMonthlySpend([], 'oci', '2026-10')).toBe(0);
  });

  it('eliminar una categoria esborra el seu límit', () => {
    const plan = planCategoryDeletion('oci', 'super', {
      transactions: [],
      rules: [],
      categories,
      limits: [saveLimit({ categoryId: 'oci', monthlyCents: 1 }, categories), saveLimit({ categoryId: 'super', monthlyCents: 1 }, categories)],
    });
    expect(plan.limitsToDelete).toEqual(['limit_oci']);
  });
});
