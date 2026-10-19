import { describe, expect, it } from 'vitest';
import { createAccount } from '../src/domain/accounts';
import { accountBalance, balanceAdjustment, bankBalanceCheck } from '../src/domain/balances';
import { linkRepaymentTx, pendingCents, releaseDebtTxs, summarizeDebts, syncSharedExpected } from '../src/domain/debts';
import { reconcileManual } from '../src/domain/reconcile';
import { attributeForView, pendingRecoveries, recoveriesByExpense, recoveryStatus, suggestLinks } from '../src/domain/recoveries';
import { equalSplit, splitExpense } from '../src/domain/sharedExpenses';
import { summarize } from '../src/domain/summary';
import { createManualTransaction, createManualTransfer, editManualDetails, suggestFromHistory } from '../src/domain/transactions';
import type { Transaction, TransactionKind } from '../src/domain/types';

let seq = 0;
const ids = (prefix: string) => `${prefix}_${++seq}`;
const account = createAccount({ name: 'Revolut', type: 'bank', importKey: 'revolut:current:EUR', initialBalanceCents: 10000, initialDate: '2026-01-01' }, 'acc');
const cash = createAccount({ name: 'Efectiu', type: 'cash' }, 'cash');

function tx(date: string, amountCents: number, kind: TransactionKind, extra: Partial<Transaction> = {}): Transaction {
  return { id: ids('t'), accountId: 'acc', date: `${date}T12:00:00`, amountCents, feeCents: 0, currency: 'EUR', description: '', kind, source: 'import', ...extra };
}

describe('despesa compartida (sopar + Bizums)', () => {
  const dinner = createManualTransaction({ accountId: 'acc', date: '2026-10-10', amountCents: 12000, description: 'Sopar aniversari', kind: 'expense', categoryId: 'restaurants' }, account, 'dinner');

  it('reparteix a parts iguals; els cèntims sobrants són teus', () => {
    expect(equalSplit(10000, 3)).toEqual({ eachCents: 3333, mineCents: 3334 });
  });

  it('crea un deute per persona, els Bizums cobrats i el que esperes recuperar', () => {
    const r = splitExpense(
      dinner,
      [
        { person: 'Anna', shareCents: 3000, paid: { amountCents: 3000, date: '2026-10-12' } },
        { person: 'Pau', shareCents: 3000, paid: { amountCents: 1000, date: '2026-10-13' } },
        { person: 'Joan', shareCents: 3000 },
      ],
      { newId: ids },
    );
    expect(r.expense.expectedBackCents).toBe(9000);
    expect(r.debts.map((d) => [d.person, d.reason, d.date, pendingCents(d)])).toEqual([
      ['Anna', 'Sopar aniversari', dinner.date, 0],
      ['Pau', 'Sopar aniversari', dinner.date, 2000],
      ['Joan', 'Sopar aniversari', dinner.date, 3000],
    ]);
    expect(r.reimbursements.map((t) => [t.description, t.amountCents, t.kind, t.recoversTxId, t.categoryId])).toEqual([
      ['Bizum de Anna', 3000, 'reimbursement', 'dinner', 'restaurants'],
      ['Bizum de Pau', 1000, 'reimbursement', 'dinner', 'restaurants'],
    ]);
    expect(r.debts[0].repayments[0].txId).toBe(r.reimbursements[0].id);

    const txs = [r.expense, ...r.reimbursements];
    const status = recoveryStatus(r.expense, recoveriesByExpense(txs).get('dinner'));
    expect(status).toMatchObject({ recoveredCents: 4000, pendingCents: 5000, ownCents: 3000 });
    // Consum real: el sopar et costa la teva part; el pendent és als deutes, no es compta dues vegades.
    expect(summarize(attributeForView(txs, 'consumption')).netExpenseCents).toBe(3000);
    expect(summarizeDebts(r.debts).pendingCents).toBe(5000);
    expect(pendingRecoveries(txs, r.debts)).toEqual([]);
    expect(pendingRecoveries(txs)).toHaveLength(1);
  });

  it('no deixa repartir més del que va costar', () => {
    expect(() => splitExpense(dinner, [{ person: 'A', shareCents: 13000 }], { newId: ids })).toThrow(/sumen més/);
    expect(() => splitExpense(dinner, [{ person: 'A', shareCents: 3000, paid: { amountCents: 4000, date: '2026-10-11' } }], { newId: ids })).toThrow(/més que la seva part/);
  });

  it('el Bizum que arriba després salda el deute i resta del sopar', () => {
    const r = splitExpense(dinner, [{ person: 'Joan', shareCents: 3000 }], { newId: ids });
    const bizum = tx('2026-10-15', 3000, 'income', { description: 'Money added via BIZUM' });
    const txs = [r.expense, bizum];
    // No es proposa enllaçar-lo directament a la despesa sinó al deute de la persona.
    const sugg = suggestLinks({ ...bizum, kind: 'reimbursement' }, txs, r.debts);
    expect(sugg.map((s) => s.type)).toEqual(['debt']);
    const linked = linkRepaymentTx(r.debts[0], bizum, 'rep', r.expense);
    expect(linked.tx).toMatchObject({ kind: 'reimbursement', recoversTxId: 'dinner', categoryId: 'restaurants' });
    expect(pendingCents(linked.debt)).toBe(0);
    // Treure el retorn del deute el desenllaça també de la despesa.
    const released = releaseDebtTxs(linked.debt, [r.expense, linked.tx], new Set(['rep']));
    expect(released[0].recoversTxId).toBeUndefined();
    expect(released[0].needsReview).toBe(true);
  });

  it("esborrar o canviar una part actualitza el que esperes recuperar", () => {
    const r = splitExpense(dinner, [{ person: 'A', shareCents: 3000 }, { person: 'B', shareCents: 3000 }], { newId: ids });
    expect(syncSharedExpected(r.expense, [r.debts[0]])?.expectedBackCents).toBe(3000);
    expect(syncSharedExpected(r.expense, [])?.expectedBackCents).toBeUndefined();
    expect(syncSharedExpected(r.expense, r.debts)).toBeUndefined();
  });
});

