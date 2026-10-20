/**
 * Coses compartides amb altra gent: una compra a mitges, un viatge, el pis, el cotxe, una
 * subscripció... Cada cosa té participants (tu sempre hi ets), despeses (qui ha pagat què i a qui
 * li toca quant) i liquidacions (Bizums o efectiu per quadrar). El saldo de cadascú és calculat:
 *
 *   saldo = pagat - la seva part + enviat - rebut     (> 0: li deuen diners; < 0: deu diners)
 *
 * A la vista de consum real només compta la teva part, el dia de la despesa: el que has pagat de
 * més o de menys surt com a moviment virtual i les liquidacions enllaçades no compten.
 */
import { normalizeDate } from './dates';
import { pendingCents as debtPendingCents, personKey } from './debts';
import type { Cents } from './money';
import { editTransaction } from './transactions';
import { ME, type Debt, type SharedExpense, type SharedItem, type SharedParticipant, type SharedSettlement, type Transaction } from './types';

export { ME };

const sum = (values: Iterable<number>) => [...values].reduce((s, v) => s + v, 0);
const sumRecord = (r: Record<string, Cents>) => sum(Object.values(r));
const clean = (r: Record<string, Cents>) => Object.fromEntries(Object.entries(r).filter(([, v]) => v !== 0));

export function participantName(item: SharedItem, id: string): string {
  return item.participants.find((p) => p.id === id)?.name ?? 'Algú que ja no hi és';
}

// --- Repartiment ---------------------------------------------------------------------------

/**
 * Reparteix un import segons els pesos. Els cèntims que no es poden repartir exactes van primer a
 * tu i després a qui tenia la fracció més gran: la suma sempre és el total.
 */
export function splitByWeights(totalCents: Cents, participants: Pick<SharedParticipant, 'id' | 'weight'>[]): Record<string, Cents> {
  const active = participants.filter((p) => p.weight > 0);
  if (active.length === 0) throw new Error('Cal almenys una persona amb part');
  const totalWeight = sum(active.map((p) => p.weight));
  const out: Record<string, Cents> = {};
  const fractions: { id: string; frac: number }[] = [];
  for (const p of active) {
    const exact = (totalCents * p.weight) / totalWeight;
    out[p.id] = Math.floor(exact);
    fractions.push({ id: p.id, frac: exact - Math.floor(exact) });
  }
  let left = totalCents - sumRecord(out);
  fractions.sort((a, b) => Number(b.id === ME) - Number(a.id === ME) || b.frac - a.frac);
  for (let i = 0; left > 0; i = (i + 1) % fractions.length, left--) out[fractions[i].id] += 1;
  return clean(out);
}

/** Text curt del repartiment per defecte: "a parts iguals" o "60 % / 40 %". */
export function splitLabel(participants: SharedParticipant[]): string {
  const active = participants.filter((p) => p.weight > 0);
  if (active.every((p) => p.weight === active[0].weight)) return 'a parts iguals';
  const total = sum(active.map((p) => p.weight));
  return active.map((p) => `${p.name} ${Math.round((p.weight / total) * 100)} %`).join(' · ');
}

// --- Despeses (desades + cobraments de la subscripció) -------------------------------------

export interface ExpandedExpense extends SharedExpense {
  /** Ve d'un cobrament de la subscripció vinculada (no es desa: es calcula). */
  fromSubscription?: boolean;
}

/** Despeses de la cosa, incloent-hi els cobraments de la subscripció vinculada, de la més nova a la més antiga. */
export function expandExpenses(item: SharedItem, txs: Transaction[]): ExpandedExpense[] {
  const out: ExpandedExpense[] = [...item.expenses];
  if (item.subscriptionId) {
    const linked = new Set(item.expenses.map((e) => e.txId).filter(Boolean));
    const since = item.subscriptionSince ? item.subscriptionSince.slice(0, 10) : '';
    for (const t of txs) {
      if (t.subscriptionId !== item.subscriptionId || t.hidden || t.amountCents >= 0 || linked.has(t.id)) continue;
      if (t.date.slice(0, 10) < since) continue;
      const total = -t.amountCents;
      out.push({
        id: `sub:${t.id}`,
        date: t.date,
        description: t.description,
        totalCents: total,
        paidBy: { [ME]: total },
        shares: splitByWeights(total, item.participants),
        txId: t.id,
        fromSubscription: true,
      });
    }
  }
  return out.sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
}

