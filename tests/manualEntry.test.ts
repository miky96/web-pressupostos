import { describe, expect, it } from 'vitest';
import { createAccount } from '../src/domain/accounts';
import { accountBalance, balanceAdjustment, bankBalanceCheck } from '../src/domain/balances';
import { reconcileManual } from '../src/domain/reconcile';
import { attributeForView, pendingRecoveries } from '../src/domain/recoveries';
import { equalSplit, linkSettlementTx, migrateDebtSplits, splitToShared, suggestSettlements, summarizeShared } from '../src/domain/shared';
import { summarize } from '../src/domain/summary';
import { createManualTransaction, createManualTransfer, editManualDetails, suggestFromHistory } from '../src/domain/transactions';
import { ME, type Debt, type Transaction, type TransactionKind } from '../src/domain/types';

let seq = 0;
const ids = (prefix: string) => `${prefix}_${++seq}`;
const account = createAccount({ name: 'Revolut', type: 'bank', importKey: 'revolut:current:EUR', initialBalanceCents: 10000, initialDate: '2026-01-01' }, 'acc');
const cash = createAccount({ name: 'Efectiu', type: 'cash' }, 'cash');

function tx(date: string, amountCents: number, kind: TransactionKind, extra: Partial<Transaction> = {}): Transaction {
  return { id: ids('t'), accountId: 'acc', date: `${date}T12:00:00`, amountCents, feeCents: 0, currency: 'EUR', description: '', kind, source: 'import', ...extra };
}

describe('despesa compartida (sopar + Bizums)', () => {
  const dinner = createManualTransaction({ accountId: 'acc', date: '2026-10-10', amountCents: 12000, description: 'Sopar aniversari', kind: 'expense', categoryId: 'restaurants' }, account, 'dinner');
  const opts = { newId: ids, createdAt: '2026-10-10T20:00:00' };

  it('reparteix a parts iguals; els cèntims sobrants són teus', () => {
    expect(equalSplit(10000, 3)).toEqual({ eachCents: 3333, mineCents: 3334 });
  });

  it('crea una cosa compartida amb la despesa, els Bizums cobrats i qui deu què', () => {
    const r = splitToShared(
      dinner,
      [
        { person: 'Anna', shareCents: 3000, paid: { amountCents: 3000, date: '2026-10-12' } },
        { person: 'Pau', shareCents: 3000, paid: { amountCents: 1000, date: '2026-10-13' } },
        { person: 'Joan', shareCents: 3000 },
      ],
      opts,
    );
    expect(r.item).toMatchObject({ name: 'Sopar aniversari', kind: 'oneoff', categoryId: 'restaurants' });
    expect(r.item.expenses).toHaveLength(1);
    expect(r.item.expenses[0]).toMatchObject({ totalCents: 12000, paidBy: { [ME]: 12000 }, txId: 'dinner' });
    expect(r.item.expenses[0].shares[ME]).toBe(3000);
    const [expense, ...bizums] = r.txs;
    expect(expense).toMatchObject({ id: 'dinner', kind: 'expense' });
    expect(expense.expectedBackCents).toBeUndefined();
    expect(bizums.map((t) => [t.description, t.amountCents, t.kind, t.recoversTxId, t.categoryId])).toEqual([
      ['Bizum de Anna', 3000, 'reimbursement', undefined, 'restaurants'],
      ['Bizum de Pau', 1000, 'reimbursement', undefined, 'restaurants'],
    ]);
    const summary = summarizeShared(r.item, r.txs);
    expect(summary.myNetCents).toBe(5000);
    expect(summary.withPeople.map((w) => [w.name, w.cents]).sort()).toEqual([
      ['Joan', 3000],
      ['Pau', 2000],
    ]);
    // Consum real: el sopar et costa la teva part; els Bizums no compten dues vegades.
    expect(summarize(attributeForView(r.txs, 'consumption', [r.item])).netExpenseCents).toBe(3000);
    expect(pendingRecoveries(r.txs)).toEqual([]);
  });

  it('no deixa repartir més del que va costar', () => {
    expect(() => splitToShared(dinner, [{ person: 'A', shareCents: 13000 }], opts)).toThrow(/sumen més/);
    expect(() => splitToShared(dinner, [{ person: 'A', shareCents: 3000, paid: { amountCents: 4000, date: '2026-10-11' } }], opts)).toThrow(/més que la seva part/);
    expect(() => splitToShared(dinner, [{ person: 'A', shareCents: 10 }, { person: 'a ', shareCents: 10 }], opts)).toThrow(/dues vegades/);
  });

  it('el Bizum que arriba després es proposa com a liquidació de qui deu', () => {
    const r = splitToShared(dinner, [{ person: 'Joan', shareCents: 3000 }], opts);
    const bizum = tx('2026-10-15', 3000, 'reimbursement', { description: 'Money added via BIZUM' });
    const txs = [...r.txs, bizum];
    const sugg = suggestSettlements(bizum, [r.item], txs);
    expect(sugg.map((s) => [s.name, s.owedCents])).toEqual([['Joan', 3000]]);
    const linked = linkSettlementTx(r.item, sugg[0].personId, bizum, 'st');
    expect(linked.tx).toMatchObject({ kind: 'reimbursement', categoryId: 'restaurants' });
    expect(summarizeShared(linked.item, [...r.txs, linked.tx]).settled).toBe(true);
    expect(suggestSettlements(linked.tx, [linked.item], [...r.txs, linked.tx])).toEqual([]);
  });
});

