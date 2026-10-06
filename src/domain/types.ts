import type { Cents } from './money';

/**
 * bank:       compte corrent (saldo = saldo inicial + moviments)
 * savings:    compte remunerat / fons monetari (p.ex. Flexible Cash Funds)
 * investment: borsa, fons, broker (valor = valoracions manuals)
 * cash:       efectiu, cobraments que no passen pel banc
 */
export type AccountType = 'bank' | 'savings' | 'investment' | 'cash';

/**
 * transactions: el saldo es calcula sumant moviments (bancs, efectiu).
 * valuations:   el saldo és l'última valoració manual + aportacions posteriors
 *               (+ interessos estimats si hi ha TAE). Per a comptes que els
 *               exports no cobreixen (Flexible Cash Funds, broker...).
 */
export type BalanceMode = 'transactions' | 'valuations';

export type Compounding = 'daily' | 'monthly' | 'quarterly' | 'annual';

export interface InterestTerms {
  /** En tant per u: 0.025 = 2,5 % */
  rate: number;
  rateType: 'TAE' | 'TIN';
  compounding: Compounding;
}

export interface Account {
  id: string;
  name: string;
  type: AccountType;
  balanceMode: BalanceMode;
  currency: string;
  institution?: string;
  /** Clau per vincular files importades a aquest compte, p.ex. "revolut:current:EUR". */
  importKey?: string;
  /** Saldo just abans del primer moviment importat (el calcula l'importador). */
  opening?: { date: string; balanceCents: Cents };
  interest?: InterestTerms;
  notes?: string;
  archived?: boolean;
}

export type TransactionKind =
  | 'expense' // despesa
  | 'income' // ingrés (nòmina, factures...)
  | 'transfer' // moviment entre comptes propis: no compta com a ingrés ni despesa
  | 'interest' // interessos / rendiments
  | 'refund' // devolució d'una compra: resta de la despesa
  | 'reimbursement' // algú et torna diners (Bizum d'amics): resta de la despesa
  | 'adjustment'; // ajust de saldo

export const TRANSACTION_KINDS: TransactionKind[] = [
  'expense',
  'income',
  'transfer',
  'interest',
  'refund',
  'reimbursement',
  'adjustment',
];

export type TransactionSource = 'import' | 'manual' | 'derived';

export interface Transaction {
  id: string;
  accountId: string;
  /** Data local ISO sense zona: "2026-05-15T19:17:09" */
  date: string;
  /** Import net amb signe (ja descomptada la comissió). Negatiu = surt diners. */
  amountCents: Cents;
  feeCents: Cents;
  currency: string;
  description: string;
  kind: TransactionKind;
  categoryId?: string;
  notes?: string;
  source: TransactionSource;
  /** Tipus original del banc (Card Payment, Transfer...). Serveix per reaplicar regles. */
  bankType?: string;
  balanceAfterCents?: Cents;
  /** Enllaça les dues potes d'un traspàs o una operació i la seva anul·lació. */
  transferGroupId?: string;
  /** Amagat a llistats i gràfiques (p.ex. Bizum anul·lat). Continua comptant per al saldo. */
  hidden?: boolean;
  /** Cap regla l'ha pogut classificar amb seguretat. */
  needsReview?: boolean;
  /** L'usuari l'ha editat: reaplicar regles no el tocarà. */
  userEdited?: boolean;
}

export interface Category {
  id: string;
  name: string;
  kind: 'expense' | 'income';
  color?: string;
  parentId?: string;
}

/** Valor d'un compte en una data (per a comptes en mode 'valuations'). */
export interface Valuation {
  id: string;
  accountId: string;
  date: string;
  valueCents: Cents;
  note?: string;
}

export interface BudgetSettings {
  /** Nom tal com surt als exports ("MIQUEL FREIXES FAYA"). Permet detectar traspassos propis. */
  ownerName: string;
  /** Text que identifica la nòmina a la descripció (p.ex. "MULTIPLAYER GAMES GROUP"). */
  employerPattern: string;
}
