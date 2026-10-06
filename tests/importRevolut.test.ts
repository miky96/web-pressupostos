import { describe, expect, it } from 'vitest';
import { accountBalance } from '../src/domain/balances';
import { summarize } from '../src/domain/summary';
import type { Transaction } from '../src/domain/types';
import { importText, readFixture } from './helpers';

const csv = readFixture('revolut-sample.csv');
const NOW = '2026-09-28T12:00:00';

const byDesc = (txs: Transaction[], desc: string) => txs.filter((t) => t.description === desc);

describe('importador Revolut', () => {
  const { result, plan, accounts } = importText(csv);

  it('llegeix totes les files completades i salta les pendents i revertides', () => {
    expect(result.rows).toHaveLength(4 + 23);
    expect(result.skipped.map((s) => s.reason).sort()).toEqual(['PENDING', 'REVERTED']);
  });

  it('el saldo quadra a cada compte (cap avís)', () => {
    expect(result.issues).toEqual([]);
  });

  it('detecta un compte per producte i calcula el saldo inicial', () => {
    const current = result.accounts.find((a) => a.key === 'revolut:current:EUR')!;
    expect(current.openingBalanceCents).toBe(2433);
    expect(current.closingBalanceCents).toBe(125701);
    expect(result.accounts.find((a) => a.key === 'revolut:deposit:EUR')!.closingBalanceCents).toBe(10002);
  });

  it('importa l\'import net (import - comissió)', () => {
    const [grab] = byDesc(plan.transactions, 'Grab');
    expect(grab.amountCents).toBe(-2247);
    expect(grab.feeCents).toBe(22);
    const [fee] = byDesc(plan.transactions, 'Premium plan fee');
    expect(fee.amountCents).toBe(-499);
  });

  it('entén camps entre cometes amb comes', () => {
    expect(byDesc(plan.transactions, 'Cash withdrawal at Plaça Major, Vic')).toHaveLength(1);
  });

  it('dues files gairebé idèntiques no es fusionen', () => {
    const toSavings = byDesc(plan.transactions, 'To Savings Challenge');
    expect(toSavings).toHaveLength(4); // 2 al compte principal + 2 a la guardiola
    expect(new Set(plan.transactions.map((t) => t.id)).size).toBe(plan.transactions.length);
  });

  it('reimportar el mateix fitxer no crea duplicats', () => {
    const again = importText(csv, undefined, { accounts, ids: new Set(plan.transactions.map((t) => t.id)) });
    expect(again.plan.transactions).toHaveLength(0);
    expect(again.plan.duplicates).toBe(plan.transactions.length);
  });

  it('el saldo calculat coincideix amb el de Revolut', () => {
    const current = accounts.find((a) => a.importKey === 'revolut:current:EUR')!;
    expect(accountBalance(current, plan.transactions, [], NOW).cents).toBe(125701);
    const deposit = accounts.find((a) => a.importKey === 'revolut:deposit:EUR')!;
    expect(accountBalance(deposit, plan.transactions, [], NOW).cents).toBe(10002);
  });
});

