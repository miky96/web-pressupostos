import { effectiveTae, estimateValue } from './interest';
import type { Cents } from './money';
import type { Account, Transaction, Valuation } from './types';

export interface AccountBalance {
  cents: Cents;
  /** true si inclou interessos o aportacions posteriors a l'última valoració. */
  estimated: boolean;
  lastValuation?: Valuation;
}

/**
 * Saldo d'un compte a `asOf` (normalment, ara: todayIso()).
 * - transactions: saldo inicial + tots els moviments (inclosos els amagats, que netegen a 0).
 * - valuations: última valoració + moviments posteriors (+ interessos estimats si hi ha TAE).
 */
export function accountBalance(
  account: Account,
  transactions: Transaction[],
  valuations: Valuation[],
  asOf: string,
): AccountBalance {
  const txs = transactions.filter((t) => t.accountId === account.id && t.date <= asOf);

  if (account.balanceMode === 'transactions') {
    const opening = account.opening?.balanceCents ?? 0;
    return { cents: opening + txs.reduce((s, t) => s + t.amountCents, 0), estimated: false };
  }

  const last = valuations
    .filter((v) => v.accountId === account.id && v.date <= asOf)
    .sort((a, b) => a.date.localeCompare(b.date))
    .at(-1);
  // Els interessos ja estan inclosos a la valoració o a l'estimació: no els sumem dues vegades.
  const flows = txs
    .filter((t) => (!last || t.date > last.date) && t.kind !== 'interest')
    .map((t) => ({ date: t.date, amountCents: t.amountCents }));
  const start = last ? { date: last.date, amountCents: last.valueCents } : undefined;

  if (account.interest && account.interest.rate > 0) {
    return {
      cents: estimateValue(start, flows, effectiveTae(account.interest), asOf),
      estimated: !last || last.date < asOf,
      lastValuation: last,
    };
  }
  const cents = (start?.amountCents ?? 0) + flows.reduce((s, f) => s + f.amountCents, 0);
  return { cents, estimated: flows.length > 0 || !last, lastValuation: last };
}

/** Evolució del saldo (una entrada per moviment) per a gràfiques. */
export function balanceSeries(account: Account, transactions: Transaction[]): { date: string; balanceCents: Cents }[] {
  let running = account.opening?.balanceCents ?? 0;
  return transactions
    .filter((t) => t.accountId === account.id)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((t) => {
      running += t.amountCents;
      return { date: t.date, balanceCents: running };
    });
}
