import { accountBalance } from './balances';
import { addDays, daysBetween, monthOf, normalizeDate } from './dates';
import type { Cents } from './money';
import type { Account, GoalContribution, SavingsGoal, Transaction, Valuation } from './types';

export interface GoalInput {
  name: string;
  targetCents: Cents;
  targetDate?: string;
  accountIds: string[];
  color?: string;
  notes?: string;
}

/** Crea o edita un objectiu. En editar es mantenen les aportacions i la data de creació. */
export function saveGoal(input: GoalInput, id: string, now: string, current?: SavingsGoal): SavingsGoal {
  const name = input.name.trim();
  if (!name) throw new Error("Cal un nom per a l'objectiu");
  if (!(input.targetCents > 0)) throw new Error("L'import objectiu ha de ser més gran que 0");
  return {
    id,
    name,
    targetCents: input.targetCents,
    targetDate: input.targetDate ? normalizeDate(input.targetDate) : undefined,
    accountIds: [...new Set(input.accountIds)],
    contributions: current?.contributions ?? [],
    color: input.color,
    notes: input.notes?.trim() || undefined,
    createdAt: current?.createdAt ?? normalizeDate(now),
    archived: current?.archived,
  };
}

/** Aportació manual. Pot ser negativa (has tret diners de l'objectiu), però no 0. */
export function addContribution(goal: SavingsGoal, input: Omit<GoalContribution, 'id'>, id: string): SavingsGoal {
  if (!input.amountCents) throw new Error("L'import no pot ser 0");
  const c: GoalContribution = { id, date: normalizeDate(input.date), amountCents: input.amountCents, note: input.note?.trim() || undefined };
  return { ...goal, contributions: [...goal.contributions, c].sort((a, b) => a.date.localeCompare(b.date)) };
}

export function removeContribution(goal: SavingsGoal, contributionId: string): SavingsGoal {
  return { ...goal, contributions: goal.contributions.filter((c) => c.id !== contributionId) };
}

export interface GoalData {
  accounts: Account[];
  transactions: Transaction[];
  valuations: Valuation[];
}

/** Estalviat a `asOf`: saldo dels comptes vinculats (que encara existeixin) + aportacions fins aquell dia. */
export function savedAt(goal: SavingsGoal, data: GoalData, asOf: string): { accountsCents: Cents; manualCents: Cents } {
  const byId = new Map(data.accounts.map((a) => [a.id, a]));
  let accountsCents = 0;
  for (const id of goal.accountIds) {
    const acc = byId.get(id);
    if (acc) accountsCents += accountBalance(acc, data.transactions, data.valuations, asOf).cents;
  }
  const manualCents = goal.contributions.filter((c) => c.date <= asOf).reduce((s, c) => s + c.amountCents, 0);
  return { accountsCents, manualCents };
}

export type GoalStatus = 'reached' | 'on-track' | 'behind' | 'overdue' | 'no-date';

export interface GoalProgress {
  savedCents: Cents;
  accountsCents: Cents;
  manualCents: Cents;
  /** 0..1 */
  ratio: number;
  remainingCents: Cents;
  status: GoalStatus;
  /** Mesos (decimals) fins a la data objectiu; undefined si no en té. */
  monthsLeft?: number;
  /** Quant cal estalviar cada mes per arribar-hi a temps. */
  requiredMonthlyCents?: Cents;
  /** Ritme dels últims mesos (pot ser negatiu). */
  paceMonthlyCents: Cents;
  /** Mes estimat d'arribada al ritme actual (YYYY-MM), si el ritme és positiu. */
  etaMonth?: string;
}

const DAYS_PER_MONTH = 365.25 / 12;
/** Finestra per calcular el ritme d'estalvi. */
export const PACE_DAYS = 90;

export function goalProgress(goal: SavingsGoal, data: GoalData, asOf: string): GoalProgress {
  const now = savedAt(goal, data, asOf);
  const savedCents = now.accountsCents + now.manualCents;
  const remainingCents = Math.max(goal.targetCents - savedCents, 0);
  const ratio = Math.min(Math.max(savedCents / goal.targetCents, 0), 1);

  // Ritme = variació de l'estalviat en els últims 90 dies (els comptes vinculats ja tenen historial
  // d'abans de crear l'objectiu, així que el ritme és útil des del primer dia).
  const before = savedAt(goal, data, addDays(asOf, -PACE_DAYS));
  const paceMonthlyCents = Math.round(((savedCents - before.accountsCents - before.manualCents) / PACE_DAYS) * DAYS_PER_MONTH);

  const etaMonth =
    remainingCents > 0 && paceMonthlyCents > 0 ? monthOf(addDays(asOf, Math.ceil((remainingCents / paceMonthlyCents) * DAYS_PER_MONTH))) : undefined;

  let status: GoalStatus;
  let monthsLeft: number | undefined;
  let requiredMonthlyCents: Cents | undefined;
  if (remainingCents === 0) status = 'reached';
  else if (!goal.targetDate) status = 'no-date';
  else {
    monthsLeft = Math.max(daysBetween(asOf, goal.targetDate) / DAYS_PER_MONTH, 0);
    if (monthsLeft <= 0) status = 'overdue';
    else {
      // Com a mínim un mes: a l'últim mes no té sentit dir "cal estalviar 30.000 €/mes".
      requiredMonthlyCents = Math.round(remainingCents / Math.max(monthsLeft, 1));
      status = paceMonthlyCents >= requiredMonthlyCents ? 'on-track' : 'behind';
    }
  }
  return { savedCents, ...now, ratio, remainingCents, status, monthsLeft, requiredMonthlyCents, paceMonthlyCents, etaMonth };
}

/** Comptes vinculats a més d'un objectiu actiu: el seu saldo compta dues vegades. */
export function sharedAccountIds(goals: SavingsGoal[]): Set<string> {
  const seen = new Set<string>();
  const shared = new Set<string>();
  for (const g of goals.filter((x) => !x.archived)) {
    for (const id of g.accountIds) (seen.has(id) ? shared : seen).add(id);
  }
  return shared;
}

/** Ordre de la llista: primer els que tenen data (més propera primer), després la resta per nom. */
export function sortGoals(goals: SavingsGoal[]): SavingsGoal[] {
  return [...goals].sort(
    (a, b) =>
      (a.targetDate ? 0 : 1) - (b.targetDate ? 0 : 1) ||
      (a.targetDate ?? '').localeCompare(b.targetDate ?? '') ||
      a.name.localeCompare(b.name, 'ca'),
  );
}
