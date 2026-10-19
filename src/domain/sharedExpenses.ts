/**
 * Despeses compartides: pagues tu (un sopar, unes entrades...) i cada persona et deu la seva part.
 *
 * Una despesa compartida és una despesa normal amb:
 *   - `expectedBackCents` = suma de les parts dels altres (la vista de consum ja només compta la teva);
 *   - un deute per persona (`Debt.expenseTxId`), amb el motiu i la data de la despesa;
 *   - els Bizums rebuts com a reemborsaments enllaçats a la despesa i registrats com a retorns del
 *     deute de qui l'ha fet.
 * Així el que falta per cobrar es veu per persona a Deutes i el sopar et costa només la teva part.
 */
import { syncSharedExpected } from './debts';
import { normalizeDate } from './dates';
import type { Cents } from './money';
import { isRecoverableExpense } from './recoveries';
import type { Debt, Transaction } from './types';

export interface SharePayment {
  amountCents: Cents;
  /** YYYY-MM-DD o ISO local. */
  date: string;
  /** Compte on t'ha arribat (per defecte, el de la despesa). */
  accountId?: string;
  description?: string;
}

export interface ShareInput {
  person: string;
  shareCents: Cents;
  /** Ja t'ho ha tornat (Bizum, efectiu...). Pot ser una part. */
  paid?: SharePayment;
}

/** Repartiment a parts iguals entre `people` persones (tu inclòs). Els cèntims que sobren són teus. */
export function equalSplit(totalCents: Cents, people: number): { mineCents: Cents; eachCents: Cents } {
  const n = Math.max(1, Math.floor(people));
  const eachCents = Math.floor(totalCents / n);
  return { eachCents, mineCents: totalCents - eachCents * (n - 1) };
}

export interface SplitResult {
  expense: Transaction;
  /** Retorns ja cobrats (Bizums), com a moviments nous. */
  reimbursements: Transaction[];
  debts: Debt[];
}

export interface SplitOptions {
  /** Deutes existents (per comptar les parts que la despesa ja tenia). */
  existingDebts?: Debt[];
  newId: (prefix: string) => string;
  currencyOf?: (accountId: string) => string | undefined;
}

/** Reparteix una despesa (nova o existent) entre persones que et deuen la seva part. */
export function splitExpense(expense: Transaction, shares: ShareInput[], { existingDebts = [], newId, currencyOf }: SplitOptions): SplitResult {
  if (!isRecoverableExpense(expense)) throw new Error('Només es pot repartir una despesa');
  if (shares.length === 0) throw new Error('Afegeix almenys una persona');
  const gross = -expense.amountCents;
  const already = existingDebts.filter((d) => d.expenseTxId === expense.id).reduce((s, d) => s + d.amountCents, 0);
  const total = shares.reduce((s, x) => s + x.shareCents, 0);
  if (already + total > gross) throw new Error('Les parts dels altres sumen més que la despesa');

  const reimbursements: Transaction[] = [];
  const debts: Debt[] = shares.map((s) => {
    const person = s.person.trim();
    if (!person) throw new Error('Cal el nom de cada persona');
    if (!(s.shareCents > 0)) throw new Error(`La part de ${person} ha de ser més gran que 0`);
    const debt: Debt = {
      id: newId('debt'),
      person,
      amountCents: s.shareCents,
      reason: expense.description,
      date: expense.date,
      repayments: [],
      expenseTxId: expense.id,
    };
    if (s.paid) {
      if (!(s.paid.amountCents > 0)) throw new Error(`L'import que t'ha tornat ${person} ha de ser més gran que 0`);
      if (s.paid.amountCents > s.shareCents) throw new Error(`${person} no et pot tornar més que la seva part`);
      const accountId = s.paid.accountId ?? expense.accountId;
      const tx: Transaction = {
        id: newId('tx'),
        accountId,
        date: normalizeDate(s.paid.date),
        amountCents: s.paid.amountCents,
        feeCents: 0,
        currency: currencyOf?.(accountId) ?? expense.currency,
        description: s.paid.description?.trim() || `Bizum de ${person}`,
        kind: 'reimbursement',
        categoryId: expense.categoryId,
        source: 'manual',
        userEdited: true,
        recoversTxId: expense.id,
      };
      reimbursements.push(tx);
      debt.repayments.push({ id: newId('rep'), date: tx.date, amountCents: tx.amountCents, note: tx.description, txId: tx.id });
    }
    return debt;
  });

  const synced = syncSharedExpected(expense, [...existingDebts, ...debts]);
  return { expense: synced ?? expense, reimbursements, debts };
}
