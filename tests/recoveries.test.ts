import { describe, expect, it } from 'vitest';
import { monthlyCashflow } from '../src/domain/charts';
import { debtFromTransaction, debtLinksByTx, linkRepaymentTx, pendingCents, releaseDebtTxs, saveDebt } from '../src/domain/debts';
import {
  attributeForView,
  cleanupLinks,
  linkRecovery,
  pendingRecoveries,
  recoveriesAttributedElsewhere,
  recoveryStatus,
  setExpectedBack,
  setRecoveryClosed,
  suggestLinks,
  suggestRepaymentTxs,
  unlinkRecovery,
} from '../src/domain/recoveries';
import { netExpenseByCategory, summarize } from '../src/domain/summary';
import { editTransaction } from '../src/domain/transactions';
import type { Transaction, TransactionKind } from '../src/domain/types';

let seq = 0;
function tx(date: string, amountCents: number, kind: TransactionKind, extra: Partial<Transaction> = {}): Transaction {
  return {
    id: `t${++seq}`,
    accountId: 'acc',
    date: `${date}T12:00:00`,
    amountCents,
    feeCents: 0,
    currency: 'EUR',
    description: '',
    kind,
    source: 'import',
    ...extra,
  };
}

const inMonth = (txs: Transaction[], month: string) => txs.filter((t) => t.date.startsWith(month));

describe('devolució enllaçada a la compra', () => {
  const buy = tx('2026-09-20', -8000, 'expense', { categoryId: 'compres', description: 'Card Payment ZARA Barcelona' });
  const ret = tx('2026-10-05', 8000, 'refund', { description: 'Card Refund ZARA Barcelona' });
  const linked = linkRecovery(ret, buy, [buy, ret]);
  const txs = [buy, linked];

  it('hereta la categoria i compta al mes de la compra a la vista de consum', () => {
    expect(linked).toMatchObject({ recoversTxId: buy.id, categoryId: 'compres', userEdited: true });
    const view = attributeForView(txs, 'consumption');
    expect(summarize(inMonth(view, '2026-09')).netExpenseCents).toBe(0);
    expect(summarize(inMonth(view, '2026-10')).netExpenseCents).toBe(0);
  });

  it('a la vista de caixa tot queda com al banc', () => {
    const view = attributeForView(txs, 'cash');
    expect(summarize(inMonth(view, '2026-09')).netExpenseCents).toBe(8000);
    expect(summarize(inMonth(view, '2026-10')).netExpenseCents).toBe(-8000);
  });

  it("explica quant s'ha comptat en un altre període", () => {
    expect(recoveriesAttributedElsewhere(txs, { from: '2026-10-01', to: '2026-10-31T23:59:59' })).toBe(8000);
    expect(recoveriesAttributedElsewhere(txs, { from: '2026-09-01', to: '2026-10-31T23:59:59' })).toBe(0);
  });

  it('no deixa recuperar més del que va costar', () => {
    const extra = tx('2026-10-06', 100, 'refund');
    expect(() => linkRecovery(extra, buy, txs)).toThrow();
    expect(() => linkRecovery(buy, buy, txs)).toThrow();
  });

  it("desenllaçar torna el moviment a la seva data; canviar-ne el tipus treu l'enllaç", () => {
    expect(unlinkRecovery(linked).recoversTxId).toBeUndefined();
    expect(editTransaction(linked, { kind: 'income' }).recoversTxId).toBeUndefined();
  });

  it('si la despesa original desapareix, la recuperació compta a la seva data', () => {
    const view = attributeForView([linked], 'consumption');
    expect(view[0].date).toBe(linked.date);
    expect(cleanupLinks(new Set([buy.id]), txs, []).txs).toEqual([{ ...linked, recoversTxId: undefined }]);
  });
});