// --- Saldos --------------------------------------------------------------------------------

export interface ParticipantBalance {
  id: string;
  name: string;
  paidCents: Cents;
  shareCents: Cents;
  sentCents: Cents;
  receivedCents: Cents;
  /** > 0: li deuen; < 0: deu. */
  netCents: Cents;
}

export function sharedBalances(item: SharedItem, expenses: SharedExpense[]): ParticipantBalance[] {
  const ids = new Set(item.participants.map((p) => p.id));
  // Qui ja no és participant però té moviments també ha de quadrar.
  for (const e of expenses) for (const id of [...Object.keys(e.paidBy), ...Object.keys(e.shares)]) ids.add(id);
  for (const s of item.settlements) ids.add(s.fromId).add(s.toId);
  return [...ids].map((id) => {
    const paidCents = sum(expenses.map((e) => e.paidBy[id] ?? 0));
    const shareCents = sum(expenses.map((e) => e.shares[id] ?? 0));
    const sentCents = sum(item.settlements.filter((s) => s.fromId === id).map((s) => s.amountCents));
    const receivedCents = sum(item.settlements.filter((s) => s.toId === id).map((s) => s.amountCents));
    return { id, name: participantName(item, id), paidCents, shareCents, sentCents, receivedCents, netCents: paidCents - shareCents + sentCents - receivedCents };
  });
}

export interface Transfer {
  fromId: string;
  toId: string;
  amountCents: Cents;
}

/**
 * Mínim de pagaments per quedar en paus: el que més deu paga al que més li deuen, i així
 * successivament. Amb dues persones és simplement "qui deu a qui".
 */
export function settlementPlan(balances: Pick<ParticipantBalance, 'id' | 'netCents'>[]): Transfer[] {
  const debtors = balances.filter((b) => b.netCents < 0).map((b) => ({ id: b.id, left: -b.netCents }));
  const creditors = balances.filter((b) => b.netCents > 0).map((b) => ({ id: b.id, left: b.netCents }));
  const byAmount = (a: { id: string; left: number }, b: { id: string; left: number }) => b.left - a.left || Number(b.id === ME) - Number(a.id === ME) || a.id.localeCompare(b.id);
  const out: Transfer[] = [];
  for (;;) {
    debtors.sort(byAmount);
    creditors.sort(byAmount);
    const d = debtors.find((x) => x.left > 0);
    const c = creditors.find((x) => x.left > 0);
    if (!d || !c) break;
    const amountCents = Math.min(d.left, c.left);
    out.push({ fromId: d.id, toId: c.id, amountCents });
    d.left -= amountCents;
    c.left -= amountCents;
  }
  return out;
}

export interface SharedSummary {
  item: SharedItem;
  expenses: ExpandedExpense[];
  balances: ParticipantBalance[];
  plan: Transfer[];
  totalCents: Cents;
  myShareCents: Cents;
  myPaidCents: Cents;
  /** El teu saldo: > 0 et deuen, < 0 deus. */
  myNetCents: Cents;
  /** Per a cada persona amb qui tens alguna cosa pendent en aquesta cosa (segons el pla). > 0: et deu. */
  withPeople: { id: string; name: string; cents: Cents }[];
  settled: boolean;
}

export function summarizeShared(item: SharedItem, txs: Transaction[]): SharedSummary {
  const expenses = expandExpenses(item, txs);
  const balances = sharedBalances(item, expenses);
  const plan = settlementPlan(balances);
  const me = balances.find((b) => b.id === ME);
  const withPeople = new Map<string, Cents>();
  for (const t of plan) {
    if (t.toId === ME) withPeople.set(t.fromId, (withPeople.get(t.fromId) ?? 0) + t.amountCents);
    if (t.fromId === ME) withPeople.set(t.toId, (withPeople.get(t.toId) ?? 0) - t.amountCents);
  }
  return {
    item,
    expenses,
    balances,
    plan,
    totalCents: sum(expenses.map((e) => e.totalCents)),
    myShareCents: me?.shareCents ?? 0,
    myPaidCents: me?.paidCents ?? 0,
    myNetCents: me?.netCents ?? 0,
    withPeople: [...withPeople].map(([id, cents]) => ({ id, name: participantName(item, id), cents })),
    settled: plan.length === 0,
  };
}

