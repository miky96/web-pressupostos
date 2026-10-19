import { normalizeDate } from './dates';
import type { Cents } from './money';
import { isNeutralKind, type Account, type Transaction, type TransactionKind } from './types';

/** Tipus on entren diners (import positiu). */
const INFLOW_KINDS: TransactionKind[] = ['income', 'interest', 'refund', 'reimbursement'];

export interface ManualTransactionInput {
  accountId: string;
  date: string;
  /** Import en positiu: el signe el decideix el tipus. Per a 'adjustment' i 'loan' s'accepta amb signe. */
  amountCents: Cents;
  description: string;
  kind: Exclude<TransactionKind, 'transfer'>;
  categoryId?: string;
  notes?: string;
}

export function signedAmountFor(kind: TransactionKind, amountCents: Cents): Cents {
  if (kind === 'adjustment' || kind === 'transfer' || kind === 'loan') return amountCents;
  const abs = Math.abs(amountCents);
  return INFLOW_KINDS.includes(kind) ? abs : -abs;
}

/** Despesa, ingrés, cobrament en efectiu... que no surt a cap export. */
export function createManualTransaction(input: ManualTransactionInput, account: Account, id: string): Transaction {
  if (input.amountCents === 0 && input.kind !== 'adjustment') throw new Error("L'import no pot ser 0");
  if (!input.description.trim()) throw new Error('Cal una descripció');
  return {
    id,
    accountId: account.id,
    date: normalizeDate(input.date),
    amountCents: signedAmountFor(input.kind, input.amountCents),
    feeCents: 0,
    currency: account.currency,
    description: input.description.trim(),
    kind: input.kind,
    categoryId: input.categoryId,
    notes: input.notes,
    source: 'manual',
    userEdited: true,
  };
}

export interface ManualTransferInput {
  fromAccountId: string;
  toAccountId: string;
  date: string;
  amountCents: Cents;
  description: string;
  notes?: string;
}

/** Traspàs entre dos comptes propis: genera les dues potes enllaçades. */
export function createManualTransfer(
  input: ManualTransferInput,
  from: Account,
  to: Account,
  ids: [string, string],
): [Transaction, Transaction] {
  if (from.id === to.id) throw new Error('El compte d\'origen i destí han de ser diferents');
  if (input.amountCents <= 0) throw new Error("L'import ha de ser positiu");
  const date = normalizeDate(input.date);
  const groupId = `tg_${ids[0]}`;
  const base = {
    date,
    feeCents: 0,
    description: input.description.trim() || `Traspàs ${from.name} → ${to.name}`,
    kind: 'transfer' as const,
    notes: input.notes,
    source: 'manual' as const,
    transferGroupId: groupId,
    userEdited: true,
  };
  return [
    { ...base, id: ids[0], accountId: from.id, currency: from.currency, amountCents: -input.amountCents },
    { ...base, id: ids[1], accountId: to.id, currency: to.currency, amountCents: input.amountCents },
  ];
}

export interface ManualDetails {
  description?: string;
  /** En positiu: el signe es manté (o el decideix el tipus). */
  amountCents?: Cents;
  date?: string;
  accountId?: string;
}

/**
 * Corregeix un moviment apuntat a mà (import, data, descripció, compte). Els importats no es
 * poden tocar: ho diu l'extracte. En un traspàs, l'import i la data s'apliquen a les dues potes.
 * Retorna tots els moviments que canvien.
 */
export function editManualDetails(tx: Transaction, details: ManualDetails, all: Transaction[] = []): Transaction[] {
  if (tx.source !== 'manual') throw new Error("Només es poden corregir els moviments afegits a mà");
  const patch: Partial<Transaction> = {};
  if (details.description !== undefined) {
    if (!details.description.trim()) throw new Error('Cal una descripció');
    patch.description = details.description.trim();
  }
  if (details.date !== undefined) patch.date = normalizeDate(details.date.length === 10 ? `${details.date}${tx.date.slice(10)}` : details.date);
  if (details.accountId !== undefined) patch.accountId = details.accountId;
  if (details.amountCents !== undefined) {
    const abs = Math.abs(details.amountCents);
    if (abs === 0 && tx.kind !== 'adjustment') throw new Error("L'import no pot ser 0");
    const sign = tx.amountCents < 0 ? -1 : 1;
    patch.amountCents = isNeutralKind(tx.kind) ? sign * abs : signedAmountFor(tx.kind, abs);
  }
  // La pota d'un altre compte que ve d'un extracte no es toca.
  const legs = tx.transferGroupId ? all.filter((t) => t.transferGroupId === tx.transferGroupId && t.id !== tx.id && t.source !== 'import') : [];
  const out = [editTransaction(tx, patch)];
  for (const leg of legs) {
    const p: Partial<Transaction> = {};
    if (patch.date) p.date = patch.date;
    if (patch.amountCents !== undefined) p.amountCents = -patch.amountCents;
    if (patch.description) p.description = patch.description;
    if (Object.keys(p).length) out.push(editTransaction(leg, p));
  }
  return out;
}

