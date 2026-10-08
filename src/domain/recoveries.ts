/**
 * Recuperacions: devolucions i reemborsaments enllaçats a la despesa original, i despeses de
 * les quals esperes recuperar una part (sopars, entrades... pagats per a altres).
 *
 * Dues vistes dels mateixos moviments:
 *   - 'cash'        (flux de caixa): cada moviment compta a la seva data, com al banc.
 *   - 'consumption' (consum real):   les recuperacions enllaçades compten a la data i la categoria
 *                                    de la despesa original, i el que esperes recuperar ja no
 *                                    compta com a despesa teva des del primer dia.
 * Els saldos i el patrimoni no canvien mai: només canvia a quin període s'atribueix cada import.
 */
import { secondsBetween } from './dates';
import type { Cents } from './money';
import { editTransaction } from './transactions';
import type { Debt, Transaction, TransactionKind } from './types';

export type ReportingView = 'consumption' | 'cash';

const RECOVERY_KINDS: TransactionKind[] = ['refund', 'reimbursement'];

export const isRecovery = (t: Transaction) => RECOVERY_KINDS.includes(t.kind) && t.amountCents > 0;
export const isRecoverableExpense = (t: Transaction) => t.kind === 'expense' && t.amountCents < 0;

/** Recuperacions (no amagades) agrupades per la despesa que recuperen. */
export function recoveriesByExpense(txs: Transaction[]): Map<string, Transaction[]> {
  const out = new Map<string, Transaction[]>();
  for (const t of txs) {
    if (t.hidden || !t.recoversTxId || !isRecovery(t)) continue;
    const list = out.get(t.recoversTxId);
    if (list) list.push(t);
    else out.set(t.recoversTxId, [t]);
  }
  return out;
}

export interface RecoveryStatus {
  expense: Transaction;
  /** Import de la despesa, en positiu. */
  grossCents: Cents;
  expectedCents: Cents;
  recoveredCents: Cents;
  /** El que encara esperes cobrar (0 si està tancada o ja s'ha cobrat tot). */
  pendingCents: Cents;
  /** El que finalment et costa: brut - max(esperat pendent, recuperat). */
  ownCents: Cents;
  recoveries: Transaction[];
}

export function recoveryStatus(expense: Transaction, recoveries: Transaction[] = []): RecoveryStatus {
  const grossCents = -expense.amountCents;
  const expectedCents = expense.expectedBackCents ?? 0;
  const recoveredCents = recoveries.reduce((s, r) => s + r.amountCents, 0);
  const pendingCents = expense.recoveryClosed ? 0 : Math.max(0, expectedCents - recoveredCents);
  return {
    expense,
    grossCents,
    expectedCents,
    recoveredCents,
    pendingCents,
    ownCents: grossCents - recoveredCents - pendingCents,
    recoveries: [...recoveries].sort((a, b) => a.date.localeCompare(b.date)),
  };
}

/** Despeses amb alguna cosa pendent de recuperar, de la més antiga a la més nova. */
export function pendingRecoveries(txs: Transaction[]): RecoveryStatus[] {
  const index = recoveriesByExpense(txs);
  return txs
    .filter((t) => !t.hidden && isRecoverableExpense(t) && (t.expectedBackCents ?? 0) > 0)
    .map((t) => recoveryStatus(t, index.get(t.id)))
    .filter((s) => s.pendingCents > 0)
    .sort((a, b) => a.expense.date.localeCompare(b.expense.date));
}

/** Prefix dels ids dels moviments virtuals que representen el pendent de recuperar. */
export const PENDING_SUFFIX = '#pendent';

/**
 * Moviments tal com s'han de comptar a la vista triada. A 'consumption':
 *  - una recuperació enllaçada pren la data i la categoria de la seva despesa;
 *  - cada despesa amb pendent de recuperar genera un reemborsament virtual (source 'derived')
 *    per aquest import, a la mateixa data i categoria.
 * Així `summarize`, `netExpenseByCategory` i les gràfiques no han de saber res de recuperacions.
 * No s'ha de fer servir per als saldos ni per als llistats.
 */
export function attributeForView(txs: Transaction[], view: ReportingView): Transaction[] {
  if (view === 'cash') return txs;
  const byId = new Map(txs.map((t) => [t.id, t]));
  const index = recoveriesByExpense(txs);
  const out: Transaction[] = [];
  for (const t of txs) {
    const target = t.recoversTxId ? byId.get(t.recoversTxId) : undefined;
    if (target && !t.hidden && !target.hidden && isRecovery(t) && isRecoverableExpense(target)) {
      out.push({ ...t, date: target.date, categoryId: target.categoryId ?? t.categoryId });
    } else {
      out.push(t);
    }
    if (!t.hidden && isRecoverableExpense(t) && (t.expectedBackCents ?? 0) > 0) {
      const { pendingCents } = recoveryStatus(t, index.get(t.id));
      if (pendingCents > 0) {
        out.push({
          id: `${t.id}${PENDING_SUFFIX}`,
          accountId: t.accountId,
          date: t.date,
          amountCents: pendingCents,
          feeCents: 0,
          currency: t.currency,
          description: t.description,
          kind: 'reimbursement',
          categoryId: t.categoryId,
          source: 'derived',
        });
      }
    }
  }
  return out;
}

