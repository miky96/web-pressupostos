import { describe, expect, it } from 'vitest';
import { saveDebt } from '../src/domain/debts';
import { attributeForView } from '../src/domain/recoveries';
import {
  cleanupSharedLinks,
  expandExpenses,
  linkCandidates,
  ME,
  peopleOverview,
  remapSharedRefs,
  saveExpense,
  saveSettlement,
  saveShared,
  settlementPlan,
  splitByWeights,
  summarizeShared,
} from '../src/domain/shared';
import { summarize } from '../src/domain/summary';
import type { SharedItem, Transaction } from '../src/domain/types';

let n = 0;
const newId = (p: string) => `${p}${++n}`;

const tx = (id: string, amountCents: number, extra: Partial<Transaction> = {}): Transaction => ({
  id,
  accountId: 'acc',
  date: '2026-10-01T12:00:00',
  amountCents,
  feeCents: 0,
  currency: 'EUR',
  description: id,
  kind: amountCents < 0 ? 'expense' : 'reimbursement',
  source: 'import',
  ...extra,
});

function trip(): SharedItem {
  return saveShared(
    { name: 'Viatge', kind: 'oneoff', myWeight: 1, others: [{ id: 'anna', name: 'Anna', weight: 1 }, { id: 'pau', name: 'Pau', weight: 1 }], categoryId: 'oci' },
    'sh1',
    newId,
    '2026-10-01T00:00:00',
  );
}

describe('repartiment', () => {
  it('reparteix per pesos i els cèntims sobrants són teus', () => {
    expect(splitByWeights(1000, [{ id: ME, weight: 1 }, { id: 'a', weight: 1 }, { id: 'b', weight: 1 }])).toEqual({ me: 334, a: 333, b: 333 });
    expect(splitByWeights(100000, [{ id: ME, weight: 60 }, { id: 'a', weight: 40 }])).toEqual({ me: 60000, a: 40000 });
    expect(splitByWeights(500, [{ id: ME, weight: 0 }, { id: 'a', weight: 1 }])).toEqual({ a: 500 });
  });

  it('valida la cosa compartida', () => {
    expect(() => saveShared({ name: 'X', kind: 'oneoff', myWeight: 1, others: [] }, 'x', newId, '2026-10-01')).toThrow();
    expect(() =>
      saveShared({ name: 'X', kind: 'oneoff', myWeight: 1, others: [{ name: 'Anna', weight: 1 }, { name: 'anna ', weight: 1 }] }, 'x', newId, '2026-10-01'),
    ).toThrow();
  });

  it('no deixa treure un participant amb despeses', () => {
    const item = saveExpense(trip(), { date: '2026-10-02', description: 'Taxi', totalCents: 3000, paidBy: { pau: 3000 } }, 'e1');
    expect(() =>
      saveShared({ name: 'Viatge', kind: 'oneoff', myWeight: 1, others: [{ id: 'anna', name: 'Anna', weight: 1 }] }, 'sh1', newId, '2026-10-01', item),
    ).toThrow(/Pau/);
  });
});

describe('saldos i liquidació', () => {
  it('calcula qui deu a qui amb el mínim de pagaments', () => {
    let item = trip();
    item = saveExpense(item, { date: '2026-10-02', description: 'Hotel', totalCents: 30000, paidBy: { [ME]: 30000 } }, 'e1');
    item = saveExpense(item, { date: '2026-10-03', description: 'Sopar', totalCents: 9000, paidBy: { anna: 9000 } }, 'e2');
    const s = summarizeShared(item, []);
    expect(s.totalCents).toBe(39000);
    expect(s.myShareCents).toBe(13000);
    expect(s.myNetCents).toBe(17000);
    // Anna: 9000 - 13000 = -4000; Pau: -13000.
    expect(s.plan).toEqual([
      { fromId: 'pau', toId: ME, amountCents: 13000 },
      { fromId: 'anna', toId: ME, amountCents: 4000 },
    ]);
    expect(s.withPeople).toEqual([
      { id: 'pau', name: 'Pau', cents: 13000 },
      { id: 'anna', name: 'Anna', cents: 4000 },
    ]);
  });

  it('les liquidacions redueixen el pendent fins a quadrar', () => {
    let item = trip();
    item = saveExpense(item, { date: '2026-10-02', description: 'Hotel', totalCents: 30000, paidBy: { [ME]: 30000 } }, 'e1');
    item = saveSettlement(item, { date: '2026-10-05', fromId: 'anna', toId: ME, amountCents: 10000 }, 's1');
    item = saveSettlement(item, { date: '2026-10-05', fromId: 'pau', toId: ME, amountCents: 10000 }, 's2');
    expect(summarizeShared(item, []).settled).toBe(true);
  });

  it('settlementPlan amb tres persones que es deuen entre elles', () => {
    expect(settlementPlan([{ id: ME, netCents: -500 }, { id: 'a', netCents: 800 }, { id: 'b', netCents: -300 }])).toEqual([
      { fromId: ME, toId: 'a', amountCents: 500 },
      { fromId: 'b', toId: 'a', amountCents: 300 },
    ]);
  });

  it('una despesa només entre alguns', () => {
    const item = saveExpense(trip(), { date: '2026-10-02', description: 'Museu', totalCents: 2000, paidBy: { [ME]: 2000 }, among: [ME, 'anna'] }, 'e1');
    expect(item.expenses[0].shares).toEqual({ me: 1000, anna: 1000 });
  });

  it("valida els imports i l'enllaç amb el moviment", () => {
    expect(() => saveExpense(trip(), { date: '2026-10-02', description: 'X', totalCents: 1000, paidBy: { [ME]: 900 } }, 'e1')).toThrow();
    expect(() => saveExpense(trip(), { date: '2026-10-02', description: 'X', totalCents: 1000, paidBy: { [ME]: 1000 }, txId: 't1' }, 'e1', tx('t1', -900))).toThrow();
    expect(() => saveSettlement(trip(), { date: '2026-10-02', fromId: 'anna', toId: ME, amountCents: 500, txId: 't2' }, 's1', tx('t2', -500))).toThrow();
  });
});

