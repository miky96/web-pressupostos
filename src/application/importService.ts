import { classify, type MirrorTarget, type Rule } from '../domain/classification';
import type { AccountType, Transaction, TransactionKind } from '../domain/types';
import type { ImportIssue, ImportResult } from '../importers/types';
import { pairInternalTransfers, pairReverts } from './pairing';

export interface RequiredAccount {
  key: string;
  suggestedName: string;
  suggestedType: AccountType;
  currency: string;
  /** true si l'export no inclou els seus moviments (només en veiem els traspassos). */
  mirrorOnly: boolean;
}

interface Built {
  txs: Transaction[];
  /** Comptes "mirror" realment utilitzats (traspassos sense parella dins del fitxer). */
  mirrors: Map<string, MirrorTarget & { currency: string }>;
}

/**
 * Pipeline: classificar -> aparellar traspassos i anul·lacions -> crear la pota contrària
 * NOMÉS per als traspassos que no han trobat parella dins del fitxer (comptes que l'export no inclou).
 */
function build(result: ImportResult, rules: Rule[], accountFor: (key: string) => string): Built {
  const mirrorOf = new Map<string, MirrorTarget>();
  let txs: Transaction[] = result.rows.map((row) => {
    const c = classify(row, rules);
    if (c.mirrorTo) mirrorOf.set(row.externalId, c.mirrorTo);
    return {
      id: row.externalId,
      accountId: accountFor(row.accountKey),
      date: row.date,
      amountCents: row.amountCents,
      feeCents: row.feeCents,
      currency: row.currency,
      description: row.description,
      kind: c.kind,
      categoryId: c.categoryId,
      source: 'import',
      bankType: row.bankType,
      balanceAfterCents: row.balanceAfterCents,
      hidden: c.hidden || undefined,
      needsReview: c.needsReview || undefined,
    };
  });

  // Els que tenen regla "mirror" no participen a l'aparellament genèric si no troben parella.
  txs = pairReverts(pairInternalTransfers(txs));

  const mirrors: Built['mirrors'] = new Map();
  const derived: Transaction[] = [];
  for (const tx of txs) {
    const target = mirrorOf.get(tx.id);
    if (!target || tx.transferGroupId || tx.amountCents === 0) continue;
    mirrors.set(target.accountKey, { ...target, currency: tx.currency });
    tx.transferGroupId = `tg_${tx.id}`;
    derived.push({
      id: `${tx.id}_m`,
      accountId: accountFor(target.accountKey),
      date: tx.date,
      amountCents: -tx.amountCents,
      feeCents: 0,
      currency: tx.currency,
      description: tx.description,
      kind: 'transfer',
      source: 'derived',
      transferGroupId: tx.transferGroupId,
    });
  }
  txs = [...txs, ...derived];
  for (const t of txs) if (!t.needsReview) delete t.needsReview;
  return { txs, mirrors };
}

/** Comptes que la importació necessita: els que apareixen al fitxer + els comptes "mirror" utilitzats. */
export function requiredAccounts(result: ImportResult, rules: Rule[]): RequiredAccount[] {
  const map = new Map<string, RequiredAccount>();
  for (const a of result.accounts) {
    map.set(a.key, { key: a.key, suggestedName: a.suggestedName, suggestedType: a.suggestedType, currency: a.currency, mirrorOnly: false });
  }
  for (const m of build(result, rules, (key) => key).mirrors.values()) {
    if (!map.has(m.accountKey)) {
      map.set(m.accountKey, {
        key: m.accountKey,
        suggestedName: m.suggestedName,
        suggestedType: m.suggestedType,
        currency: m.currency,
        mirrorOnly: true,
      });
    }
  }
  return [...map.values()];
}

export interface ImportContext {
  rules: Rule[];
  /** Clau d'importació -> id del compte a l'app. Ha d'incloure tots els requiredAccounts. */
  accountIdByKey: Record<string, string>;
  /** Ids de moviments que ja existeixen (per no duplicar). */
  existingIds: Set<string>;
}

export interface ImportPlan {
  /** Moviments nous a guardar. */
  transactions: Transaction[];
  duplicates: number;
  needsReview: number;
  byKind: Record<TransactionKind, number>;
  skipped: ImportResult['skipped'];
  issues: ImportIssue[];
}

export function planImport(result: ImportResult, ctx: ImportContext): ImportPlan {
  const { txs } = build(result, ctx.rules, (key) => {
    const id = ctx.accountIdByKey[key];
    if (!id) throw new Error(`Falta el compte per a ${key}`);
    return id;
  });

  const fresh = txs.filter((t) => !ctx.existingIds.has(t.id));
  const byKind = { expense: 0, income: 0, transfer: 0, interest: 0, refund: 0, reimbursement: 0, loan: 0, adjustment: 0 };
  for (const t of fresh) byKind[t.kind]++;

  return {
    transactions: fresh,
    duplicates: txs.length - fresh.length,
    needsReview: fresh.filter((t) => t.needsReview).length,
    byKind,
    skipped: result.skipped,
    issues: result.issues,
  };
}

/**
 * Torna a aplicar les regles als moviments importats que l'usuari no ha editat
 * (p.ex. després de crear una regla nova). Els traspassos aparellats no es toquen.
 */
export function reclassify(txs: Transaction[], rules: Rule[], accountKeyById: Record<string, string>): Transaction[] {
  return txs.map((t) => {
    if (t.source !== 'import' || t.userEdited || t.transferGroupId) return t;
    const c = classify({ ...t, accountKey: accountKeyById[t.accountId] }, rules);
    const next: Transaction = { ...t, kind: c.kind, categoryId: c.categoryId, hidden: c.hidden || undefined };
    if (c.needsReview) next.needsReview = true;
    else delete next.needsReview;
    return next;
  });
}