/**
 * Recuperacions que la vista de consum compta en un altre període: les que van entrar dins de
 * [from, to] però recuperen una despesa de fora. Serveix per explicar per què no surten al total.
 */
export function recoveriesAttributedElsewhere(txs: Transaction[], range: { from?: string; to?: string }): Cents {
  const byId = new Map(txs.map((t) => [t.id, t]));
  const inRange = (d: string) => (!range.from || d >= range.from) && (!range.to || d <= range.to);
  let cents = 0;
  for (const t of txs) {
    const target = t.recoversTxId ? byId.get(t.recoversTxId) : undefined;
    if (!target || t.hidden || target.hidden || !isRecovery(t) || !isRecoverableExpense(target)) continue;
    if (inRange(t.date) && !inRange(target.date)) cents += t.amountCents;
  }
  return cents;
}

// --- Edició ------------------------------------------------------------------------------

/** Enllaça una entrada de diners a la despesa que recupera. Hereta la categoria de la despesa. */
export function linkRecovery(recovery: Transaction, expense: Transaction, txs: Transaction[]): Transaction {
  if (recovery.amountCents <= 0) throw new Error('Només es poden enllaçar entrades de diners');
  if (!isRecoverableExpense(expense)) throw new Error('Només es pot enllaçar a una despesa');
  if (expense.id === recovery.id) throw new Error('Un moviment no es pot recuperar a si mateix');
  const others = (recoveriesByExpense(txs).get(expense.id) ?? []).filter((r) => r.id !== recovery.id);
  const already = others.reduce((s, r) => s + r.amountCents, 0);
  if (already + recovery.amountCents > -expense.amountCents) {
    throw new Error('Amb aquest moviment es recuperaria més del que va costar la despesa');
  }
  const kind: TransactionKind = recovery.kind === 'refund' ? 'refund' : 'reimbursement';
  return editTransaction(recovery, { kind, recoversTxId: expense.id, categoryId: expense.categoryId ?? recovery.categoryId });
}

export function unlinkRecovery(recovery: Transaction): Transaction {
  return editTransaction(recovery, { recoversTxId: undefined });
}

/** Desa quant esperes recuperar d'una despesa (0 = res). */
export function setExpectedBack(expense: Transaction, expectedCents: Cents): Transaction {
  if (!isRecoverableExpense(expense)) throw new Error('Només les despeses poden tenir una recuperació esperada');
  if (expectedCents < 0) throw new Error("L'import no pot ser negatiu");
  if (expectedCents > -expense.amountCents) throw new Error('No pots esperar recuperar més del que va costar');
  return editTransaction(expense, { expectedBackCents: expectedCents || undefined, recoveryClosed: expectedCents ? expense.recoveryClosed : undefined });
}

export function setRecoveryClosed(expense: Transaction, closed: boolean): Transaction {
  return editTransaction(expense, { recoveryClosed: closed || undefined });
}

/**
 * Enllaços que cal netejar quan s'eliminen moviments: recuperacions que apuntaven a una despesa
 * eliminada i deutes amb el moviment d'origen o algun retorn eliminat.
 */
export function cleanupLinks(deletedIds: Set<string>, txs: Transaction[], debts: Debt[]): { txs: Transaction[]; debts: Debt[] } {
  const txOut = txs
    .filter((t) => !deletedIds.has(t.id) && t.recoversTxId && deletedIds.has(t.recoversTxId))
    .map((t) => ({ ...t, recoversTxId: undefined }));
  const debtOut: Debt[] = [];
  for (const d of debts) {
    const touches = (d.txId && deletedIds.has(d.txId)) || d.repayments.some((r) => r.txId && deletedIds.has(r.txId));
    if (!touches) continue;
    debtOut.push({
      ...d,
      txId: d.txId && deletedIds.has(d.txId) ? undefined : d.txId,
      repayments: d.repayments.map((r) => (r.txId && deletedIds.has(r.txId) ? { ...r, txId: undefined } : r)),
    });
  }
  return { txs: txOut, debts: debtOut };
}

// --- Suggeriments ------------------------------------------------------------------------

const STOPWORDS = new Set([
  'payment', 'bizum', 'money', 'added', 'via', 'revert', 'return', 'refund', 'card', 'from', 'purchase', 'transfer', 'the', 'and', 'des', 'del', 'per',
]);

/** Paraules significatives d'una descripció (sense prefixos de banc ni accents). */
export function descriptionTokens(description: string): Set<string> {
  const plain = description
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
  return new Set((plain.match(/[a-z0-9]{3,}/g) ?? []).filter((w) => !STOPWORDS.has(w)));
}

function similarity(a: string, b: string): number {
  const ta = descriptionTokens(a);
  const tb = descriptionTokens(b);
  if (!ta.size || !tb.size) return 0;
  let common = 0;
  for (const w of ta) if (tb.has(w)) common++;
  return common / Math.min(ta.size, tb.size);
}