describe('moviments manuals que després arriben amb l\'extracte', () => {
  it('es fusionen: queda el del banc amb les dades i els enllaços del manual', () => {
    const dinner = createManualTransaction({ accountId: 'acc', date: '2026-10-10', amountCents: 12000, description: 'Sopar aniversari', kind: 'expense', categoryId: 'restaurants' }, account, 'm_dinner');
    const r = splitExpense(dinner, [{ person: 'Anna', shareCents: 4000, paid: { amountCents: 4000, date: '2026-10-11' } }], { newId: ids });
    const existing = [r.expense, ...r.reimbursements];
    const imported = [
      tx('2026-10-10', -12000, 'expense', { id: 'i_dinner', description: 'Card Payment LA TAVERNA', needsReview: true }),
      // El Bizum real va arribar uns dies més tard del que vas apuntar.
      tx('2026-10-17', 4000, 'reimbursement', { id: 'i_bizum', description: 'Money added via BIZUM' }),
      tx('2026-10-10', -350, 'expense', { id: 'i_coffee', description: 'Card Payment CAFE' }),
    ];
    const rec = reconcileManual(imported, existing, r.debts);
    expect(rec.replacedIds.sort()).toEqual(['m_dinner', r.reimbursements[0].id].sort());
    const byId = new Map(rec.transactions.map((t) => [t.id, t]));
    expect(byId.get('i_dinner')).toMatchObject({ description: 'Sopar aniversari', categoryId: 'restaurants', expectedBackCents: 4000, notes: 'Banc: Card Payment LA TAVERNA' });
    expect(byId.get('i_dinner')!.needsReview).toBeUndefined();
    expect(byId.get('i_bizum')).toMatchObject({ kind: 'reimbursement', recoversTxId: 'i_dinner' });
    expect(rec.updatedDebts[0]).toMatchObject({ expenseTxId: 'i_dinner', repayments: [{ txId: 'i_bizum' }] });
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
