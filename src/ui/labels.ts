import type { TransactionKind } from '../domain/types';

export const KIND_LABELS: Record<TransactionKind, string> = {
  expense: 'Despesa',
  income: 'Ingrés',
  transfer: 'Traspàs',
  interest: 'Interessos',
  refund: 'Devolució',
  reimbursement: 'Reemborsament',
  adjustment: 'Ajust',
};

export function formatDate(iso: string): string {
  const [date, time] = iso.split('T');
  const [y, m, d] = date.split('-');
  return time && time !== '00:00:00' ? `${d}/${m}/${y} ${time.slice(0, 5)}` : `${d}/${m}/${y}`;
}

export function formatPct(ratio: number, digits = 2): string {
  return `${(ratio * 100).toFixed(digits).replace('.', ',')} %`;
}
