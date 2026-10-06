import { normalizeDate } from './dates';
import type { Cents } from './money';
import type { Account, Transaction, TransactionKind } from './types';

/** Tipus on entren diners (import positiu). */
const INFLOW_KINDS: TransactionKind[] = ['income', 'interest', 'refund', 'reimbursement'];

export interface ManualTransactionInput {
  accountId: string;
  date: string;
  /** Import en positiu: el signe el decideix el tipus. Per a 'adjustment' s'accepta amb signe. */
  amountCents: Cents;
  description: string;
  kind: Exclude<TransactionKind, 'transfer'>;
  categoryId?: string;
  notes?: string;
}

export function signedAmountFor(kind: TransactionKind, amountCents: Cents): Cents {
  if (kind === 'adjustment' || kind === 'transfer') return amountCents;
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

/** Aplica una edició de l'usuari (tipus, categoria, notes...) i la protegeix de reaplicar regles. */
export function editTransaction(tx: Transaction, patch: Partial<Omit<Transaction, 'id' | 'source'>>): Transaction {
  const next: Transaction = { ...tx, ...patch, userEdited: true, needsReview: false };
  if (patch.kind && patch.amountCents === undefined && tx.source === 'manual') {
    next.amountCents = signedAmountFor(patch.kind, tx.amountCents);
  }
  return next;
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
    if (next.kind === 'transfer' || next.kind === 'adjustment') delete next.categoryId;
    return next;
  });
}
