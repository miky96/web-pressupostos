import { parseUserNumber } from '../../domain/money';

/** Preu per títol: pot tenir més de dos decimals (p.ex. 182,3456 $). */
export function formatPrice(cents: number, currency: string): string {
  return new Intl.NumberFormat('ca-ES', { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(cents / 100);
}

/** Nombre per a un camp de text, amb coma decimal i sense separador de milers. */
export function numberToInput(n: number | undefined, digits = 6): string {
  if (n === undefined || !Number.isFinite(n)) return '';
  return String(Number(n.toFixed(digits))).replace('.', ',');
}

/** Preu escrit per l'usuari (en unitats de moneda) a cèntims amb decimals. */
export function parsePriceCents(input: string): number {
  return Math.round(parseUserNumber(input) * 1e6) / 1e4;
}

export function tryNumber(input: string): number | undefined {
  try {
    return input.trim() ? parseUserNumber(input) : undefined;
  } catch {
    return undefined;
  }
}
