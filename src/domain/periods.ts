import type { Transaction } from './types';

/** Període que es mostra a la vista de moviments. */
export type Period =
  | { kind: 'month'; month: string } // "2026-10"
  | { kind: 'year'; year: string } // "2026"
  | { kind: 'all' }
  | { kind: 'range'; from?: string; to?: string }; // "YYYY-MM-DD"

export function periodRange(p: Period): { from?: string; to?: string } {
  switch (p.kind) {
    case 'month':
      return { from: `${p.month}-01T00:00:00`, to: `${p.month}-31T23:59:59` };
    case 'year':
      return { from: `${p.year}-01-01T00:00:00`, to: `${p.year}-12-31T23:59:59` };
    case 'range':
      return { from: p.from && `${p.from}T00:00:00`, to: p.to && `${p.to}T23:59:59` };
    default:
      return {};
  }
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const idx = y * 12 + (m - 1) + delta;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`;
}

/** Període anterior o posterior del mateix tipus (null si no en té: "tot" o un rang). */
export function shiftPeriod(p: Period, delta: number): Period | null {
  if (p.kind === 'month') return { kind: 'month', month: shiftMonth(p.month, delta) };
  if (p.kind === 'year') return { kind: 'year', year: String(Number(p.year) + delta) };
  return null;
}

/** Mes per defecte: el del moviment més recent (o l'actual si no n'hi ha). */
export function latestMonth(txs: Transaction[], today: string): string {
  let max = '';
  for (const t of txs) if (!t.hidden && t.date > max) max = t.date;
  return (max || today).slice(0, 7);
}

/** Agrupa per dia mantenint l'ordre d'entrada (la llista ja ve ordenada). */
export function groupByDay<T extends { date: string }>(items: T[]): { day: string; items: T[] }[] {
  const groups: { day: string; items: T[] }[] = [];
  for (const it of items) {
    const day = it.date.slice(0, 10);
    const last = groups.at(-1);
    if (last?.day === day) last.items.push(it);
    else groups.push({ day, items: [it] });
  }
  return groups;
}

/** Variació relativa (null si la base és 0). */
export function relativeChange(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return (current - previous) / Math.abs(previous);
}
