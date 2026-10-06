/** Les dates es guarden com a text ISO local ("2026-05-15T19:17:09"): s'ordenen bé lexicogràficament. */

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?$/;

function toEpochMs(iso: string): number {
  const m = ISO_RE.exec(iso);
  if (!m) throw new Error(`Data no vàlida: "${iso}"`);
  const [, y, mo, d, h = '0', mi = '0', s = '0'] = m;
  return Date.UTC(+y, +mo - 1, +d, +h, +mi, +s);
}

export function isValidIsoDate(iso: string): boolean {
  return ISO_RE.test(iso);
}

export function secondsBetween(a: string, b: string): number {
  return (toEpochMs(b) - toEpochMs(a)) / 1000;
}

export function daysBetween(a: string, b: string): number {
  return (toEpochMs(b) - toEpochMs(a)) / 86_400_000;
}

/** "2025-10-24T08:06:52" -> "2025-10" */
export function monthOf(iso: string): string {
  return iso.slice(0, 7);
}

/** Normalitza "YYYY-MM-DD" a "YYYY-MM-DDT00:00:00" perquè les comparacions siguin coherents. */
export function normalizeDate(iso: string): string {
  if (!isValidIsoDate(iso)) throw new Error(`Data no vàlida: "${iso}"`);
  if (iso.length === 10) return `${iso}T00:00:00`;
  if (iso.length === 16) return `${iso}:00`;
  return iso;
}

export function todayIso(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}T${p(now.getHours())}:${p(
    now.getMinutes(),
  )}:${p(now.getSeconds())}`;
}