describe('migració de les despeses repartides de Deutes a Compartit', () => {
  const dinner = tx('2026-09-01', -9000, 'expense', { id: 'sopar', description: 'Sopar', categoryId: 'restaurants', expectedBackCents: 6000 });
  const bizumAnna = tx('2026-09-03', 3000, 'reimbursement', { id: 'bz_anna', recoversTxId: 'sopar', categoryId: 'restaurants' });
  const loanTx = tx('2026-09-05', -2000, 'loan', { id: 'prestec' });
  const debts: Debt[] = [
    { id: 'd_anna', person: 'Anna', amountCents: 3000, reason: 'Sopar', date: dinner.date, expenseTxId: 'sopar', repayments: [{ id: 'r1', date: bizumAnna.date, amountCents: 3000, txId: 'bz_anna' }] },
    { id: 'd_pau', person: 'Pau', amountCents: 3000, reason: 'Sopar', date: dinner.date, expenseTxId: 'sopar', repayments: [] },
    { id: 'd_loan', person: 'Pau', amountCents: 2000, reason: 'Préstec', date: loanTx.date, txId: 'prestec', repayments: [] },
  ];

  it('passa cada despesa repartida a una cosa compartida i deixa els préstecs', () => {
    const m = migrateDebtSplits(debts, [dinner, bizumAnna, loanTx], '2026-10-20T10:00:00');
    expect(m.deleteDebtIds.sort()).toEqual(['d_anna', 'd_pau']);
    expect(m.shared).toHaveLength(1);
    const item = m.shared[0];
    expect(item).toMatchObject({ id: 'shared_mig_sopar', name: 'Sopar', kind: 'oneoff', categoryId: 'restaurants' });
    expect(item.participants.map((p) => p.name)).toEqual(['Tu', 'Anna', 'Pau']);
    expect(item.expenses[0]).toMatchObject({ totalCents: 9000, txId: 'sopar', shares: { [ME]: 3000, p_mig_1: 3000, p_mig_2: 3000 } });
    expect(item.settlements).toEqual([expect.objectContaining({ fromId: 'p_mig_1', toId: ME, amountCents: 3000, txId: 'bz_anna' })]);
    const byId = new Map(m.txs.map((t) => [t.id, t]));
    expect(byId.get('sopar')!.expectedBackCents).toBeUndefined();
    expect(byId.get('bz_anna')!.recoversTxId).toBeUndefined();
    expect(summarizeShared(item, m.txs).withPeople.map((w) => [w.name, w.cents])).toEqual([['Pau', 3000]]);
  });

  it('el consum real no canvia', () => {
    const before = summarize(attributeForView([dinner, bizumAnna], 'consumption')).netExpenseCents;
    const m = migrateDebtSplits(debts, [dinner, bizumAnna], 'x');
    expect(before).toBe(3000);
    expect(summarize(attributeForView(m.txs, 'consumption', m.shared)).netExpenseCents).toBe(before);
  });

  it('és idempotent i no fa res si no hi ha despeses repartides', () => {
    const a = migrateDebtSplits(debts, [dinner, bizumAnna], 'x');
    const b = migrateDebtSplits(debts, [dinner, bizumAnna], 'x');
    expect(b).toEqual(a);
    expect(migrateDebtSplits([debts[2]], [loanTx], 'x')).toEqual({ shared: [], txs: [], deleteDebtIds: [] });
  });

  it('si ja no esperaves cobrar-ne més, el que faltava passa a ser part teva', () => {
    const closed = { ...dinner, recoveryClosed: true };
    const m = migrateDebtSplits(debts, [closed, bizumAnna], 'x');
    expect(m.shared[0].expenses[0].shares).toEqual({ [ME]: 6000, p_mig_1: 3000 });
    expect(summarizeShared(m.shared[0], m.txs).settled).toBe(true);
  });
});

