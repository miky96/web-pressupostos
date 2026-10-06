import { accountBalance } from './balances';
import type { Cents } from './money';
import type { Account, Transaction, Valuation } from './types';

export interface Performance {
  valueCents: Cents;
  estimated: boolean;
  /** Aportacions netes (entrades - retirades), sense comptar interessos. */
  contributedCents: Cents;
  gainCents: Cents;
  /** Guany sobre aportacions, en tant per u. */
  gainRatio: number;
}

/** Quant has guanyat en un compte d'inversió o remunerat. */
export function accountPerformance(
  account: Account,
  transactions: Transaction[],
  valuations: Valuation[],
  asOf: string,
): Performance {
  const contributed = transactions
    .filter((t) => t.accountId === account.id && t.date <= asOf && t.kind !== 'interest')
    .reduce((s, t) => s + t.amountCents, 0) + (account.balanceMode === 'transactions' ? account.opening?.balanceCents ?? 0 : 0);
  const balance = accountBalance(account, transactions, valuations, asOf);
  const gain = balance.cents - contributed;
  return {
    valueCents: balance.cents,
    estimated: balance.estimated,
    contributedCents: contributed,
    gainCents: gain,
    gainRatio: contributed > 0 ? gain / contributed : 0,
  };
}
