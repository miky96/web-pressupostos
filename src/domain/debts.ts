import { normalizeDate } from './dates';
import type { Cents } from './money';
import type { Debt, DebtRepayment } from './types';

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