/** Aplica una edició de l'usuari (tipus, categoria, notes...) i la protegeix de reaplicar regles. */
export function editTransaction(tx: Transaction, patch: Partial<Omit<Transaction, 'id' | 'source'>>): Transaction {
  const next: Transaction = { ...tx, ...patch, userEdited: true, needsReview: false };
  if (patch.kind && patch.amountCents === undefined && tx.source === 'manual') {
    next.amountCents = signedAmountFor(patch.kind, tx.amountCents);
  }
  // Els enllaços de recuperació només tenen sentit en el tipus que toca.
  if (next.kind !== 'refund' && next.kind !== 'reimbursement') delete next.recoversTxId;
  if (next.kind !== 'expense') {
    delete next.expectedBackCents;
    delete next.recoveryClosed;
  }
  return next;
}

const normDesc = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Per a l'alta manual: si ja has apuntat (o importat) un moviment amb la mateixa descripció,
 * en proposa el tipus, la categoria i el compte (el més recent mana).
 */
export function suggestFromHistory(
  description: string,
  txs: Transaction[],
): { kind: TransactionKind; categoryId?: string; accountId: string } | undefined {
  const key = normDesc(description);
  if (key.length < 3) return undefined;
  let best: Transaction | undefined;
  for (const t of txs) {
    if (t.hidden || t.source === 'derived' || isNeutralKind(t.kind) || normDesc(t.description) !== key) continue;
    if (!best || t.date > best.date) best = t;
  }
  return best && { kind: best.kind, categoryId: best.categoryId, accountId: best.accountId };
}

/** Descripcions usades abans (per autocompletar), de les més freqüents a les menys. */
export function knownDescriptions(txs: Transaction[], limit = 200): string[] {
  const counts = new Map<string, { text: string; n: number }>();
  for (const t of txs) {
    if (t.hidden || t.source === 'derived' || t.source === 'import') continue;
    const k = normDesc(t.description);
    const c = counts.get(k);
    if (c) c.n++;
    else counts.set(k, { text: t.description, n: 1 });
  }
  return [...counts.values()].sort((a, b) => b.n - a.n).slice(0, limit).map((c) => c.text);
}

/** Canvis en bloc. Un camp `undefined` vol dir "no el toquis". */
export interface BulkPatch {
  kind?: TransactionKind;
  /** null = treure la categoria */
  categoryId?: string | null;
  /** null = esborrar les notes */
  notes?: string | null;
  /** true = afegeix el text a les notes existents en lloc de substituir-les */
  appendNotes?: boolean;
}

/**
 * Aplica el mateix canvi a diversos moviments. Sempre els marca com a revisats i editats per
 * l'usuari (un patch buit serveix per "marcar com a revisats"). Els traspassos i ajustos no
 * porten categoria.
 */
export function bulkEditTransactions(txs: Transaction[], patch: BulkPatch): Transaction[] {
  return txs.map((tx) => {
    const p: Partial<Transaction> = {};
    if (patch.kind) p.kind = patch.kind;
    if (patch.categoryId !== undefined) p.categoryId = patch.categoryId ?? undefined;
    if (patch.notes !== undefined) {
      const text = patch.notes?.trim() ?? '';
      p.notes = patch.appendNotes && tx.notes && text ? `${tx.notes} · ${text}` : text || (patch.appendNotes ? tx.notes : undefined);
    }
    const next = editTransaction(tx, p);
    if (isNeutralKind(next.kind)) delete next.categoryId;
    return next;
  });
}
