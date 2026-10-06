/** Imports sempre en cèntims enters per evitar errors de coma flotant. */
export type Cents = number;

const DECIMAL_RE = /^[+-]?\d+(\.\d{1,2})?$/;

/** "3084.08" -> 308408, "-0.01" -> -1. Accepta punt decimal (format en-US dels exports). */
export function parseDecimalToCents(input: string): Cents {
  const s = input.trim().replace(/\s/g, '');
  if (!DECIMAL_RE.test(s)) throw new Error(`Import no vàlid: "${input}"`);
  const negative = s.startsWith('-');
  const [intPart, fracPart = ''] = s.replace(/^[+-]/, '').split('.');
  const cents = Number(intPart) * 100 + Number(fracPart.padEnd(2, '0'));
  return (negative ? -cents : cents) + 0; // +0 evita -0
}

/** Converteix un import introduït per l'usuari ("12,5", "12.50") a cèntims. */
export function parseUserAmount(input: string): Cents {
  return parseDecimalToCents(input.trim().replace(',', '.'));
}

export function formatCents(cents: Cents, currency = 'EUR', locale = 'ca-ES'): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(cents / 100);
}
