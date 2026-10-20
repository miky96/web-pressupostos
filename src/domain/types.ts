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
  /** Data en què el banc va tancar el producte (ve de la importació). */
  closedAt?: string;
}

export type TransactionKind =
  | 'expense' // despesa
  | 'income' // ingrés (nòmina, factures...)
  | 'transfer' // moviment entre comptes propis: no compta com a ingrés ni despesa
  | 'interest' // interessos / rendiments
  | 'refund' // devolució d'una compra: resta de la despesa
  | 'reimbursement' // algú et torna diners (Bizum d'amics): resta de la despesa
  | 'loan' // diners que deixes o que et retornen d'un préstec (lligat a un deute): no és ni ingrés ni despesa
  | 'adjustment'; // ajust de saldo

export const TRANSACTION_KINDS: TransactionKind[] = [
  'expense',
  'income',
  'transfer',
  'interest',
  'refund',
  'reimbursement',
  'loan',
  'adjustment',
];

/** Tipus que no compten ni com a ingrés ni com a despesa i no porten categoria. */
export const NEUTRAL_KINDS: readonly TransactionKind[] = ['transfer', 'loan', 'adjustment'];
export const isNeutralKind = (k: TransactionKind) => NEUTRAL_KINDS.includes(k);

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
  /**
   * Només en devolucions i reemborsaments: la despesa original que recupera. A la vista de
   * consum compta a la data i la categoria d'aquella despesa.
   */
  recoversTxId?: string;
  /** Només en despeses: quant esperes recuperar-ne (p.ex. la part dels altres d'un sopar). */
  expectedBackCents?: Cents;
  /** Despesa amb recuperació esperada que ja no esperes cobrar més: el que falti és despesa teva. */
  recoveryClosed?: boolean;
  /** Cobrament d'una subscripció (creat per l'app o reconegut entre els importats). */
  subscriptionId?: string;
}

export interface Category {
  id: string;
  name: string;
  kind: 'expense' | 'income';
  color?: string;
  parentId?: string;
}

/** Retorn (total o parcial) d'un deute. */
export interface DebtRepayment {
  id: string;
  date: string;
  amountCents: Cents;
  note?: string;
  /** Moviment real del retorn (p.ex. el Bizum rebut). */
  txId?: string;
}

/** Diners que has deixat a algú. El pendent es calcula: import - retorns. */
export interface Debt {
  id: string;
  person: string;
  amountCents: Cents;
  reason: string;
  /** Dia en què li vas deixar els diners (ISO local). */
  date: string;
  repayments: DebtRepayment[];
  notes?: string;
  /** Moviment amb què vas deixar els diners (p.ex. el Bizum enviat). */
  txId?: string;
  /**
   * @deprecated Format antic de les despeses repartides (la part d'aquesta persona d'una despesa
   * que vas pagar tu). Ara són coses compartides: només el llegeix `migrateDebtSplits`.
   */
  expenseTxId?: string;
}

/** Aportació manual a un objectiu d'estalvi (negativa si en treus diners). */
export interface GoalContribution {
  id: string;
  date: string;
  amountCents: Cents;
  note?: string;
}

/**
 * Objectiu d'estalvi. L'estalviat = saldo actual dels comptes vinculats + aportacions manuals.
 * Es pot fer servir només una de les dues fonts o totes dues (p.ex. compte remunerat + efectiu).
 */
export interface SavingsGoal {
  id: string;
  name: string;
  targetCents: Cents;
  /** Data límit opcional (ISO local). */
  targetDate?: string;
  accountIds: string[];
  contributions: GoalContribution[];
  color?: string;
  notes?: string;
  createdAt: string;
  /** Aconseguit o abandonat: surt de la llista principal. */
  archived?: boolean;
}

/** Límit de despesa mensual d'una categoria. Un per categoria (id = "limit_" + categoryId). */
export interface SpendingLimit {
  id: string;
  categoryId: string;
  monthlyCents: Cents;
}

/**
 * Cobrament (o ingrés) periòdic: gimnàs, Netflix, assegurança... L'app en crea el moviment
 * quan toca; si el compte s'importa, el moviment real substitueix el provisional.
 */
