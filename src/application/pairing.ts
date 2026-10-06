import { secondsBetween } from '../domain/dates';
import type { Transaction } from '../domain/types';

/**
 * Aparella les dues potes d'un traspàs intern dins de la mateixa importació
 * (p.ex. Current -50 "To Savings Challenge" / Deposit +50). Les marca com a 'transfer'.
 */
export function pairInternalTransfers(txs: Transaction[], maxSeconds = 180): Transaction[] {
  const out = txs.map((t) => ({ ...t }));
  const candidates = out.filter((t) => t.bankType === 'Transfer' && t.amountCents !== 0 && !t.transferGroupId);
  for (const a of candidates) {
    if (a.transferGroupId) continue;
    const b = candidates.find(
      (c) =>
        c !== a &&
        !c.transferGroupId &&
        c.accountId !== a.accountId &&
        c.amountCents === -a.amountCents &&
        Math.abs(secondsBetween(a.date, c.date)) <= maxSeconds,
    );
    if (!b) continue;
    const group = `tg_${a.id}`;
    for (const t of [a, b]) {
      t.kind = 'transfer';
      t.categoryId = undefined;
      t.transferGroupId = group;
      t.needsReview = false;
    }
  }
  return out;
}

/**
 * "Revert of: Bizum payment to: X" anul·la el moviment anterior amb la mateixa descripció i
 * import contrari. S'amaguen tots dos (el net és 0 i continuen quadrant el saldo).
 */
export function pairReverts(txs: Transaction[]): Transaction[] {
  const out = txs.map((t) => ({ ...t }));
  const PREFIX = 'Revert of: ';
  for (const rev of out) {
    if (!rev.description.startsWith(PREFIX) || rev.transferGroupId) continue;
    const originalDesc = rev.description.slice(PREFIX.length);
    const original = out
      .filter(
        (t) =>
          !t.transferGroupId &&
          t.accountId === rev.accountId &&
          t.description === originalDesc &&
          t.amountCents === -rev.amountCents &&
          t.date <= rev.date,
      )
      .sort((a, b) => b.date.localeCompare(a.date))[0];
    if (!original) continue;
    const group = `rv_${rev.id}`;
    for (const t of [rev, original]) {
      t.hidden = true;
      t.transferGroupId = group;
      t.needsReview = false;
    }
  }
  return out;
}
