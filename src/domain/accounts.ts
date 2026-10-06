import type { Cents } from './money';
import type { Account, AccountType, BalanceMode, InterestTerms } from './types';

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  bank: 'Compte bancari',
  savings: 'Compte remunerat / fons monetari',
  investment: 'Inversió (borsa, fons...)',
  cash: 'Efectiu',
};

/** Per defecte: bancs i efectiu sumen moviments; inversions es valoren a mà. */
export function defaultBalanceMode(type: AccountType): BalanceMode {
  return type === 'investment' ? 'valuations' : 'transactions';
}

export interface NewAccountInput {
  name: string;
  type: AccountType;
  currency?: string;
  balanceMode?: BalanceMode;
  institution?: string;
  importKey?: string;
  interest?: InterestTerms;
  /** Saldo inicial per a comptes manuals (efectiu, etc.). */
  initialBalanceCents?: Cents;
  initialDate?: string;
}

export function createAccount(input: NewAccountInput, id: string): Account {
  if (!input.name.trim()) throw new Error('Cal un nom per al compte');
  const account: Account = {
    id,
    name: input.name.trim(),
    type: input.type,
    balanceMode: input.balanceMode ?? defaultBalanceMode(input.type),
    currency: input.currency ?? 'EUR',
    institution: input.institution,
    importKey: input.importKey,
    interest: input.interest,
  };
  if (input.initialBalanceCents !== undefined && input.initialDate) {
    account.opening = { date: input.initialDate, balanceCents: input.initialBalanceCents };
  }
  return account;
}

/**
 * El banc ha tancat el producte: s'arxiva el compte. Només la primera vegada que es detecta
 * aquest tancament; si després el desarxives, reimportar el mateix fitxer no el torna a arxivar.
 */
export function applyClosure(account: Account, closedAt: string | undefined): Account {
  if (!closedAt || account.closedAt === closedAt) return account;
  return { ...account, closedAt, archived: true };
}

/** Si una importació conté moviments més antics, el saldo inicial passa a ser el d'aquella data. */
export function mergeOpening(account: Account, opening: { date: string; balanceCents: Cents }): Account {
  if (!account.opening || opening.date < account.opening.date) return { ...account, opening };
  return account;
}
