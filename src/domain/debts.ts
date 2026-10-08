import { normalizeDate } from './dates';
import type { Cents } from './money';
import { editTransaction } from './transactions';
import type { Debt, DebtRepayment, Transaction } from './types';

export interface DebtInput {
  person: string;
  amountCents: Cents;
  reason: string;
  date: string;
  notes?: string;
}

/** Crea o edita un deute. En editar es mantenen els retorns ja registrats. */
export function saveDebt(input: DebtInput, id: string, current?: Debt): Debt {
  const person = input.person.trim();
  if (!person) throw new Error('Cal indicar a qui li has deixat els diners');
  if (!(input.amountCents > 0)) throw new Error("L'import ha de ser més gran que 0");
  const repayments = current?.repayments ?? [];
  if (repaidCents({ repayments }) > input.amountCents) throw new Error("L'import no pot ser inferior al que ja t'han tornat");
  return {
    id,
    person,
    amountCents: input.amountCents,
    reason: input.reason.trim(),
    date: normalizeDate(input.date),
    repayments,
    notes: input.notes?.trim() || undefined,
    txId: current?.txId,
  };
}

export function repaidCents(debt: Pick<Debt, 'repayments'>): Cents {
  return (debt.repayments ?? []).reduce((s, r) => s + r.amountCents, 0);
}

export function pendingCents(debt: Debt): Cents {
  return debt.amountCents - repaidCents(debt);
}

export function isSettled(debt: Debt): boolean {
  return pendingCents(debt) <= 0;
}

/** Data de l'últim retorn (quan es va saldar, si està saldat). */
export function lastRepaymentDate(debt: Debt): string | undefined {
  return (debt.repayments ?? []).map((r) => r.date).sort().at(-1);
}

/** Registra un retorn. No pot superar el que queda pendent. */
export function addRepayment(debt: Debt, input: Omit<DebtRepayment, 'id'>, id: string): Debt {
  if (!(input.amountCents > 0)) throw new Error("L'import ha de ser més gran que 0");
  if (input.amountCents > pendingCents(debt)) throw new Error('El retorn supera el que queda pendent');
  const repayment: DebtRepayment = { id, date: normalizeDate(input.date), amountCents: input.amountCents, note: input.note?.trim() || undefined };
  return { ...debt, repayments: [...(debt.repayments ?? []), repayment].sort((a, b) => a.date.localeCompare(b.date)) };
}

export function removeRepayment(debt: Debt, repaymentId: string): Debt {
  return { ...debt, repayments: (debt.repayments ?? []).filter((r) => r.id !== repaymentId) };
}

export interface PersonDebts {
  person: string;
  pendingCents: Cents;
  debts: Debt[];
}

export interface DebtSummary {
  pendingCents: Cents;
  lentCents: Cents;
  repaidCents: Cents;
  /** Persones amb algun deute pendent, de més a menys pendent. */
  byPerson: PersonDebts[];
}

const personKey = (p: string) => p.trim().toLocaleLowerCase('ca');

export function summarizeDebts(debts: Debt[]): DebtSummary {
  const groups = new Map<string, PersonDebts>();
  for (const d of debts.filter((x) => !isSettled(x))) {
    const key = personKey(d.person);
    const g = groups.get(key) ?? { person: d.person.trim(), pendingCents: 0, debts: [] };
    g.pendingCents += pendingCents(d);
    g.debts.push(d);
    groups.set(key, g);
  }
  for (const g of groups.values()) g.debts.sort((a, b) => a.date.localeCompare(b.date));
  return {
    pendingCents: debts.reduce((s, d) => s + Math.max(pendingCents(d), 0), 0),
    lentCents: debts.reduce((s, d) => s + d.amountCents, 0),
    repaidCents: debts.reduce((s, d) => s + repaidCents(d), 0),
    byPerson: [...groups.values()].sort((a, b) => b.pendingCents - a.pendingCents || a.person.localeCompare(b.person)),
  };
}

/** Noms ja utilitzats (per autocompletar), sense repetir majúscules/minúscules. */
export function knownPeople(debts: Debt[]): string[] {
  const m = new Map<string, string>();
  for (const d of debts) m.set(personKey(d.person), d.person.trim());
  return [...m.values()].sort((a, b) => a.localeCompare(b, 'ca'));
}

// --- Enllaç amb moviments reals (Bizums enviats i rebuts) ----------------------------------

/**
 * Converteix una sortida de diners (p.ex. un Bizum enviat) en un préstec: crea el deute i
 * marca el moviment com a 'loan', que no compta com a despesa.
 */
export function debtFromTransaction(
  tx: Transaction,
  input: { person: string; reason: string; notes?: string },
  id: string,
): { debt: Debt; tx: Transaction } {
  if (tx.amountCents >= 0) throw new Error('Només una sortida de diners pot ser un préstec');
  const debt = saveDebt({ ...input, amountCents: -tx.amountCents, date: tx.date }, id);
  return { debt: { ...debt, txId: tx.id }, tx: editTransaction(tx, { kind: 'loan', categoryId: undefined }) };
}

/** Registra com a retorn del deute una entrada real de diners (p.ex. el Bizum rebut). */
export function linkRepaymentTx(debt: Debt, tx: Transaction, id: string): { debt: Debt; tx: Transaction } {
  if (tx.amountCents <= 0) throw new Error('Només una entrada de diners pot ser un retorn');
  if (debt.repayments.some((r) => r.txId === tx.id)) throw new Error('Aquest moviment ja és un retorn del deute');
  const next = addRepayment(debt, { date: tx.date, amountCents: tx.amountCents, note: tx.description }, id);
  return {
    debt: { ...next, repayments: next.repayments.map((r) => (r.id === id ? { ...r, txId: tx.id } : r)) },
    tx: editTransaction(tx, { kind: 'loan', categoryId: undefined }),
  };
}

/**
 * Moviments que cal tornar al seu tipus quan es desfà l'enllaç amb un deute (o s'elimina):
 * l'origen torna a ser despesa i els retorns, reemborsaments per revisar.
 */
export function releaseDebtTxs(debt: Debt, txs: Transaction[], repaymentIds?: Set<string>): Transaction[] {
  const byId = new Map(txs.map((t) => [t.id, t]));
  const out: Transaction[] = [];
  const origin = !repaymentIds && debt.txId ? byId.get(debt.txId) : undefined;
  if (origin?.kind === 'loan') out.push(editTransaction(origin, { kind: 'expense' }));
  for (const r of debt.repayments) {
    if (repaymentIds && !repaymentIds.has(r.id)) continue;
    const t = r.txId ? byId.get(r.txId) : undefined;
    if (t?.kind === 'loan') out.push({ ...editTransaction(t, { kind: 'reimbursement' }), needsReview: true });
  }
  return out;
}

export interface DebtLink {
  debt: Debt;
  role: 'origin' | 'repayment';
  repaymentId?: string;
}

/** Quins moviments estan lligats a algun deute (per mostrar-ho al detall del moviment). */
export function debtLinksByTx(debts: Debt[]): Map<string, DebtLink> {
  const out = new Map<string, DebtLink>();
  for (const debt of debts) {
    if (debt.txId) out.set(debt.txId, { debt, role: 'origin' });
    for (const r of debt.repayments) if (r.txId) out.set(r.txId, { debt, role: 'repayment', repaymentId: r.id });
  }
  return out;
}