export interface Subscription {
  id: string;
  name: string;
  /** Sempre positiu; el signe el dona `kind`. */
  amountCents: Cents;
  kind: 'expense' | 'income';
  /** 1 = mensual, 3 = trimestral, 12 = anual... */
  everyMonths: number;
  /** Primer cobrament (ISO local). Els següents cauen el mateix dia del mes. */
  startDate: string;
  accountId: string;
  categoryId?: string;
  /** Data de baixa: no es generen cobraments posteriors. */
  endDate?: string;
  notes?: string;
  /** Últim cobrament ja processat (creat o vinculat). Evita recrear els que esborris. */
  generatedThrough?: string;
  /** Com surt als extractes (s'aprèn del primer cobrament importat). */
  bankDescription?: string;
}

/** Id reservat del participant que ets tu a les coses compartides. */
export const ME = 'me';

/** Persona que participa en una cosa compartida. `weight` = la seva part per defecte (1 = a parts iguals). */
export interface SharedParticipant {
  id: string;
  name: string;
  weight: number;
}

/** Una despesa d'una cosa compartida: qui l'ha pagat i quant li toca a cadascú. */
export interface SharedExpense {
  id: string;
  date: string;
  description: string;
  totalCents: Cents;
  /** Participant -> quant ha pagat. Suma = total. */
  paidBy: Record<string, Cents>;
  /** Participant -> la seva part. Suma = total. Es congela en desar (canviar el repartiment no reescriu l'historial). */
  shares: Record<string, Cents>;
  /** El teu moviment real (si l'has pagat tu). El seu import ha de ser el que has pagat. */
  txId?: string;
  notes?: string;
}

/** Diners que una persona dona a una altra per quadrar comptes (Bizum, efectiu...). */
export interface SharedSettlement {
  id: string;
  date: string;
  fromId: string;
  toId: string;
  amountCents: Cents;
  /** El teu moviment real (si l'has enviat o rebut tu). */
  txId?: string;
  note?: string;
}

/**
 * Cosa compartida: una compra amb amics, un viatge, el pis, el cotxe, una subscripció a mitges...
 * Els saldos de cadascú es calculen: el que ha pagat - el que li toca + el que ha enviat - el que ha rebut.
 */
export interface SharedItem {
  id: string;
  name: string;
  /** 'oneoff': es tanca quan quadra (un regal, un viatge). 'ongoing': no s'acaba (pis, cotxe, Netflix). */
  kind: 'oneoff' | 'ongoing';
  participants: SharedParticipant[];
  categoryId?: string;
  /** Cada cobrament d'aquesta subscripció compta com a despesa compartida pagada per tu. */
  subscriptionId?: string;
  /** Només es compten els cobraments de la subscripció a partir d'aquesta data. */
  subscriptionSince?: string;
  expenses: SharedExpense[];
  settlements: SharedSettlement[];
  notes?: string;
  createdAt: string;
  archived?: boolean;
}

/** Compra o venda d'accions (o ETF, fons...). Imports en la moneda del valor. */
export interface StockTrade {
  id: string;
  date: string;
  side: 'buy' | 'sell';
  /** Nombre de títols (pot ser fraccionari). */
  quantity: number;
  /** Títols × preu, sense comissió. */
  grossCents: Cents;
  feeCents: Cents;
  /**
   * Euros per unitat de la moneda el dia de l'operació (p.ex. 0,92 per a USD). Serveix per calcular
   * el guany en euros (el que demana Hisenda). Si falta, es fa servir el tipus de canvi actual.
   */
  eurRate?: number;
  note?: string;
}

/** Un valor que tens o has tingut (AAPL, VWCE...). La posició es calcula a partir de les operacions. */
export interface StockHolding {
  id: string;
  /** Ticker en majúscules. */
  symbol: string;
  name?: string;
  /** Moneda en què cotitza (EUR, USD...). */
  currency: string;
  /** Compte del broker (tipus inversió): permet desar-ne el valor com a valoració. */
  accountId?: string;
  trades: StockTrade[];
  /** Últim preu per títol que has apuntat (cèntims de la moneda; pot tenir decimals). */
  lastPrice?: { cents: number; date: string };
  notes?: string;
  archived?: boolean;
}

/** Tipus de canvi actual d'una moneda a euros (id = codi de la moneda). */
export interface FxRate {
  id: string;
  /** Euros per unitat de moneda: 1 USD = 0,92 EUR -> 0.92. */
  eurPerUnit: number;
  date: string;
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
