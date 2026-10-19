import { daysBetween, normalizeDate } from './dates';
import type { Cents } from './money';
import type { Subscription, Transaction } from './types';

/** Cada quants mesos es cobra. */
export const SUBSCRIPTION_PERIODS = [1, 2, 3, 6, 12] as const;
export type SubscriptionPeriod = (typeof SUBSCRIPTION_PERIODS)[number];

export const PERIOD_LABELS: Record<SubscriptionPeriod, { every: string; per: string }> = {
  1: { every: 'Cada mes', per: 'mes' },
  2: { every: 'Cada 2 mesos', per: '2 mesos' },
  3: { every: 'Cada 3 mesos', per: 'trimestre' },
  6: { every: 'Cada 6 mesos', per: 'semestre' },
  12: { every: 'Cada any', per: 'any' },
};

const day = (iso: string) => iso.slice(0, 10);
const p2 = (n: number) => String(n).padStart(2, '0');

function daysIn(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Data del cobrament número `n` (0 = el primer). Si el dia no existeix al mes (31 de febrer), l'últim dia. */
export function occurrenceDate(sub: Pick<Subscription, 'startDate' | 'everyMonths'>, n: number): string {
  const [y, m, d] = day(sub.startDate).split('-').map(Number);
  const total = m - 1 + n * sub.everyMonths;
  const year = y + Math.floor(total / 12);
  const month = (total % 12) + 1;
  return `${year}-${p2(month)}-${p2(Math.min(d, daysIn(year, month)))}`;
}

/** Cobraments (YYYY-MM-DD) entre `from` (exclòs) i `to` (inclòs), respectant la data de baixa. */
export function occurrencesBetween(sub: Subscription, from: string | undefined, to: string): string[] {
  const out: string[] = [];
  const end = sub.endDate && day(sub.endDate) < day(to) ? day(sub.endDate) : day(to);
  for (let n = 0; n < 1000; n++) {
    const d = occurrenceDate(sub, n);
    if (d > end) break;
    if (!from || d > day(from)) out.push(d);
  }
  return out;
}

/** Proper cobrament a partir d'avui (inclòs), o undefined si ja s'ha donat de baixa. */
export function nextOccurrence(sub: Subscription, today: string): string | undefined {
  for (let n = 0; n < 1000; n++) {
    const d = occurrenceDate(sub, n);
    if (sub.endDate && d > day(sub.endDate)) return undefined;
    if (d >= day(today)) return d;
  }
  return undefined;
}

export const isActive = (sub: Subscription, today: string) => !sub.endDate || day(sub.endDate) >= day(today);

/** Import amb signe d'un cobrament (negatiu si és despesa). */
export const signedAmount = (sub: Pick<Subscription, 'amountCents' | 'kind'>): Cents => (sub.kind === 'expense' ? -sub.amountCents : sub.amountCents);

/** Cost equivalent mensual (una quota anual de 120 € = 10 €/mes). */
export const monthlyEquivalent = (sub: Pick<Subscription, 'amountCents' | 'everyMonths'>): Cents => Math.round(sub.amountCents / sub.everyMonths);

export interface SubscriptionInput {
  name: string;
  amountCents: Cents;
  kind: Subscription['kind'];
  everyMonths: number;
  startDate: string;
  accountId: string;
  categoryId?: string;
  endDate?: string;
  notes?: string;
}

/** Crea o actualitza una subscripció. En editar es manté fins on ja s'han generat els cobraments. */
export function saveSubscription(input: SubscriptionInput, id: string, current?: Subscription): Subscription {
  const name = input.name.trim();
  if (!name) throw new Error('Cal un nom');
  if (!(input.amountCents > 0)) throw new Error("L'import ha de ser més gran que 0");
  if (!SUBSCRIPTION_PERIODS.includes(input.everyMonths as SubscriptionPeriod)) throw new Error('Periodicitat no vàlida');
  if (!input.accountId) throw new Error('Tria un compte');
  const startDate = normalizeDate(day(input.startDate));
  const endDate = input.endDate ? normalizeDate(day(input.endDate)) : undefined;
  if (endDate && endDate < startDate) throw new Error('La data de baixa ha de ser posterior al primer cobrament');
  const sub: Subscription = {
    ...current,
    id,
    name,
    amountCents: input.amountCents,
    kind: input.kind,
    everyMonths: input.everyMonths,
    startDate,
    accountId: input.accountId,
    categoryId: input.categoryId || undefined,
    endDate,
    notes: input.notes?.trim() || undefined,
  };
  // Si s'avança el primer cobrament per sota del que ja s'havia generat, es tornen a mirar aquells mesos.
  if (sub.generatedThrough && sub.generatedThrough < startDate) delete sub.generatedThrough;
  return sub;
}

export const placeholderId = (subId: string, date: string) => `sub_${subId}_${day(date).replaceAll('-', '')}`;

/** Moviment creat per l'app per a un cobrament que encara no ha arribat amb cap importació. */
export const isPlaceholder = (t: Transaction) => !!t.subscriptionId && t.source === 'manual' && t.id.startsWith('sub_');

const monthIndex = (iso: string) => Number(iso.slice(0, 4)) * 12 + Number(iso.slice(5, 7));

const norm = (s: string) => s.toLocaleLowerCase('ca').replace(/\s+/g, ' ').trim();

/** Finestra per reconèixer un cobrament real: dies de marge i diferència d'import acceptada. */
function tolerance(sub: Subscription) {
  // Si ja sabem com surt al banc, podem ser més flexibles amb l'import (pujades de preu).
  return sub.bankDescription ? { days: 7, ratio: 0.25 } : { days: 4, ratio: 0.05 };
}

/** Puntuació d'un moviment com a cobrament de `sub` en `date` (més baix = millor), o null si no ho pot ser. */
function matchScore(sub: Subscription, t: Transaction, date: string): number | null {
  if (t.accountId !== sub.accountId || t.subscriptionId || t.hidden || t.transferGroupId) return null;
  const expected = signedAmount(sub);
  if (Math.sign(t.amountCents) !== Math.sign(expected)) return null;
  const tol = tolerance(sub);
  const amountDiff = Math.abs(Math.abs(t.amountCents) - sub.amountCents) / sub.amountCents;
  const dayDiff = Math.abs(daysBetween(normalizeDate(date), `${day(t.date)}T00:00:00`));
  if (amountDiff > tol.ratio || dayDiff > tol.days) return null;
  if (t.source === 'import' && sub.bankDescription && norm(t.description) !== norm(sub.bankDescription)) return null;
  return amountDiff * 100 + dayDiff;
}

function bestMatch(sub: Subscription, date: string, candidates: Transaction[], taken: Set<string>): Transaction | undefined {
  let best: { t: Transaction; score: number } | undefined;
  for (const t of candidates) {
    if (taken.has(t.id)) continue;
    const score = matchScore(sub, t, date);
    if (score !== null && (!best || score < best.score)) best = { t, score };
  }
  return best?.t;
}

/** Vincula un moviment existent a la subscripció i li posa la categoria si no en tenia (o era una suposició). */
function link(t: Transaction, sub: Subscription): Transaction {
  const next: Transaction = { ...t, subscriptionId: sub.id };
  if (!t.userEdited || !t.categoryId) {
    next.kind = sub.kind;
    next.categoryId = sub.categoryId ?? t.categoryId;
    delete next.needsReview;
  }
  return next;
}

function placeholder(sub: Subscription, date: string, currency: string): Transaction {
  return {
    id: placeholderId(sub.id, date),
    accountId: sub.accountId,
    date: `${date}T00:00:00`,
    amountCents: signedAmount(sub),
    feeCents: 0,
    currency,
    description: sub.name,
    kind: sub.kind,
    categoryId: sub.categoryId,
    source: 'manual',
    subscriptionId: sub.id,
  };
}

export interface SubscriptionRun {
  /** Moviments nous (cobraments que no s'han trobat) i existents que s'han vinculat. */
  transactions: Transaction[];
  /** Subscripcions amb `generatedThrough` avançat. */
  subscriptions: Subscription[];
  created: { subscription: Subscription; date: string }[];
  linked: number;
}

/**
 * Cobraments vençuts fins a `today` que encara no s'han processat. Per a cadascun:
 * - si ja hi ha el moviment real (importat o apuntat a mà), es vincula;
 * - si no, es crea un moviment provisional que una importació posterior substituirà.
 * Esborrar un d'aquests moviments no el fa tornar: `generatedThrough` recorda fins on s'ha arribat.
 */
export function planSubscriptionRun(
  subscriptions: Subscription[],
  transactions: Transaction[],
  today: string,
  currencyOf: (accountId: string) => string = () => 'EUR',
): SubscriptionRun {
  const out: SubscriptionRun = { transactions: [], subscriptions: [], created: [], linked: 0 };
  const existingIds = new Set(transactions.map((t) => t.id));
  const taken = new Set<string>();
  for (const sub of subscriptions) {
    const due = occurrencesBetween(sub, sub.generatedThrough, today);
    if (due.length === 0) continue;
    for (const date of due) {
      const match = bestMatch(sub, date, transactions, taken);
      if (match) {
        taken.add(match.id);
        out.transactions.push(link(match, sub));
        out.linked++;
      } else if (!existingIds.has(placeholderId(sub.id, date))) {
        out.transactions.push(placeholder(sub, date, currencyOf(sub.accountId)));
        out.created.push({ subscription: sub, date });
      }
    }
    out.subscriptions.push({ ...sub, generatedThrough: `${due.at(-1)}T00:00:00` });
  }
  return out;
}

export interface ImportReconciliation {
  /** Moviments importats, alguns ja vinculats a una subscripció. */
  transactions: Transaction[];
  /** Moviments provisionals que l'import real substitueix. */
  replacedIds: string[];
  /** Subscripcions que han après com surten al banc. */
  subscriptions: Subscription[];
}

/**
 * En importar: si un moviment nou és el cobrament real d'un provisional, el substitueix
 * (conserva les notes i la categoria del provisional) i la subscripció n'aprèn la descripció del banc.
 */
export function reconcileImport(incoming: Transaction[], existing: Transaction[], subscriptions: Subscription[]): ImportReconciliation {
  const subs = new Map(subscriptions.map((s) => [s.id, s]));
  const placeholders = existing.filter(isPlaceholder).sort((a, b) => a.date.localeCompare(b.date));
  const taken = new Set<string>();
  const byId = new Map(incoming.map((t) => [t.id, t]));
  const learned = new Map<string, Subscription>();
  const replacedIds: string[] = [];

  for (const ph of placeholders) {
    const sub = learned.get(ph.subscriptionId!) ?? subs.get(ph.subscriptionId!);
    if (!sub) continue;
    const candidates = [...byId.values()].filter((t) => t.source === 'import');
    const match = bestMatch(sub, ph.date, candidates, taken);
    if (!match) continue;
    taken.add(match.id);
    const linked = link(match, sub);
    if (ph.categoryId) linked.categoryId = ph.categoryId;
    if (ph.notes) linked.notes = ph.notes;
    byId.set(match.id, linked);
    replacedIds.push(ph.id);
    if (!sub.bankDescription) learned.set(sub.id, { ...sub, bankDescription: match.description });
  }
  return { transactions: [...byId.values()], replacedIds, subscriptions: [...learned.values()] };
}

/** En esborrar una subscripció, els moviments es queden però deixen d'estar-hi vinculats. */
export function unlinkSubscription(subId: string, transactions: Transaction[]): Transaction[] {
  return transactions
    .filter((t) => t.subscriptionId === subId)
    .map((t) => {
      const next = { ...t };
      delete next.subscriptionId;
      return next;
    });
}

export interface SubscriptionSuggestion {
  name: string;
  accountId: string;
  amountCents: Cents;
  kind: Subscription['kind'];
  categoryId?: string;
  /** Primer cobrament de la sèrie (serveix de data d'inici: s'hi vinculen els anteriors). */
  firstDate: string;
  lastDate: string;
  months: number;
  bankDescription: string;
}

/**
 * Despeses importades que es repeteixen cada mes amb el mateix concepte i un import semblant
 * (Netflix, Spotify, gimnàs...) i que encara no tenen subscripció.
 */
export function suggestSubscriptions(transactions: Transaction[], subscriptions: Subscription[], today: string, minMonths = 3): SubscriptionSuggestion[] {
  const known = new Set(subscriptions.flatMap((s) => [s.bankDescription, s.name]).filter(Boolean).map((s) => `${norm(s!)}`));
  const since = `${Number(today.slice(0, 4)) - 1}${today.slice(4, 10)}`;
  const groups = new Map<string, Transaction[]>();
  for (const t of transactions) {
    if (t.source !== 'import' || t.kind !== 'expense' || t.hidden || t.subscriptionId || t.amountCents >= 0 || day(t.date) < since) continue;
    if (known.has(norm(t.description))) continue;
    const key = `${t.accountId}|${norm(t.description)}`;
    groups.set(key, [...(groups.get(key) ?? []), t]);
  }
  const out: SubscriptionSuggestion[] = [];
  for (const txs of groups.values()) {
    const byMonth = new Map<string, Transaction>();
    for (const t of txs) byMonth.set(t.date.slice(0, 7), t);
    // Un sol cobrament per mes: si n'hi ha més (p.ex. un súper), no és una subscripció.
    if (byMonth.size < minMonths || byMonth.size !== txs.length) continue;
    // Mesos seguits fins a l'últim cobrament (un restaurant on vas de tant en tant no compta).
    const all = [...byMonth.values()].sort((a, b) => a.date.localeCompare(b.date));
    let start = all.length - 1;
    while (start > 0 && monthIndex(all[start - 1].date) === monthIndex(all[start].date) - 1) start--;
    const sorted = all.slice(start);
    if (sorted.length < minMonths) continue;
    const last = sorted.at(-1)!;
    const ref = Math.abs(last.amountCents);
    if (!sorted.every((t) => Math.abs(Math.abs(t.amountCents) - ref) <= ref * 0.1)) continue;
    // Ha de seguir viu: l'últim cobrament fa menys de ~45 dies.
    if (daysBetween(`${day(last.date)}T00:00:00`, `${day(today)}T00:00:00`) > 45) continue;
    out.push({
      name: last.description,
      accountId: last.accountId,
      amountCents: ref,
      kind: 'expense',
      categoryId: last.categoryId,
      firstDate: day(sorted[0].date),
      lastDate: day(last.date),
      months: sorted.length,
      bankDescription: last.description,
    });
  }
  return out.sort((a, b) => b.amountCents - a.amountCents);
}