describe('moviments manuals que després arriben amb l\'extracte', () => {
  it('es fusionen: queda el del banc amb les dades i els enllaços del manual', () => {
    const dinner = createManualTransaction({ accountId: 'acc', date: '2026-10-10', amountCents: 12000, description: 'Sopar aniversari', kind: 'expense', categoryId: 'restaurants' }, account, 'm_dinner');
    const r = splitToShared(dinner, [{ person: 'Anna', shareCents: 4000, paid: { amountCents: 4000, date: '2026-10-11' } }], { newId: ids, createdAt: '2026-10-10' });
    const existing = r.txs;
    const imported = [
      tx('2026-10-10', -12000, 'expense', { id: 'i_dinner', description: 'Card Payment LA TAVERNA', needsReview: true }),
      // El Bizum real va arribar uns dies més tard del que vas apuntar.
      tx('2026-10-17', 4000, 'reimbursement', { id: 'i_bizum', description: 'Money added via BIZUM' }),
      tx('2026-10-10', -350, 'expense', { id: 'i_coffee', description: 'Card Payment CAFE' }),
    ];
    const rec = reconcileManual(imported, existing, [], [r.item]);
    expect(rec.replacedIds.sort()).toEqual(['m_dinner', r.txs[1].id].sort());
    const byId = new Map(rec.transactions.map((t) => [t.id, t]));
    expect(byId.get('i_dinner')).toMatchObject({ description: 'Sopar aniversari', categoryId: 'restaurants', notes: 'Banc: Card Payment LA TAVERNA' });
    expect(byId.get('i_dinner')!.needsReview).toBeUndefined();
    expect(byId.get('i_bizum')).toMatchObject({ kind: 'reimbursement' });
    expect(rec.updatedShared[0].expenses[0].txId).toBe('i_dinner');
    expect(rec.updatedShared[0].settlements[0].txId).toBe('i_bizum');
    expect(byId.get('i_coffee')!.description).toBe('Card Payment CAFE');
  });

  it("no fusiona si l'import no és exacte o les dates són massa lluny", () => {
    const m = createManualTransaction({ accountId: 'acc', date: '2026-10-01', amountCents: 2000, description: 'Mercat', kind: 'expense' }, account, 'm1');
    expect(reconcileManual([tx('2026-10-01', -2001, 'expense')], [m], []).matches).toEqual([]);
    expect(reconcileManual([tx('2026-10-08', -2000, 'expense')], [m], []).matches).toEqual([]);
    expect(reconcileManual([tx('2026-10-03', -2000, 'expense')], [m], []).matches).toHaveLength(1);
  });

  it('cada moviment es fusiona amb un sol altre (el més proper)', () => {
    const a = createManualTransaction({ accountId: 'acc', date: '2026-10-01', amountCents: 150, description: 'Cafè', kind: 'expense' }, account, 'ma');
    const b = createManualTransaction({ accountId: 'acc', date: '2026-10-03', amountCents: 150, description: 'Cafè', kind: 'expense' }, account, 'mb');
    const rec = reconcileManual([tx('2026-10-03', -150, 'expense', { id: 'i1' }), tx('2026-10-01', -150, 'expense', { id: 'i2' })], [a, b], []);
    expect(rec.matches.map((m) => [m.manual.id, m.imported.id]).sort()).toEqual([
      ['ma', 'i2'],
      ['mb', 'i1'],
    ]);
  });
});