const DAY = 86400;
const daysBetween = (a: string, b: string) => secondsBetween(a, b) / DAY;

export type LinkSuggestion =
  | { type: 'expense'; expense: Transaction; status: RecoveryStatus; score: number; reason: string }
  | { type: 'debt'; debt: Debt; pendingCents: Cents; score: number; reason: string };

export interface SuggestOptions {
  /** Quants dies enrere es busca la despesa original. */
  maxDaysBefore?: number;
  /** Bizums que arriben abans de pagar (p.ex. entrades que t'avancen). */
  maxDaysAfter?: number;
  limit?: number;
}

/** L'entrada ja està enllaçada a una despesa o és el retorn d'un deute. */
export function isLinkedIncoming(tx: Transaction, debts: Debt[]): boolean {
  return !!tx.recoversTxId || debts.some((d) => d.repayments.some((r) => r.txId === tx.id));
}

/**
 * Proposa a què correspon una entrada de diners (devolució, Bizum...): una despesa recent o un
 * deute obert. Només són suggeriments: l'usuari els ha de confirmar.
 */
export function suggestLinks(
  tx: Transaction,
  txs: Transaction[],
  debts: Debt[],
  { maxDaysBefore = 180, maxDaysAfter = 14, limit = 3 }: SuggestOptions = {},
): LinkSuggestion[] {
  if (tx.amountCents <= 0 || tx.hidden || !RECOVERY_KINDS.includes(tx.kind) || isLinkedIncoming(tx, debts)) return [];
  const index = recoveriesByExpense(txs);
  const out: LinkSuggestion[] = [];
  const bizum = /bizum/i.test(tx.description);

  for (const e of txs) {
    if (e.hidden || !isRecoverableExpense(e) || e.id === tx.id) continue;
    const days = daysBetween(e.date, tx.date); // positiu: la despesa és anterior
    if (days > maxDaysBefore || days < -maxDaysAfter) continue;
    const status = recoveryStatus(e, index.get(e.id));
    if (status.recoveredCents + tx.amountCents > status.grossCents) continue;
    const sim = similarity(tx.description, e.description);
    const open = status.pendingCents > 0;
    // Una devolució de targeta ha de ser del mateix comerç; un Bizum ha d'anar a una despesa
    // de la qual esperes recuperar diners (o que coincideixi exactament).
    const exact = tx.amountCents === status.grossCents || tx.amountCents === status.pendingCents;
    if (tx.kind === 'refund' && !bizum && sim === 0 && !(exact && days <= 30)) continue;
    if (tx.kind === 'reimbursement' && !open && sim === 0) continue;
    let score = 0.5 * sim + 0.15 * Math.max(0, 1 - Math.abs(days) / maxDaysBefore);
    if (open && tx.amountCents <= status.pendingCents) score += 0.35;
    if (exact) score += 0.3;
    if (score < 0.3) continue;
    const reason = [sim > 0 && 'mateix comerç', open && 'pendent de recuperar', exact && 'import exacte']
      .filter(Boolean)
      .join(' · ');
    out.push({ type: 'expense', expense: e, status, score, reason: reason || 'despesa recent' });
  }

  for (const d of debts) {
    const pending = d.amountCents - d.repayments.reduce((s, r) => s + r.amountCents, 0);
    if (pending < tx.amountCents) continue;
    const days = daysBetween(d.date, tx.date);
    if (days < -maxDaysAfter) continue;
    const nameHit = [...descriptionTokens(d.person)].some((w) => descriptionTokens(tx.description).has(w));
    const exact = pending === tx.amountCents;
    const score = 0.25 + (nameHit ? 0.4 : 0) + (exact ? 0.3 : 0);
    const reason = [nameHit && 'mateix nom', exact ? 'el salda' : 'deute obert'].filter(Boolean).join(' · ');
    out.push({ type: 'debt', debt: d, pendingCents: pending, score, reason });
  }

  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}

/** Entrades sense enllaçar que podrien ser retorns d'aquest deute (per al calaix del deute). */
export function suggestRepaymentTxs(debt: Debt, txs: Transaction[], debts: Debt[], limit = 5): Transaction[] {
  const pending = debt.amountCents - debt.repayments.reduce((s, r) => s + r.amountCents, 0);
  return txs
    .filter(
      (t) =>
        !t.hidden &&
        t.amountCents > 0 &&
        t.amountCents <= pending &&
        RECOVERY_KINDS.includes(t.kind) &&
        daysBetween(debt.date, t.date) >= -14 &&
        !isLinkedIncoming(t, debts),
    )
    .map((t) => {
      const nameHit = [...descriptionTokens(debt.person)].some((w) => descriptionTokens(t.description).has(w));
      return { t, score: (nameHit ? 0.4 : 0) + (t.amountCents === pending ? 0.3 : 0) - Math.abs(daysBetween(debt.date, t.date)) / 3650 };
    })
    .sort((a, b) => b.score - a.score || a.t.date.localeCompare(b.t.date))
    .slice(0, limit)
    .map((x) => x.t);
}
