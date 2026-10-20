/**
 * Moviments apuntats a mà que després arriben amb un extracte.
 *
 * Apuntar a mà i importar són igual de vàlids: si un moviment importat és el mateix que un de manual
 * (mateix compte, mateix import, dates properes), es fusionen. Es queda el de l'extracte (que quadra
 * el saldo i no es tornarà a importar) amb el que l'usuari hi havia posat: tipus, categoria, notes,
 * descripció i enllaços (Bizums d'un sopar, deutes...).
 */
import { daysBetween } from './dates';
import { descriptionTokens } from './recoveries';
import { remapSharedRefs } from './shared';
import { isPlaceholder } from './subscriptions';
import type { Debt, SharedItem, Transaction } from './types';

export interface ManualMatch {
  manual: Transaction;
  imported: Transaction;
}

const day = (iso: string) => `${iso.slice(0, 10)}T00:00:00`;
const isBizum = (t: Transaction) => /bizum/i.test(`${t.description} ${t.notes ?? ''}`);

function shareTokens(a: Transaction, b: Transaction): boolean {
  const ta = descriptionTokens(`${a.description} ${a.notes ?? ''}`);
  for (const w of descriptionTokens(b.description)) if (ta.has(w)) return true;
  return false;
}

/**
 * Parelles manual -> importat. Import exacte i, com a molt, 4 dies de diferència (10 si són Bizums o
 * la descripció coincideix: sovint no recordes el dia exacte d'un Bizum). Cada moviment es fa servir
 * una sola vegada; primer les parelles més properes.
 */
export function matchManualEntries(incoming: Transaction[], existing: Transaction[], maxDays = 4): ManualMatch[] {
  const accounts = new Set(incoming.map((t) => t.accountId));
  const manual = existing.filter((t) => t.source === 'manual' && !isPlaceholder(t) && !t.hidden && accounts.has(t.accountId));
  const imported = incoming.filter((t) => t.source === 'import' && !t.hidden && t.amountCents !== 0);
  const pairs: { manual: Transaction; imported: Transaction; score: number }[] = [];
  for (const m of manual) {
    for (const i of imported) {
      if (i.accountId !== m.accountId || i.amountCents !== m.amountCents) continue;
      if (m.transferGroupId && i.transferGroupId) continue;
      const similar = shareTokens(m, i);
      const days = Math.abs(daysBetween(day(m.date), day(i.date)));
      if (days > (similar || (isBizum(i) && m.amountCents > 0) ? 10 : maxDays)) continue;
      pairs.push({ manual: m, imported: i, score: days - (similar ? 0.5 : 0) });
    }
  }
  pairs.sort((a, b) => a.score - b.score);
  const usedM = new Set<string>();
  const usedI = new Set<string>();
  const out: ManualMatch[] = [];
  for (const p of pairs) {
    if (usedM.has(p.manual.id) || usedI.has(p.imported.id)) continue;
    usedM.add(p.manual.id);
    usedI.add(p.imported.id);
    out.push({ manual: p.manual, imported: p.imported });
  }
  return out;
}

/** El moviment del banc amb les dades que l'usuari havia posat al manual. */
export function mergeManual(manual: Transaction, imported: Transaction): Transaction {
  const bankNote = manual.description.trim().toLowerCase() === imported.description.trim().toLowerCase() ? undefined : `Banc: ${imported.description}`;
  // Un traspàs que l'extracte ja ha aparellat continua sent traspàs.
  const keepBankKind = !!imported.transferGroupId;
  const merged: Transaction = {
    ...imported,
    kind: keepBankKind ? imported.kind : manual.kind,
    categoryId: keepBankKind ? imported.categoryId : manual.categoryId,
    description: manual.description,
    notes: [manual.notes, bankNote].filter(Boolean).join(' · ') || undefined,
    expectedBackCents: manual.expectedBackCents,
    recoveryClosed: manual.recoveryClosed,
    recoversTxId: manual.recoversTxId,
    transferGroupId: imported.transferGroupId ?? manual.transferGroupId,
    subscriptionId: imported.subscriptionId ?? manual.subscriptionId,
    userEdited: true,
  };
  delete merged.needsReview;
  for (const k of Object.keys(merged) as (keyof Transaction)[]) if (merged[k] === undefined) delete merged[k];
  return merged;
}

/** Canvia les referències a moviments (enllaços de recuperació i deutes) d'un id antic a un de nou. */
export function remapTxRefs(map: Map<string, string>, txs: Transaction[], debts: Debt[]): { txs: Transaction[]; debts: Debt[] } {
  const to = (id?: string) => (id && map.has(id) ? map.get(id) : id);
  const outTxs = txs.filter((t) => t.recoversTxId && map.has(t.recoversTxId)).map((t) => ({ ...t, recoversTxId: to(t.recoversTxId) }));
  const outDebts = debts
    .filter((d) => [d.txId, ...d.repayments.map((r) => r.txId)].some((id) => id && map.has(id)))
    .map((d) => ({
      ...d,
      txId: to(d.txId),
      repayments: d.repayments.map((r) => ({ ...r, txId: to(r.txId) })),
    }));
  return { txs: outTxs, debts: outDebts };
}

export interface ManualReconciliation {
  /** Moviments importats, amb els fusionats ja amb les dades del manual. */
  transactions: Transaction[];
  matches: ManualMatch[];
  /** Moviments manuals substituïts (cal esborrar-los). */
  replacedIds: string[];
  /** Moviments existents i deutes que apuntaven als manuals substituïts. */
  updatedTransactions: Transaction[];
  updatedDebts: Debt[];
  updatedShared: SharedItem[];
}

export function reconcileManual(incoming: Transaction[], existing: Transaction[], debts: Debt[], shared: SharedItem[] = []): ManualReconciliation {
  const matches = matchManualEntries(incoming, existing);
  const map = new Map(matches.map((m) => [m.manual.id, m.imported.id]));
  const mergedById = new Map(matches.map((m) => [m.imported.id, mergeManual(m.manual, m.imported)]));
  let transactions = incoming.map((t) => mergedById.get(t.id) ?? t);
  // Un Bizum fusionat pot apuntar a un sopar que també s'ha fusionat.
  transactions = transactions.map((t) => (t.recoversTxId && map.has(t.recoversTxId) ? { ...t, recoversTxId: map.get(t.recoversTxId) } : t));
  const remapped = remapTxRefs(map, existing.filter((t) => !map.has(t.id)), debts);
  return {
    transactions,
    matches,
    replacedIds: [...map.keys()],
    updatedTransactions: remapped.txs,
    updatedDebts: remapped.debts,
    updatedShared: remapSharedRefs(map, shared),
  };
}