describe('corregir el saldo', () => {
  const txs = [tx('2026-10-01', -2500, 'expense'), tx('2026-10-05', 1000, 'income')];

  it("crea un ajust per la diferència al final del dia", () => {
    expect(accountBalance(account, txs, [], '2026-10-10T23:59:59').cents).toBe(8500);
    const adj = balanceAdjustment(account, txs, 8000, '2026-10-10', 'adj', 'efectiu');
    expect(adj).toMatchObject({ amountCents: -500, kind: 'adjustment', date: '2026-10-10T23:59:59', notes: 'efectiu' });
    expect(accountBalance(account, [...txs, adj!], [], '2026-10-11T00:00:00').cents).toBe(8000);
    expect(summarize([...txs, adj!]).netExpenseCents).toBe(2500); // l'ajust no és despesa
    expect(balanceAdjustment(account, txs, 8500, '2026-10-10', 'adj')).toBeNull();
  });

  it("un ajust amb hora concreta (avui, ara) es veu al saldo d'aquell moment", () => {
    const adj = balanceAdjustment(account, txs, 8000, '2026-10-10T18:30:00', 'adj');
    expect(adj?.date).toBe('2026-10-10T18:30:00');
    expect(accountBalance(account, [...txs, adj!], [], '2026-10-10T18:30:00').cents).toBe(8000);
  });

  it("detecta quan el saldo de l'extracte no quadra amb l'app", () => {
    const withBalance = [tx('2026-10-01', -2500, 'expense', { balanceAfterCents: 7500 }), tx('2026-10-05', 1000, 'income', { balanceAfterCents: 8500 })];
    expect(bankBalanceCheck(account, withBalance)).toMatchObject({ bankCents: 8500, appCents: 8500 });
    // Un moviment apuntat a mà i també importat (sense fusionar) descuadra.
    const dup = createManualTransaction({ accountId: 'acc', date: '2026-10-02', amountCents: 1200, description: 'x', kind: 'expense' }, account, 'dup');
    expect(bankBalanceCheck(account, [...withBalance, dup])).toMatchObject({ bankCents: 8500, appCents: 7300 });
  });
});

describe('editar moviments manuals', () => {
  it("corregeix import i data mantenint el signe del tipus", () => {
    const m = createManualTransaction({ accountId: 'acc', date: '2026-10-01', amountCents: 2000, description: 'Mercat', kind: 'expense' }, account, 'm');
    const [next] = editManualDetails(m, { amountCents: 2550, date: '2026-10-02', description: ' Mercat Sant Antoni ' });
    expect(next).toMatchObject({ amountCents: -2550, date: '2026-10-02T00:00:00', description: 'Mercat Sant Antoni' });
    expect(() => editManualDetails(tx('2026-10-01', -1, 'expense'), { amountCents: 2 })).toThrow();
  });

  it('en un traspàs, corregeix les dues potes', () => {
    const legs = createManualTransfer({ fromAccountId: 'acc', toAccountId: 'cash', date: '2026-10-01', amountCents: 5000, description: '' }, account, cash, ['l1', 'l2']);
    const out = editManualDetails(legs[0], { amountCents: 6000 }, legs);
    expect(out.map((t) => t.amountCents)).toEqual([-6000, 6000]);
  });

  it('proposa la categoria de la darrera vegada que vas apuntar la mateixa descripció', () => {
    const hist = [
      createManualTransaction({ accountId: 'cash', date: '2026-09-01', amountCents: 150, description: 'Cafè', kind: 'expense', categoryId: 'old' }, cash, 'h1'),
      createManualTransaction({ accountId: 'cash', date: '2026-10-01', amountCents: 160, description: 'cafe', kind: 'expense', categoryId: 'bars' }, cash, 'h2'),
    ];
    expect(suggestFromHistory(' CAFÈ ', hist)).toMatchObject({ kind: 'expense', categoryId: 'bars', accountId: 'cash' });
    expect(suggestFromHistory('Res', hist)).toBeUndefined();
  });
});