describe('classificació per defecte', () => {
  const { plan, accounts } = importText(csv);
  const kindOf = (desc: string) => byDesc(plan.transactions, desc).map((t) => t.kind);

  it('traspassos propis no són ni ingrés ni despesa', () => {
    expect(kindOf('Top-up by *1234')).toEqual(['transfer']);
    expect(kindOf('Payment from JOAN EXEMPLE PUIG')).toEqual(['transfer']);
    expect(kindOf('To Savings Challenge')).toEqual(['transfer', 'transfer', 'transfer', 'transfer']);
  });

  it('aparella la guardiola amb el compte principal', () => {
    const legs = byDesc(plan.transactions, 'To Savings Challenge');
    const groups = new Set(legs.map((t) => t.transferGroupId));
    expect(groups.size).toBe(2);
    expect([...groups].every(Boolean)).toBe(true);
  });

  it('crea la pota de Flexible Cash Funds (el compte que l\'export no inclou)', () => {
    const fcf = accounts.find((a) => a.importKey === 'revolut:flexible-cash-funds:EUR')!;
    expect(fcf.balanceMode).toBe('valuations');
    const legs = plan.transactions.filter((t) => t.accountId === fcf.id);
    expect(legs.map((t) => t.amountCents).sort((a, b) => a - b)).toEqual([-20000, 100000]);
    expect(legs.every((t) => t.source === 'derived' && t.kind === 'transfer')).toBe(true);
  });

  it('compte conjunt = despesa compartida (opció A)', () => {
    const [out] = byDesc(plan.transactions, 'Transfer to ANNA PROVA SOLER & JOAN EXEMPLE PUIG');
    expect(out).toMatchObject({ kind: 'expense', categoryId: 'despeses-compartides' });
    const [back] = byDesc(plan.transactions, 'Transfer from ANNA PROVA SOLER & JOAN EXEMPLE PUIG');
    expect(back).toMatchObject({ kind: 'reimbursement', categoryId: 'despeses-compartides' });
  });

  it('nòmina, interessos, reemborsaments i devolucions', () => {
    expect(byDesc(plan.transactions, 'Payment from ACME GAMES SL')[0]).toMatchObject({ kind: 'income', categoryId: 'nomina' });
    expect(kindOf('Interest earned - Savings Challenge')).toEqual(['interest', 'interest']);
    expect(kindOf('Money added via BIZUM')).toEqual(['reimbursement']);
    expect(byDesc(plan.transactions, 'Amazon').map((t) => [t.kind, t.categoryId])).toEqual([
      ['expense', 'compres'],
      ['refund', 'compres'],
    ]);
  });

  it('un Bizum anul·lat s\'amaga amb la seva anul·lació; el definitiu queda', () => {
    const bizums = plan.transactions.filter((t) => t.description.includes('Pere X.'));
    expect(bizums.filter((t) => t.hidden)).toHaveLength(2);
    expect(bizums.filter((t) => !t.hidden).map((t) => t.kind)).toEqual(['expense']);
  });

  it('rebuts domiciliats (Type=Transfer) són despesa, no traspàs', () => {
    expect(byDesc(plan.transactions, 'Parlem Telecom Companyia De Telecomunicacions, S.a.')[0]).toMatchObject({
      kind: 'expense',
      categoryId: 'subministraments',
    });
  });

  it('marca per revisar el que no sap classificar', () => {
    const review = plan.transactions.filter((t) => t.needsReview).map((t) => t.description).sort();
    expect(review).toEqual(['Cbpa*someone', 'Payment from AMIC QUALSEVOL']);
  });

  it('el resum no infla ingressos amb traspassos', () => {
    const s = summarize(plan.transactions);
    expect(s.incomeCents).toBe(200000 + 999); // nòmina + CARD_CREDIT desconegut
    expect(s.interestCents).toBe(2);
    // 23.45+22.47+300+43+30+4.99+50+100+10.90 = 584.81
    expect(s.grossExpenseCents).toBe(58481);
    expect(s.refundsCents).toBe(1500);
    expect(s.reimbursementsCents).toBe(1250 + 5000 + 3000);
  });
});

describe('guardiola que ja no surt a l\'export', () => {
  const csv = [
    'Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance',
    'Transfer,Deposit,2026-09-10 11:01:37,2026-09-10 11:01:37,SavingsAccount migration [INTERNAL] -> [DEUTSCHE],-100.00,0.00,EUR,COMPLETED,0.00',
    'Transfer,Current,2026-09-14 09:48:26,2026-09-14 09:48:26,To EUR Savings Challenge,-50.00,0.00,EUR,COMPLETED,450.00',
  ].join('\n');
  const { plan, accounts } = importText(csv);

  it('crea la pota al compte d\'estalvi nou per als traspassos sense parella', () => {
    const pocket = accounts.find((a) => a.importKey === 'revolut:savings:EUR')!;
    expect(pocket).toMatchObject({ type: 'savings', balanceMode: 'valuations' });
    const legs = plan.transactions.filter((t) => t.accountId === pocket.id);
    expect(legs.map((t) => t.amountCents).sort()).toEqual([10000, 5000]);
    expect(plan.transactions.filter((t) => t.source === 'import').every((t) => t.kind === 'transfer')).toBe(true);
  });
});

describe('productes tancats', () => {
  const header = 'Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance';
  const rows = [
    'Transfer,Deposit,2026-05-01 10:00:00,2026-05-01 10:00:00,To Savings Challenge,50.00,0.00,EUR,COMPLETED,50.00',
    'Transfer,Deposit,2026-09-10 10:00:00,2026-09-10 10:00:00,SavingsAccount migration,-50.00,0.00,EUR,COMPLETED,0.00',
    'Transfer,Deposit,2026-09-10 10:00:01,2026-09-10 10:00:01,Closing transaction,0.00,0.00,EUR,COMPLETED,0.00',
    'Card Payment,Current,2026-05-02 10:00:00,2026-05-02 10:00:00,Mercadona,-10.00,0.00,EUR,COMPLETED,90.00',
  ];

  it("marca com a tancat el producte que acaba amb 'Closing transaction' i saldo 0", () => {
    const { result } = importText([header, ...rows].join('\n'));
    expect(result.accounts.find((a) => a.key === 'revolut:deposit:EUR')!.closedAt).toBe('2026-09-10T10:00:01');
    expect(result.accounts.find((a) => a.key === 'revolut:current:EUR')!.closedAt).toBeUndefined();
  });

  it('no el marca si després del tancament hi ha més moviments o el saldo no és 0', () => {
    const reopened = [...rows, 'Transfer,Deposit,2026-09-20 10:00:00,2026-09-20 10:00:00,To Savings Challenge,5.00,0.00,EUR,COMPLETED,5.00'];
    const { result } = importText([header, ...reopened].join('\n'));
    expect(result.accounts.find((a) => a.key === 'revolut:deposit:EUR')!.closedAt).toBeUndefined();
  });
});