describe('sopar pagat per a altres (espero recuperar)', () => {
  const dinner = setExpectedBack(tx('2026-09-28', -12000, 'expense', { categoryId: 'restaurants', description: 'Card Payment Tapas 24' }), 9000);
  const b1 = tx('2026-09-29', 3000, 'reimbursement', { description: 'Money added via BIZUM' });
  const b2 = tx('2026-10-02', 3000, 'reimbursement', { description: 'Money added via BIZUM' });

  it('la meva part compta des del primer dia, abans de rebre cap Bizum', () => {
    const view = attributeForView([dinner], 'consumption');
    expect(summarize(view).netExpenseCents).toBe(3000);
    expect(netExpenseByCategory(view).get('restaurants')).toBe(3000);
    expect(pendingRecoveries([dinner]).map((s) => s.pendingCents)).toEqual([9000]);
  });

  it('els Bizums enllaçats rebaixen el pendent sense descomptar-se dues vegades', () => {
    const l1 = linkRecovery(b1, dinner, [dinner, b1, b2]);
    const l2 = linkRecovery(b2, dinner, [dinner, l1, b2]);
    const txs = [dinner, l1, l2];
    const view = attributeForView(txs, 'consumption');
    expect(summarize(inMonth(view, '2026-09')).netExpenseCents).toBe(3000);
    expect(summarize(inMonth(view, '2026-10')).netExpenseCents).toBe(0);
    expect(recoveryStatus(dinner, [l1, l2])).toMatchObject({ recoveredCents: 6000, pendingCents: 3000, ownCents: 3000 });
    // Si no esperes cobrar la resta, passa a ser despesa teva.
    const closed = setRecoveryClosed(dinner, true);
    expect(summarize(attributeForView([closed, l1, l2], 'consumption')).netExpenseCents).toBe(6000);
    expect(pendingRecoveries([closed, l1, l2])).toEqual([]);
  });

  it('si et tornen més del previst, compta el que realment has recuperat', () => {
    const big = tx('2026-09-30', 10000, 'reimbursement');
    const l = linkRecovery(big, dinner, [dinner, big]);
    expect(summarize(attributeForView([dinner, l], 'consumption')).netExpenseCents).toBe(2000);
  });

  it('les gràfiques fan servir la mateixa atribució', () => {
    const points = monthlyCashflow(attributeForView([dinner], 'consumption'), ['2026-09']);
    expect(points[0].expenseCents).toBe(3000);
  });

  it('valida la recuperació esperada', () => {
    expect(() => setExpectedBack(dinner, 13000)).toThrow();
    expect(() => setExpectedBack(b1, 100)).toThrow();
    expect(setExpectedBack(dinner, 0).expectedBackCents).toBeUndefined();
    expect(editTransaction(dinner, { kind: 'transfer' }).expectedBackCents).toBeUndefined();
  });
});

describe('suggeriments', () => {
  const shoes = tx('2026-09-01', -6000, 'expense', { description: 'Card Payment Decathlon Glories' });
  const food = tx('2026-09-15', -2500, 'expense', { description: 'Card Payment Mercadona' });
  const concert = setExpectedBack(tx('2026-09-20', -15000, 'expense', { description: 'Ticketmaster' }), 10000);

  it('una devolució de targeta proposa la compra del mateix comerç', () => {
    const refund = tx('2026-09-25', 6000, 'refund', { description: 'Card Refund DECATHLON GLORIES' });
    const s = suggestLinks(refund, [shoes, food, concert, refund], []);
    expect(s[0]).toMatchObject({ type: 'expense', expense: { id: shoes.id } });
    expect(s.some((x) => x.type === 'expense' && x.expense.id === food.id)).toBe(false);
  });

  it('un Bizum rebut proposa la despesa amb pendent de recuperar i els deutes oberts', () => {
    const bizum = tx('2026-09-22', 5000, 'reimbursement', { description: 'Money added via BIZUM' });
    const debt = saveDebt({ person: 'Anna', amountCents: 5000, reason: 'Taxi', date: '2026-09-10' }, 'd1');
    const s = suggestLinks(bizum, [shoes, food, concert, bizum], [debt]);
    expect(s.map((x) => (x.type === 'expense' ? x.expense.id : x.debt.id))).toEqual(expect.arrayContaining([concert.id, 'd1']));
    expect(s.some((x) => x.type === 'expense' && x.expense.id === shoes.id)).toBe(false);
  });

  it('no suggereix res per a moviments ja enllaçats o que no són entrades', () => {
    const bizum = tx('2026-09-22', 5000, 'reimbursement', { recoversTxId: concert.id });
    expect(suggestLinks(bizum, [concert, bizum], [])).toEqual([]);
    expect(suggestLinks(food, [food], [])).toEqual([]);
  });
});

