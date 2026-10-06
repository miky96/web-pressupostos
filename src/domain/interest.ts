import { daysBetween } from './dates';
import type { Cents } from './money';
import type { Compounding, InterestTerms } from './types';

const PERIODS_PER_YEAR: Record<Compounding, number> = { daily: 365, monthly: 12, quarterly: 4, annual: 1 };

/** TIN (nominal) -> TAE (efectiva), segons la freqüència de liquidació. */
export function tinToTae(tin: number, compounding: Compounding): number {
  const n = PERIODS_PER_YEAR[compounding];
  return (1 + tin / n) ** n - 1;
}

export function taeToTin(tae: number, compounding: Compounding): number {
  const n = PERIODS_PER_YEAR[compounding];
  return n * ((1 + tae) ** (1 / n) - 1);
}

/** Retorna sempre la TAE, independentment de com l'hagi introduïda l'usuari. */
export function effectiveTae(terms: InterestTerms): number {
  return terms.rateType === 'TAE' ? terms.rate : tinToTae(terms.rate, terms.compounding);
}

export function growthFactor(tae: number, days: number): number {
  return (1 + tae) ** (Math.max(0, days) / 365);
}

export interface Flow {
  date: string;
  amountCents: Cents;
}

/**
 * Valor estimat d'un compte remunerat a `asOf`: cada import creix a la TAE des de la seva data.
 * `start` és l'última valoració coneguda (opcional).
 */
export function estimateValue(start: Flow | undefined, flows: Flow[], tae: number, asOf: string): Cents {
  const all = start ? [start, ...flows] : flows;
  const total = all
    .filter((f) => f.date <= asOf)
    .reduce((sum, f) => sum + f.amountCents * growthFactor(tae, daysBetween(f.date, asOf)), 0);
  return Math.round(total);
}

export interface ProjectionInput {
  initialCents: Cents;
  monthlyContributionCents: Cents;
  tae: number;
  months: number;
}

export interface ProjectionPoint {
  month: number;
  balanceCents: Cents;
  contributedCents: Cents;
  interestCents: Cents;
}

/** Previsió mes a mes amb aportació periòdica (al final de cada mes). */
export function project(input: ProjectionInput): ProjectionPoint[] {
  const monthlyRate = (1 + input.tae) ** (1 / 12) - 1;
  let balance = input.initialCents;
  let contributed = input.initialCents;
  const points: ProjectionPoint[] = [{ month: 0, balanceCents: balance, contributedCents: contributed, interestCents: 0 }];
  for (let m = 1; m <= input.months; m++) {
    balance = balance * (1 + monthlyRate) + input.monthlyContributionCents;
    contributed += input.monthlyContributionCents;
    points.push({
      month: m,
      balanceCents: Math.round(balance),
      contributedCents: contributed,
      interestCents: Math.round(balance - contributed),
    });
  }
  return points;
}

/** Mesos necessaris per arribar a un objectiu, o null si no s'hi arriba en `maxMonths`. */
export function monthsToReach(
  targetCents: Cents,
  input: Omit<ProjectionInput, 'months'>,
  maxMonths = 12 * 60,
): number | null {
  if (input.initialCents >= targetCents) return 0;
  const points = project({ ...input, months: maxMonths });
  const hit = points.find((p) => p.balanceCents >= targetCents);
  return hit ? hit.month : null;
}

export interface BalancePoint {
  date: string;
  balanceCents: Cents;
}

/** Saldo mitjà diari entre `from` i `to` a partir dels saldos després de cada moviment. */
export function averageDailyBalance(points: BalancePoint[], from: string, to: string): Cents {
  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date));
  const totalDays = daysBetween(from, to);
  if (totalDays <= 0) return 0;
  let current = 0;
  for (const p of sorted) if (p.date <= from) current = p.balanceCents;
  let cursor = from;
  let weighted = 0;
  for (const p of sorted) {
    if (p.date <= from) continue;
    if (p.date > to) break;
    weighted += current * daysBetween(cursor, p.date);
    cursor = p.date;
    current = p.balanceCents;
  }
  weighted += current * daysBetween(cursor, to);
  return Math.round(weighted / totalDays);
}

/** Rendiment anual real a partir dels interessos cobrats (per comparar-lo amb la TAE anunciada). */
export function observedAnnualRate(interestCents: Cents, averageBalanceCents: Cents, days: number): number {
  if (averageBalanceCents <= 0 || days <= 0) return 0;
  return (1 + interestCents / averageBalanceCents) ** (365 / days) - 1;
}