// --- Persones: deutes + coses compartides --------------------------------------------------

export interface PersonPosition {
  key: string;
  name: string;
  /** El que et deu pels préstecs (Deutes). */
  debtCents: Cents;
  /** El que et deu (> 0) o li deus (< 0) per les coses compartides. */
  sharedCents: Cents;
  netCents: Cents;
  debts: Debt[];
  items: { item: SharedItem; cents: Cents }[];
}

/** Què tens pendent amb cada persona, sumant deutes i coses compartides. Només persones amb alguna cosa pendent. */
export function peopleOverview(items: SharedItem[], debts: Debt[], txs: Transaction[]): PersonPosition[] {
  const people = new Map<string, PersonPosition>();
  const get = (name: string) => {
    const key = personKey(name);
    let p = people.get(key);
    if (!p) people.set(key, (p = { key, name: name.trim(), debtCents: 0, sharedCents: 0, netCents: 0, debts: [], items: [] }));
    return p;
  };
  for (const d of debts) {
    const pending = debtPendingCents(d);
    if (pending <= 0) continue;
    const p = get(d.person);
    p.debtCents += pending;
    p.debts.push(d);
  }
  for (const item of items) {
    for (const w of summarizeShared(item, txs).withPeople) {
      const p = get(w.name);
      p.sharedCents += w.cents;
      p.items.push({ item, cents: w.cents });
    }
  }
  return [...people.values()]
    .map((p) => ({ ...p, netCents: p.debtCents + p.sharedCents }))
    .filter((p) => p.debts.length > 0 || p.items.length > 0)
    .sort((a, b) => Math.abs(b.netCents) - Math.abs(a.netCents) || a.name.localeCompare(b.name, 'ca'));
}

/** Noms ja utilitzats a deutes i coses compartides (per autocompletar). */
export function knownNames(items: SharedItem[], debts: Debt[]): string[] {
  const m = new Map<string, string>();
  for (const d of debts) m.set(personKey(d.person), d.person.trim());
  for (const i of items) for (const p of i.participants) if (p.id !== ME) m.set(personKey(p.name), p.name.trim());
  return [...m.values()].sort((a, b) => a.localeCompare(b, 'ca'));
}

// --- Edició --------------------------------------------------------------------------------

export interface SharedInput {
  name: string;
  kind: SharedItem['kind'];
  /** Sense tu: t'hi afegeix sempre amb `myWeight`. Els que no tenen id són nous. */
  others: { id?: string; name: string; weight: number }[];
  myWeight: number;
  categoryId?: string;
  subscriptionId?: string;
  subscriptionSince?: string;
  notes?: string;
}

function usedParticipantIds(item: SharedItem): Set<string> {
  const ids = new Set<string>();
  for (const e of item.expenses) for (const id of [...Object.keys(e.paidBy), ...Object.keys(e.shares)]) ids.add(id);
  for (const s of item.settlements) ids.add(s.fromId).add(s.toId);
  return ids;
}

export function saveShared(input: SharedInput, id: string, newId: (prefix: string) => string, createdAt: string, current?: SharedItem): SharedItem {
  const name = input.name.trim();
  if (!name) throw new Error('Posa-li un nom');
  const others = input.others.map((o) => ({ ...o, name: o.name.trim() })).filter((o) => o.name);
  if (others.length === 0) throw new Error('Afegeix almenys una altra persona');
  const keys = new Set<string>();
  for (const o of others) {
    const k = personKey(o.name);
    if (keys.has(k)) throw new Error(`${o.name} surt dues vegades`);
    keys.add(k);
  }
  const weights = [input.myWeight, ...others.map((o) => o.weight)];
  if (weights.some((w) => !Number.isFinite(w) || w < 0)) throw new Error('Les parts no poden ser negatives');
  if (sum(weights) <= 0) throw new Error('Algú ha de tenir part');
  const participants: SharedParticipant[] = [
    { id: ME, name: 'Tu', weight: input.myWeight },
    ...others.map((o) => ({ id: o.id ?? newId('p'), name: o.name, weight: o.weight })),
  ];
  if (current) {
    const kept = new Set(participants.map((p) => p.id));
    const removed = [...usedParticipantIds(current)].filter((pid) => !kept.has(pid));
    if (removed.length) throw new Error(`No pots treure ${removed.map((r) => participantName(current, r)).join(', ')}: té despeses o liquidacions`);
  }
  return {
    id,
    name,
    kind: input.kind,
    participants,
    categoryId: input.categoryId || undefined,
    subscriptionId: input.subscriptionId || undefined,
    subscriptionSince: input.subscriptionId && input.subscriptionSince ? normalizeDate(input.subscriptionSince) : undefined,
    expenses: current?.expenses ?? [],
    settlements: current?.settlements ?? [],
    notes: input.notes?.trim() || undefined,
    createdAt: current?.createdAt ?? createdAt,
    archived: current?.archived,
  };
}

