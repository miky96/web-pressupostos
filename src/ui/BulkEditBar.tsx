import { useState } from 'react';
import type { BulkPatch } from '../domain/transactions';
import { TRANSACTION_KINDS, type Category, type TransactionKind } from '../domain/types';
import { Button } from './kit/Button';
import { KIND_LABELS } from './labels';

const KEEP = '__keep__';
const CLEAR = '__clear__';

/** Barra d'edició en bloc dels moviments seleccionats. */
export function BulkEditBar({
  count,
  categories,
  onApply,
  onClear,
}: {
  count: number;
  categories: Category[];
  onApply: (patch: BulkPatch) => Promise<void>;
  onClear: () => void;
}) {
  const [kind, setKind] = useState(KEEP);
  const [category, setCategory] = useState(KEEP);
  const [notesMode, setNotesMode] = useState<'keep' | 'replace' | 'append' | 'clear'>('keep');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  const hidesCategory = kind === 'transfer' || kind === 'adjustment';
  const patch: BulkPatch = {
    kind: kind === KEEP ? undefined : (kind as TransactionKind),
    categoryId: hidesCategory || category === KEEP ? undefined : category === CLEAR ? null : category,
    notes: notesMode === 'keep' ? undefined : notesMode === 'clear' ? null : notes,
    appendNotes: notesMode === 'append',
  };
  const hasChanges = patch.kind !== undefined || patch.categoryId !== undefined || patch.notes !== undefined;

  async function apply(p: BulkPatch) {
    setBusy(true);
    try {
      await onApply(p);
      setKind(KEEP);
      setCategory(KEEP);
      setNotesMode('keep');
      setNotes('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-20 z-30 flex justify-center px-3 lg:bottom-6 lg:pl-60">
      <div className="pointer-events-auto flex max-w-full flex-wrap items-center gap-2 rounded-2xl border border-line bg-surface px-3 py-2.5 shadow-pop">
        <span className="px-1 text-sm font-semibold whitespace-nowrap">{count} seleccionats</span>
        <div className="mx-1 hidden h-6 w-px bg-line sm:block" />
        <select className="input h-8 w-auto text-[13px]" value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Tipus">
          <option value={KEEP}>Tipus: no canviar</option>
          {TRANSACTION_KINDS.map((k) => (
            <option key={k} value={k}>
              {KIND_LABELS[k]}
            </option>
          ))}
        </select>
        <select
          className="input h-8 w-auto max-w-52 text-[13px]"
          value={hidesCategory ? KEEP : category}
          disabled={hidesCategory}
          onChange={(e) => setCategory(e.target.value)}
          aria-label="Categoria"
        >
          <option value={KEEP}>{hidesCategory ? 'Sense categoria (traspàs/ajust)' : 'Categoria: no canviar'}</option>
          <option value={CLEAR}>— treure la categoria —</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select className="input h-8 w-auto text-[13px]" value={notesMode} onChange={(e) => setNotesMode(e.target.value as typeof notesMode)} aria-label="Notes">
          <option value="keep">Notes: no canviar</option>
          <option value="replace">Notes: substituir</option>
          <option value="append">Notes: afegir</option>
          <option value="clear">Notes: esborrar</option>
        </select>
        {(notesMode === 'replace' || notesMode === 'append') && (
          <input className="input h-8 w-40 text-[13px]" placeholder="Text de les notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
        )}
        <Button variant="primary" size="sm" disabled={busy || !hasChanges} onClick={() => apply(patch)}>
          Aplicar
        </Button>
        <Button size="sm" icon="check" disabled={busy} onClick={() => apply({})} title="Els deixa tal com estan però els treu de 'per revisar'">
          Revisats
        </Button>
        <Button variant="ghost" size="sm" icon="x" disabled={busy} onClick={onClear} aria-label="Desseleccionar" title="Desseleccionar" />
      </div>
    </div>
  );
}