describe('deutes enllaçats a Bizums', () => {
  const sent = tx('2026-09-05', -4000, 'expense', { description: 'Bizum payment to: Pere X.' });
  const back = tx('2026-09-20', 4000, 'reimbursement', { description: 'Money added via BIZUM' });

  it('un Bizum enviat es converteix en préstec i deixa de ser despesa', () => {
    const { debt, tx: loan } = debtFromTransaction(sent, { person: 'Pere', reason: 'Entrades' }, 'd1');
    expect(debt).toMatchObject({ amountCents: 4000, date: sent.date, txId: sent.id });
    expect(loan.kind).toBe('loan');
    expect(summarize([loan]).netExpenseCents).toBe(0);
    expect(() => debtFromTransaction(back, { person: 'Pere', reason: '' }, 'd2')).toThrow();
  });

  it('el Bizum rebut salda el deute i tampoc compta com a ingrés ni devolució', () => {
    const { debt } = debtFromTransaction(sent, { person: 'Pere', reason: 'Entrades' }, 'd1');
    expect(suggestRepaymentTxs(debt, [sent, back], [debt]).map((t) => t.id)).toEqual([back.id]);
    const linked = linkRepaymentTx(debt, back, 'r1');
    expect(pendingCents(linked.debt)).toBe(0);
    expect(linked.debt.repayments[0]).toMatchObject({ txId: back.id, amountCents: 4000 });
    expect(linked.tx.kind).toBe('loan');
    expect(summarize([linked.tx]).reimbursementsCents).toBe(0);
    expect(() => linkRepaymentTx(linked.debt, back, 'r2')).toThrow();
    expect(debtLinksByTx([linked.debt]).get(back.id)).toMatchObject({ role: 'repayment', repaymentId: 'r1' });
    // Editar el deute no perd l'enllaç amb el moviment d'origen.
    expect(saveDebt({ person: 'Pere', amountCents: 4000, reason: 'Concert', date: '2026-09-05' }, 'd1', linked.debt).txId).toBe(sent.id);
  });

  it("eliminar el deute torna els moviments al seu tipus", () => {
    const { debt, tx: loan } = debtFromTransaction(sent, { person: 'Pere', reason: '' }, 'd1');
    const linked = linkRepaymentTx(debt, back, 'r1');
    const released = releaseDebtTxs(linked.debt, [loan, linked.tx]);
    expect(released.map((t) => [t.id, t.kind])).toEqual([
      [sent.id, 'expense'],
      [back.id, 'reimbursement'],
    ]);
    expect(released[1].needsReview).toBe(true);
    expect(releaseDebtTxs(linked.debt, [loan, linked.tx], new Set(['r1'])).map((t) => t.id)).toEqual([back.id]);
  });

  it('si s\'elimina el moviment, el retorn es manté però sense enllaç', () => {
    const { debt } = debtFromTransaction(sent, { person: 'Pere', reason: '' }, 'd1');
    const linked = linkRepaymentTx(debt, back, 'r1');
    const { debts } = cleanupLinks(new Set([back.id, sent.id]), [], [linked.debt]);
    expect(debts[0].txId).toBeUndefined();
    expect(debts[0].repayments[0]).toMatchObject({ id: 'r1', amountCents: 4000, txId: undefined });
  });
});