export interface ExpenseInput {
  date: string;
  description: string;
  totalCents: Cents;
  paidBy: Record<string, Cents>;
  /** Parts exactes. Si no n'hi ha, es reparteix segons els pesos entre `among` (per defecte, tothom). */
  shares?: Record<string, Cents>;
  among?: string[];
  txId?: string;
  notes?: string;
}

function checkIds(item: SharedItem, r: Record<string, Cents>, what: string) {
  for (const [pid, v] of Object.entries(r)) {
    if (!item.participants.some((p) => p.id === pid)) throw new Error(`${what}: participant desconegut`);
    if (!Number.isInteger(v) || v < 0) throw new Error(`${what}: imports no vàlids`);
  }
}

/** Crea o substitueix (mateix id) una despesa. */
export function saveExpense(item: SharedItem, input: ExpenseInput, id: string, tx?: Transaction): SharedItem {
  if (!(input.totalCents > 0)) throw new Error("L'import ha de ser més gran que 0");
  const paidBy = clean(input.paidBy);
  checkIds(item, paidBy, 'Qui ha pagat');
  if (sumRecord(paidBy) !== input.totalCents) throw new Error('El que ha pagat cadascú ha de sumar el total');
  let shares: Record<string, Cents>;
  if (input.shares) {
    shares = clean(input.shares);
    checkIds(item, shares, 'Parts');
    if (sumRecord(shares) !== input.totalCents) throw new Error('Les parts han de sumar el total');
  } else {
    const among = new Set(input.among ?? item.participants.map((p) => p.id));
    const chosen = item.participants.filter((p) => among.has(p.id));
    if (chosen.length === 0) throw new Error('Tria entre qui es reparteix');
    // Si cap dels triats té part per defecte (pes 0), a parts iguals entre ells.
    const weighted = chosen.some((p) => p.weight > 0) ? chosen : chosen.map((p) => ({ ...p, weight: 1 }));
    shares = splitByWeights(input.totalCents, weighted);
  }
  if (input.txId) {
    if (!tx || tx.id !== input.txId) throw new Error('No es troba el moviment enllaçat');
    if (tx.amountCents >= 0) throw new Error('Només es pot enllaçar una sortida de diners');
    if (-tx.amountCents !== (paidBy[ME] ?? 0)) throw new Error("El que has pagat tu ha de coincidir amb l'import del moviment");
  }
  const expense: SharedExpense = {
    id,
    date: normalizeDate(input.date),
    description: input.description.trim() || 'Despesa',
    totalCents: input.totalCents,
    paidBy,
    shares,
    txId: input.txId || undefined,
    notes: input.notes?.trim() || undefined,
  };
  return { ...item, expenses: [...item.expenses.filter((e) => e.id !== id), expense].sort((a, b) => a.date.localeCompare(b.date)) };
}

export function removeExpense(item: SharedItem, expenseId: string): SharedItem {
  return { ...item, expenses: item.expenses.filter((e) => e.id !== expenseId) };
}

export interface SettlementInput {
  date: string;
  fromId: string;
  toId: string;
  amountCents: Cents;
  txId?: string;
  note?: string;
}

