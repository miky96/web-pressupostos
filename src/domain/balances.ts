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

/**
 * Moviment d'ajust perquè el saldo d'un compte (mode 'transactions') sigui `targetCents` al final
 * del dia `day` (YYYY-MM-DD) o en un moment concret (ISO amb hora). No és ni ingrés ni despesa.
 * null si ja quadra.
 */
export function balanceAdjustment(
  account: Account,
  transactions: Transaction[],
  targetCents: Cents,
  day: string,
  id: string,
  note?: string,
): Transaction | null {
  if (account.balanceMode !== 'transactions') throw new Error('Aquest compte es valora a mà: afegeix una valoració');
  const asOf = day.length > 10 ? day : `${day}T23:59:59`;
  const current = accountBalance(account, transactions, [], asOf).cents;
  const diff = targetCents - current;
  if (diff === 0) return null;
  return {
    id,
    accountId: account.id,
    date: asOf,
    amountCents: diff,
    feeCents: 0,
    currency: account.currency,
    description: 'Ajust de saldo',
    kind: 'adjustment',
    notes: note?.trim() || undefined,
    source: 'manual',
    userEdited: true,
  };
}

export interface BankBalanceCheck {
  date: string;
  /** Saldo segons l'extracte (columna de saldo de l'últim moviment importat). */
  bankCents: Cents;
  /** Saldo que calcula l'app en aquell moment. */
  appCents: Cents;
}

/**
 * Compara el saldo de l'últim moviment importat amb el que calcula l'app en aquell moment. Si no
 * quadren, hi ha un moviment duplicat, perdut o mal apuntat. undefined si no es pot comprovar
 * (sense saldos al fitxer o diversos moviments al mateix segon).
 */
export function bankBalanceCheck(account: Account, transactions: Transaction[]): BankBalanceCheck | undefined {
  if (account.balanceMode !== 'transactions') return undefined;
  const own = transactions.filter((t) => t.accountId === account.id);
  const last = own
    .filter((t) => t.source === 'import' && t.balanceAfterCents !== undefined)
    .sort((a, b) => a.date.localeCompare(b.date))
    .at(-1);
  if (!last || own.some((t) => t !== last && t.date === last.date)) return undefined;
  return { date: last.date, bankCents: last.balanceAfterCents!, appCents: accountBalance(account, own, [], last.date).cents };
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