describe('subscripció vinculada', () => {
  it('cada cobrament compta com a despesa pagada per tu, des de la data indicada', () => {
    const item = saveShared(
      { name: 'Netflix', kind: 'ongoing', myWeight: 1, others: [{ id: 'anna', name: 'Anna', weight: 1 }], subscriptionId: 'sub1', subscriptionSince: '2026-09-01' },
      'sh2',
      newId,
      '2026-10-01',
    );
    const txs = [
      tx('n8', -1800, { subscriptionId: 'sub1', date: '2026-08-05T00:00:00' }),
      tx('n9', -1800, { subscriptionId: 'sub1', date: '2026-09-05T00:00:00' }),
      tx('n10', -1800, { subscriptionId: 'sub1', date: '2026-10-05T00:00:00' }),
    ];
    expect(expandExpenses(item, txs).map((e) => e.txId)).toEqual(['n10', 'n9']);
    expect(summarizeShared(item, txs).withPeople).toEqual([{ id: 'anna', name: 'Anna', cents: 1800 }]);
  });
});

describe('consum real', () => {
  it("només compta la teva part, el dia de la despesa, i les liquidacions no compten", () => {
    let item = trip();
    const hotel = tx('hotel', -30000, { categoryId: 'oci' });
    const bizum = tx('bizum', 10000, { date: '2026-11-02T10:00:00' });
    item = saveExpense(item, { date: hotel.date, description: 'Hotel', totalCents: 30000, paidBy: { [ME]: 30000 }, txId: 'hotel' }, 'e1', hotel);
    item = saveExpense(item, { date: '2026-10-03', description: 'Sopar', totalCents: 9000, paidBy: { anna: 9000 } }, 'e2');
    item = saveSettlement(item, { date: bizum.date, fromId: 'anna', toId: ME, amountCents: 10000, txId: 'bizum' }, 's1', bizum);
    const txs = [hotel, bizum];
    const consumption = attributeForView(txs, 'consumption', [item]);
    const oct = summarize(consumption.filter((t) => t.date < '2026-11-01'));
    expect(oct.netExpenseCents).toBe(13000);
    const nov = summarize(consumption.filter((t) => t.date >= '2026-11-01'));
    expect(nov.netExpenseCents).toBe(0);
    // A caixa, tal com al banc.
    expect(attributeForView(txs, 'cash', [item])).toBe(txs);
  });
});

describe('persones', () => {
  it('suma deutes i coses compartides per persona', () => {
    let item = trip();
    item = saveExpense(item, { date: '2026-10-02', description: 'Hotel', totalCents: 30000, paidBy: { anna: 30000 } }, 'e1');
    const debts = [saveDebt({ person: 'anna', amountCents: 5000, reason: 'Préstec', date: '2026-09-01' }, 'd1')];
    const people = peopleOverview([item], debts, []);
    const anna = people.find((p) => p.key === 'anna')!;
    expect(anna).toMatchObject({ debtCents: 5000, sharedCents: -10000, netCents: -5000 });
    expect(people.find((p) => p.key === 'pau')).toBeUndefined();
  });
});

describe('enllaços', () => {
  it('neteja, remapeja i no proposa moviments ja enllaçats', () => {
    const hotel = tx('hotel', -30000);
    let item = saveExpense(trip(), { date: hotel.date, description: 'Hotel', totalCents: 30000, paidBy: { [ME]: 30000 }, txId: 'hotel' }, 'e1', hotel);
    expect(linkCandidates([item], [hotel, tx('altre', -30000)], [], { direction: 'out', amountCents: 30000 }).map((t) => t.id)).toEqual(['altre']);
    expect(remapSharedRefs(new Map([['hotel', 'hotel2']]), [item])[0].expenses[0].txId).toBe('hotel2');
    item = cleanupSharedLinks(new Set(['hotel']), [item])[0];
    expect(item.expenses[0].txId).toBeUndefined();
  });
});