export function saveSettlement(item: SharedItem, input: SettlementInput, id: string, tx?: Transaction): SharedItem {
  if (!(input.amountCents > 0)) throw new Error("L'import ha de ser més gran que 0");
  if (input.fromId === input.toId) throw new Error('Qui paga i qui rep han de ser persones diferents');
  for (const pid of [input.fromId, input.toId]) if (!item.participants.some((p) => p.id === pid)) throw new Error('Participant desconegut');
  if (input.txId) {
    if (!tx || tx.id !== input.txId) throw new Error('No es troba el moviment enllaçat');
    const expected = input.toId === ME ? input.amountCents : input.fromId === ME ? -input.amountCents : null;
    if (expected === null) throw new Error('Només pots enllaçar un moviment si l\'has enviat o rebut tu');
    if (tx.amountCents !== expected) throw new Error("L'import ha de coincidir amb el del moviment");
  }
  const settlement: SharedSettlement = {
    id,
    date: normalizeDate(input.date),
    fromId: input.fromId,
    toId: input.toId,
    amountCents: input.amountCents,
    txId: input.txId || undefined,
    note: input.note?.trim() || undefined,
  };
  return { ...item, settlements: [...item.settlements.filter((s) => s.id !== id), settlement].sort((a, b) => a.date.localeCompare(b.date)) };
}

export function removeSettlement(item: SharedItem, settlementId: string): SharedItem {
  return { ...item, settlements: item.settlements.filter((s) => s.id !== settlementId) };
}

// --- Enllaç amb moviments reals ------------------------------------------------------------

export interface SharedLink {
  item: SharedItem;
  role: 'expense' | 'settlement';
  entryId: string;
}

/** Quins moviments estan lligats a alguna cosa compartida (inclou els cobraments de subscripcions vinculades). */
export function sharedLinksByTx(items: SharedItem[], txs: Transaction[] = []): Map<string, SharedLink> {
  const out = new Map<string, SharedLink>();
  for (const item of items) {
    for (const e of expandExpenses(item, txs)) if (e.txId) out.set(e.txId, { item, role: 'expense', entryId: e.id });
    for (const s of item.settlements) if (s.txId) out.set(s.txId, { item, role: 'settlement', entryId: s.id });
  }
  return out;
}

/**
 * Com queda un moviment en enllaçar-lo: una despesa teva és 'expense' sense recuperació esperada
 * (el que t'han de tornar ja ho porta la cosa compartida); un Bizum rebut, un reemborsament; un
 * Bizum enviat per pagar la teva part, una despesa. Tot amb la categoria de la cosa.
 */
export function txForLink(item: SharedItem, tx: Transaction): Transaction {
  const kind = tx.amountCents > 0 ? 'reimbursement' : 'expense';
  return editTransaction(tx, { kind, categoryId: item.categoryId ?? tx.categoryId, recoversTxId: undefined, expectedBackCents: undefined, recoveryClosed: undefined });
}

