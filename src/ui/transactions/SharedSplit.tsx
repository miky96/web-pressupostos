import { useId } from 'react';
import { formatCents, parseUserAmount } from '../../domain/money';
import { equalSplit, type ShareInput } from '../../domain/sharedExpenses';
import { Button } from '../kit/Button';
import { cx } from '../kit/cx';

export const centsToInput = (c: number) => (c / 100).toFixed(2).replace('.', ',');

/** Import que pot estar a mig escriure: null si encara no és vàlid. */
export function tryAmount(s: string): number | null {
  if (!s.trim()) return null;
  try {
    return parseUserAmount(s);
  } catch {
    return null;
  }
}

export interface SplitRow {
  key: string;
  person: string;
  /** Només si l'usuari l'ha escrit; si no, és la part igual. */
  share?: string;
  paid: boolean;
  /** Buit = tota la seva part. */
  paidAmount: string;
  paidDate: string;
}

export interface SplitState {
  /** Persones en total, tu inclòs. */
  people: number;
  rows: SplitRow[];
}

let seq = 0;
const row = (paidDate: string): SplitRow => ({ key: `r${++seq}`, person: '', paid: false, paidAmount: '', paidDate });

export function initialSplit(paidDate: string, people = 2): SplitState {
  return { people, rows: Array.from({ length: people - 1 }, () => row(paidDate)) };
}

/** Part de cada fila (en cèntims) tenint en compte les que s'han escrit a mà. */
export function rowShares(state: SplitState, totalCents: number | null): (number | null)[] {
  if (totalCents === null) return state.rows.map((r) => (r.share !== undefined ? tryAmount(r.share) : null));
  const { eachCents } = equalSplit(totalCents, state.people);
  return state.rows.map((r) => (r.share !== undefined ? tryAmount(r.share) : eachCents));
}

/** Converteix l'estat del formulari a l'entrada del domini (llança si hi ha imports no vàlids). */
export function buildShares(state: SplitState, totalCents: number, accountId?: string): ShareInput[] {
  const shares = rowShares(state, totalCents);
  return state.rows.map((r, i) => {
    const share = shares[i];
    if (share === null) throw new Error(`La part de ${r.person || 'una persona'} no és un import vàlid`);
    let paid: ShareInput['paid'];
    if (r.paid) {
      const amount = r.paidAmount.trim() ? tryAmount(r.paidAmount) : share;
      if (amount === null) throw new Error(`L'import que t'ha tornat ${r.person || 'una persona'} no és vàlid`);
      paid = { amountCents: amount, date: r.paidDate, accountId };
    }
    return { person: r.person, shareCents: share, paid };
  });
}

/**
 * Editor de "qui em deu què" d'una despesa: entre quantes persones es reparteix, la part de cada
 * una (igual per defecte) i qui ja t'ha fet el Bizum.
 */
export function SharedSplit({
  totalCents,
  value,
  onChange,
  people,
  defaultDate,
}: {
  /** Import a repartir (la despesa sencera o el que en queda per repartir). */
  totalCents: number | null;
  value: SplitState;
  onChange: (v: SplitState) => void;
  people: string[];
  defaultDate: string;
}) {
  const listId = useId();
  const shares = rowShares(value, totalCents);
  const othersCents = shares.reduce<number>((s, x) => s + (x ?? 0), 0);
  const mineCents = totalCents === null ? null : totalCents - othersCents;

  const setPeople = (n: number) => {
    const people = Math.max(2, Math.min(30, Math.floor(n) || 2));
    const rows = value.rows.slice(0, people - 1);
    while (rows.length < people - 1) rows.push(row(defaultDate));
    onChange({ people, rows });
  };
  const patch = (i: number, p: Partial<SplitRow>) => onChange({ ...value, rows: value.rows.map((r, j) => (j === i ? { ...r, ...p } : r)) });
  const resetShares = () => onChange({ ...value, rows: value.rows.map((r) => ({ ...r, share: undefined })) });

  return (
    <div className="space-y-3">
      <div className="flex items-end gap-3">
        <label className="label w-36">
          Persones (amb tu)
          <div className="flex items-center gap-1">
            <Button size="sm" icon="chevronLeft" aria-label="Menys" onClick={() => setPeople(value.people - 1)} disabled={value.people <= 2} />
            <input className="input h-8 text-center" inputMode="numeric" value={value.people} onChange={(e) => setPeople(Number(e.target.value))} />
            <Button size="sm" icon="chevronRight" aria-label="Més" onClick={() => setPeople(value.people + 1)} />
          </div>
        </label>
        <div className="flex-1 rounded-lg bg-subtle px-3 py-1.5 text-right">
          <div className="text-xs text-ink-muted">La teva part</div>
          <div className={cx('amount text-sm font-semibold', mineCents !== null && mineCents < 0 && 'text-neg')}>{mineCents === null ? '—' : formatCents(mineCents)}</div>
        </div>
      </div>

      <ul className="space-y-2">
        {value.rows.map((r, i) => (
          <li key={r.key} className="rounded-lg border border-line p-2.5">
            <div className="grid grid-cols-[1fr_6.5rem] gap-2">
              <input className="input" value={r.person} onChange={(e) => patch(i, { person: e.target.value })} placeholder={`Persona ${i + 1}`} list={listId} aria-label="Nom" />
              <input
                className={cx('input text-right tabular-nums', r.share === undefined && 'text-ink-muted')}
                inputMode="decimal"
                aria-label="La seva part"
                value={r.share ?? (shares[i] !== null ? centsToInput(shares[i]!) : '')}
                onChange={(e) => patch(i, { share: e.target.value })}
              />
            </div>
            <label className="mt-2 flex cursor-pointer items-center gap-2 text-[13px] text-ink-muted">
              <input type="checkbox" className="checkbox" checked={r.paid} onChange={(e) => patch(i, { paid: e.target.checked })} />
              Ja m'ho ha tornat
            </label>
            {r.paid && (
              <div className="mt-2 grid grid-cols-2 gap-2">
                <input
                  className="input text-right tabular-nums"
                  inputMode="decimal"
                  aria-label="Import retornat"
                  placeholder={shares[i] !== null ? centsToInput(shares[i]!) : 'Import'}
                  value={r.paidAmount}
                  onChange={(e) => patch(i, { paidAmount: e.target.value })}
                />
                <input className="input" type="date" aria-label="Data del Bizum" value={r.paidDate} onChange={(e) => patch(i, { paidDate: e.target.value })} />
              </div>
            )}
          </li>
        ))}
      </ul>
      <datalist id={listId}>
        {people.map((p) => (
          <option key={p} value={p} />
        ))}
      </datalist>
      <p className="hint">
        Es crea un deute per persona (motiu: la descripció). Els que ja t'han pagat queden saldats amb el seu Bizum; la resta, pendents a Deutes.
        {value.rows.some((r) => r.share !== undefined) && (
          <>
            {' '}
            <button type="button" className="font-medium text-accent" onClick={resetShares}>
              Tornar a parts iguals
            </button>
          </>
        )}
      </p>
    </div>
  );
}
