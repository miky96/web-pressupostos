import type { Period } from '../domain/periods';
import type { AccountType, TransactionKind } from '../domain/types';

export const KIND_LABELS: Record<TransactionKind, string> = {
  expense: 'Despesa',
  income: 'Ingrés',
  transfer: 'Traspàs',
  interest: 'Interessos',
  refund: 'Devolució',
  reimbursement: 'Reemborsament',
  loan: 'Préstec',
  adjustment: 'Ajust',
};

/** Agrupació dels comptes per tipus (resum de patrimoni i gràfiques). */
export const ACCOUNT_GROUPS: { label: string; types: AccountType[]; color: string }[] = [
  { label: 'Liquiditat', types: ['bank', 'cash'], color: 'var(--color-accent)' },
  { label: 'Estalvi remunerat', types: ['savings'], color: '#14b8a6' },
  { label: 'Inversió', types: ['investment'], color: '#f59e0b' },
];

export function formatDate(iso: string): string {
  const [date, time] = iso.split('T');
  const [y, m, d] = date.split('-');
  return time && time !== '00:00:00' ? `${d}/${m}/${y} ${time.slice(0, 5)}` : `${d}/${m}/${y}`;
}

export function formatPct(ratio: number, digits = 2): string {
  return `${(ratio * 100).toFixed(digits).replace('.', ',')} %`;
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Data local (sense desfasaments de zona horària) a partir de "YYYY-MM-DD...". */
function localDate(iso: string): Date {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d || 1);
}

/** "Dimecres, 7 d’octubre" (amb l'any si no és l'actual). */
export function formatDayHeading(day: string, today = new Date()): string {
  const sameYear = Number(day.slice(0, 4)) === today.getFullYear();
  const f = new Intl.DateTimeFormat('ca-ES', { weekday: 'long', day: 'numeric', month: 'long', ...(sameYear ? {} : { year: 'numeric' }) });
  return capitalize(f.format(localDate(day)));
}

/** "7 d’octubre de 2026, 19:17" */
export function formatLongDate(iso: string): string {
  const base = new Intl.DateTimeFormat('ca-ES', { day: 'numeric', month: 'long', year: 'numeric' }).format(localDate(iso));
  const time = iso.slice(11, 16);
  return time && time !== '00:00' ? `${base}, ${time}` : base;
}

export function formatMonth(month: string): string {
  return capitalize(new Intl.DateTimeFormat('ca-ES', { month: 'long', year: 'numeric' }).format(localDate(`${month}-01`)).replace(' del ', ' '));
}

export function formatPeriod(p: Period): string {
  switch (p.kind) {
    case 'month':
      return formatMonth(p.month);
    case 'year':
      return p.year;
    case 'all':
      return "Tot l'historial";
    case 'range':
      return [p.from ? formatDate(p.from) : '…', p.to ? formatDate(p.to) : '…'].join(' – ');
  }
}

/** Nom curt del període anterior, per a les comparacions ("vs setembre"). */
export function previousLabel(p: Period): string {
  if (p.kind === 'month') return new Intl.DateTimeFormat('ca-ES', { month: 'long' }).format(localDate(`${p.month}-01`));
  if (p.kind === 'year') return p.year;
  return '';
}

/** "gen. 26" per als eixos de les gràfiques. */
export function formatMonthShort(month: string): string {
  const name = new Intl.DateTimeFormat('ca-ES', { month: 'short' }).format(localDate(`${month}-01`)).replace(/^de\s+|^d’/, '');
  return `${name} ${month.slice(2, 4)}`;
}

const compactEur = new Intl.NumberFormat('ca-ES', { style: 'currency', currency: 'EUR', notation: 'compact', maximumFractionDigits: 1 });

/** Import curt per als eixos ("1,2 k €"). */
export function formatCentsCompact(cents: number): string {
  return compactEur.format(cents / 100);
}