/** Moviments que poden ser una despesa o una liquidació teva d'aquesta cosa (no enllaçats enlloc més). */
export function linkCandidates(
  items: SharedItem[],
  txs: Transaction[],
  debts: Debt[],
  opts: { direction: 'out' | 'in'; amountCents?: Cents; near?: string; limit?: number },
): Transaction[] {
  const used = sharedLinksByTx(items, txs);
  const debtTx = new Set<string>();
  for (const d of debts) {
    if (d.txId) debtTx.add(d.txId);
    for (const r of d.repayments) if (r.txId) debtTx.add(r.txId);
  }
  const near = opts.near ? Date.parse(opts.near.slice(0, 10)) : Date.now();
  return txs
    .filter(
      (t) =>
        !t.hidden &&
        !t.transferGroupId &&
        !used.has(t.id) &&
        !debtTx.has(t.id) &&
        !t.recoversTxId &&
        // Els provisionals de subscripcions se substitueixen en importar: millor enllaçar el real.
        !(t.subscriptionId && t.source === 'manual') &&
        !(t.expectedBackCents && t.expectedBackCents > 0) &&
        (opts.direction === 'out' ? t.amountCents < 0 && t.kind === 'expense' : t.amountCents > 0 && (t.kind === 'reimbursement' || t.kind === 'refund' || t.kind === 'income')),
    )
    .map((t) => {
      const days = Math.abs(Date.parse(t.date.slice(0, 10)) - near) / 86400000;
      const exact = opts.amountCents !== undefined && Math.abs(t.amountCents) === opts.amountCents;
      return { t, score: (exact ? 1000 : 0) - days };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, opts.limit ?? 6)
    .map((x) => x.t);
}

/** En treure l'enllaç el moviment queda com estava però per revisar (pot ser que ara no sigui un reemborsament). */
export function releaseTx(tx: Transaction): Transaction {
  return { ...tx, needsReview: true };
}

/** Enllaços a moviments eliminats que cal treure de les coses compartides. */
export function cleanupSharedLinks(deletedIds: Set<string>, items: SharedItem[]): SharedItem[] {
  return items
    .filter((i) => i.expenses.some((e) => e.txId && deletedIds.has(e.txId)) || i.settlements.some((s) => s.txId && deletedIds.has(s.txId)))
    .map((i) => ({
      ...i,
      expenses: i.expenses.map((e) => (e.txId && deletedIds.has(e.txId) ? { ...e, txId: undefined } : e)),
      settlements: i.settlements.map((s) => (s.txId && deletedIds.has(s.txId) ? { ...s, txId: undefined } : s)),
    }));
}

/** Canvia les referències a moviments d'un id antic a un de nou (moviments manuals fusionats amb els del banc). */
export function remapSharedRefs(map: Map<string, string>, items: SharedItem[]): SharedItem[] {
  const to = (id?: string) => (id && map.has(id) ? map.get(id) : id);
  return items
    .filter((i) => [...i.expenses.map((e) => e.txId), ...i.settlements.map((s) => s.txId)].some((id) => id && map.has(id)))
    .map((i) => ({
      ...i,
      expenses: i.expenses.map((e) => ({ ...e, txId: to(e.txId) })),
      settlements: i.settlements.map((s) => ({ ...s, txId: to(s.txId) })),
    }));
}

// --- Repartir una despesa de pressa (sopar, entrades...) --------------------------------------

/** Repartiment a parts iguals entre `people` persones (tu inclòs). Els cèntims que sobren són teus. */
export function equalSplit(totalCents: Cents, people: number): { mineCents: Cents; eachCents: Cents } {
  const n = Math.max(1, Math.floor(people));
  const eachCents = Math.floor(totalCents / n);
  return { eachCents, mineCents: totalCents - eachCents * (n - 1) };
}

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

export interface SplitOptions {
  newId: (prefix: string) => string;
  createdAt: string;
  currencyOf?: (accountId: string) => string | undefined;
}

/**
 * Converteix una despesa que has pagat tu en una cosa compartida puntual: tu ho has pagat tot, cada
 * persona té la seva part i els que ja t'han tornat diners hi surten com a liquidació (amb un
 * moviment nou de reemborsament). El que falta per cobrar es veu a Compartit.
 */
export function splitToShared(expense: Transaction, shares: ShareInput[], { newId, createdAt, currencyOf }: SplitOptions): { item: SharedItem; txs: Transaction[] } {
  if (expense.amountCents >= 0 || expense.kind !== 'expense') throw new Error('Només es pot repartir una despesa');
  if (shares.length === 0) throw new Error('Afegeix almenys una persona');
  const gross = -expense.amountCents;
  const others: SharedInput['others'] = [];
  const keys = new Set<string>();
  for (const s of shares) {
    const person = s.person.trim();
    if (!person) throw new Error('Cal el nom de cada persona');
    if (keys.has(personKey(person))) throw new Error(`${person} surt dues vegades`);
    keys.add(personKey(person));
    if (!(s.shareCents > 0)) throw new Error(`La part de ${person} ha de ser més gran que 0`);
    if (s.paid && !(s.paid.amountCents > 0)) throw new Error(`L'import que t'ha tornat ${person} ha de ser més gran que 0`);
    if (s.paid && s.paid.amountCents > s.shareCents) throw new Error(`${person} no et pot tornar més que la seva part`);
    others.push({ id: newId('p'), name: person, weight: 1 });
  }
  const othersCents = sum(shares.map((s) => s.shareCents));
  if (othersCents > gross) throw new Error('Les parts dels altres sumen més que la despesa');

  let item = saveShared({ name: expense.description, kind: 'oneoff', others, myWeight: 1, categoryId: expense.categoryId }, newId('shared'), newId, createdAt);
  const shareRecord: Record<string, Cents> = { [ME]: gross - othersCents };
  shares.forEach((s, i) => (shareRecord[others[i].id!] = s.shareCents));
  const linked = txForLink(item, expense);
  item = saveExpense(item, { date: expense.date, description: expense.description, totalCents: gross, paidBy: { [ME]: gross }, shares: shareRecord, txId: expense.id }, newId('se'), linked);

  const txs: Transaction[] = [linked];
  shares.forEach((s, i) => {
    if (!s.paid) return;
    const accountId = s.paid.accountId ?? expense.accountId;
    const tx: Transaction = {
      id: newId('tx'),
      accountId,
      date: normalizeDate(s.paid.date),
      amountCents: s.paid.amountCents,
      feeCents: 0,
      currency: currencyOf?.(accountId) ?? expense.currency,
      description: s.paid.description?.trim() || `Bizum de ${others[i].name}`,
      kind: 'reimbursement',
      categoryId: expense.categoryId,
      source: 'manual',
      userEdited: true,
    };
    txs.push(tx);
    item = saveSettlement(item, { date: tx.date, fromId: others[i].id!, toId: ME, amountCents: tx.amountCents, txId: tx.id }, newId('st'), tx);
  });
  return { item, txs };
}

// --- Suggeriments per a entrades de diners ----------------------------------------------------

export interface SettlementSuggestion {
  item: SharedItem;
  /** Qui et deu diners en aquesta cosa. */
  personId: string;
  name: string;
  /** El que et deu en total en aquesta cosa. */
  owedCents: Cents;
  score: number;
  reason: string;
}

/**
 * Coses compartides on algú et deu almenys l'import d'aquesta entrada (un Bizum rebut): pot ser
 * que te'l faci per quadrar. Revolut no diu qui fa el Bizum, així que compta sobretot l'import.
 */
export function suggestSettlements(tx: Transaction, items: SharedItem[], txs: Transaction[], limit = 3): SettlementSuggestion[] {
  if (tx.amountCents <= 0 || tx.hidden || sharedLinksByTx(items, txs).has(tx.id)) return [];
  const out: SettlementSuggestion[] = [];
  for (const item of items) {
    if (item.archived) continue;
    for (const w of summarizeShared(item, txs).withPeople) {
      if (w.cents < tx.amountCents) continue;
      const nameHit = tx.description.toLocaleLowerCase('ca').includes(w.name.trim().toLocaleLowerCase('ca'));
      const exact = w.cents === tx.amountCents;
      out.push({
        item,
        personId: w.id,
        name: w.name,
        owedCents: w.cents,
        score: 0.25 + (exact ? 0.4 : 0) + (nameHit ? 0.3 : 0),
        reason: [nameHit && 'mateix nom', exact ? 'ho salda' : 'et deu diners'].filter(Boolean).join(' · '),
      });
    }
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}

/** Registra una entrada de diners com a liquidació d'algú cap a tu. */
export function linkSettlementTx(item: SharedItem, personId: string, tx: Transaction, id: string): { item: SharedItem; tx: Transaction } {
  const linked = txForLink(item, tx);
  return { item: saveSettlement(item, { date: tx.date, fromId: personId, toId: ME, amountCents: tx.amountCents, txId: tx.id }, id, linked), tx: linked };
}

// --- Migració: despeses repartides a Deutes -> coses compartides ------------------------------

export interface DebtSplitMigration {
  shared: SharedItem[];
  txs: Transaction[];
  deleteDebtIds: string[];
}

/**
 * Abans, repartir una despesa creava un deute per persona (`Debt.expenseTxId`) i hi lligava els
 * Bizums. Ara és una cosa compartida puntual. Els ids són deterministes: si la migració es talla a
 * mitges, tornar-la a executar dona el mateix resultat.
 *
 * Si la despesa estava tancada ("ja no espero cobrar-ne més"), el que faltava passa a ser part teva.
 */
export function migrateDebtSplits(debts: Debt[], txs: Transaction[], createdAt: string): DebtSplitMigration {
  const byId = new Map(txs.map((t) => [t.id, t]));
  const groups = new Map<string, Debt[]>();
  for (const d of debts) if (d.expenseTxId) groups.set(d.expenseTxId, [...(groups.get(d.expenseTxId) ?? []), d]);
  const out: DebtSplitMigration = { shared: [], txs: [], deleteDebtIds: [] };

  for (const [expenseId, group] of groups) {
    group.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
    const expense = byId.get(expenseId);
    const people = new Map<string, SharedParticipant>();
    for (const d of group) {
      const key = personKey(d.person);
      if (!people.has(key)) people.set(key, { id: `p_mig_${people.size + 1}`, name: d.person.trim(), weight: 1 });
    }
    const pid = (d: Debt) => people.get(personKey(d.person))!.id;
    const closed = !!expense?.recoveryClosed;
    const shares: Record<string, Cents> = {};
    for (const d of group) shares[pid(d)] = (shares[pid(d)] ?? 0) + (closed ? Math.min(debtRepaid(d), d.amountCents) : d.amountCents);
    const othersCents = sum(Object.values(shares));
    const gross = expense && expense.amountCents < 0 ? -expense.amountCents : 0;
    const total = Math.max(gross, sum(group.map((d) => d.amountCents)));
    shares[ME] = total - othersCents;

    const item: SharedItem = {
      id: `shared_mig_${expenseId}`,
      name: expense?.description || group[0].reason || 'Despesa compartida',
      kind: 'oneoff',
      participants: [{ id: ME, name: 'Tu', weight: 1 }, ...people.values()],
      categoryId: expense?.categoryId,
      expenses: [
        {
          id: `se_mig_${expenseId}`,
          date: expense?.date ?? group[0].date,
          description: expense?.description || group[0].reason || 'Despesa',
          totalCents: total,
          paidBy: { [ME]: total },
          shares: clean(shares),
          txId: expense && gross === total ? expense.id : undefined,
        },
      ],
      settlements: group
        .flatMap((d) =>
          d.repayments.map((r) => ({
            id: `st_mig_${r.id}`,
            date: r.date,
            fromId: pid(d),
            toId: ME,
            amountCents: r.amountCents,
            txId: r.txId && byId.get(r.txId)?.amountCents === r.amountCents ? r.txId : undefined,
            note: r.note,
          })),
        )
        .sort((a, b) => a.date.localeCompare(b.date)),
      notes: 'Passat de Deutes a Compartit.',
      createdAt: expense?.date ?? group[0].date ?? createdAt,
    };
    if (closed && !item.settlements.length && othersCents === 0) item.archived = true;
    out.shared.push(item);
    if (item.expenses[0].txId) out.txs.push(txForLink(item, expense!));
    for (const s of item.settlements) {
      const t = s.txId ? byId.get(s.txId) : undefined;
      if (t) out.txs.push(txForLink(item, t));
    }
    out.deleteDebtIds.push(...group.map((d) => d.id));
  }
  return out;
}

const debtRepaid = (d: Debt) => sum(d.repayments.map((r) => r.amountCents));

// --- Consum real ---------------------------------------------------------------------------

export const SHARED_SUFFIX = '#compartit';

/**
 * Ajustos per a la vista de consum: per cada despesa compartida, la diferència entre el que
 * ha sortit del teu compte (moviment enllaçat) i la teva part, com a moviment virtual a la data de
 * la despesa; i els moviments de liquidació, que no són consum (ja és a la teva part).
 */
export function sharedConsumption(items: SharedItem[], txs: Transaction[]): { drop: Set<string>; derived: Transaction[] } {
  const byId = new Map(txs.map((t) => [t.id, t]));
  const drop = new Set<string>();
  const derived: Transaction[] = [];
  for (const item of items) {
    for (const e of expandExpenses(item, txs)) {
      const tx = e.txId ? byId.get(e.txId) : undefined;
      const fromAccount = tx && !tx.hidden ? -tx.amountCents : 0;
      const delta = fromAccount - (e.shares[ME] ?? 0);
      if (delta === 0) continue;
      derived.push({
        id: `${item.id}:${e.id}${SHARED_SUFFIX}`,
        accountId: tx?.accountId ?? '',
        date: e.date,
        amountCents: delta,
        feeCents: 0,
        currency: tx?.currency ?? 'EUR',
        description: `${item.name}: ${e.description}`,
        kind: delta > 0 ? 'reimbursement' : 'expense',
        categoryId: item.categoryId ?? tx?.categoryId,
        source: 'derived',
      });
    }
    for (const s of item.settlements) if (s.txId) drop.add(s.txId);
  }
  return { drop, derived };
}
