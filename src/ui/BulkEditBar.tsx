import { useState } from 'react';
import type { BulkPatch } from '../domain/transactions';
import { TRANSACTION_KINDS, type Category, type TransactionKind } from '../domain/types';
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
    <div className="card bulk-bar">
      <strong>{count} seleccionats</strong>
      <select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Tipus">
        <option value={KEEP}>Tipus: no canviar</option>
        {TRANSACTION_KINDS.map((k) => (
          <option key={k} value={k}>
            {KIND_LABELS[k]}
          </option>
        ))}
      </select>
      <select value={hidesCategory ? KEEP : category} disabled={hidesCategory} onChange={(e) => setCategory(e.target.value)} aria-label="Categoria">
        <option value={KEEP}>{hidesCategory ? 'Sense categoria (traspàs/ajust)' : 'Categoria: no canviar'}</option>
        <option value={CLEAR}>— treure la categoria —</option>
        {categories.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      <select value={notesMode} onChange={(e) => setNotesMode(e.target.value as typeof notesMode)} aria-label="Notes">
        <option value="keep">Notes: no canviar</option>
        <option value="replace">Notes: substituir</option>
        <option value="append">Notes: afegir</option>
        <option value="clear">Notes: esborrar</option>
      </select>
      {(notesMode === 'replace' || notesMode === 'append') && (
        <input className="notes" placeholder="Text de les notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
      )}
      <button className="primary" disabled={busy || !hasChanges} onClick={() => apply(patch)}>
        Aplicar a {count}
      </button>
      <button disabled={busy} onClick={() => apply({})} title="Els deixa tal com estan però els treu de 'per revisar'">
        ✓ Marcar com a revisats
      </button>
      <button className="link" disabled={busy} onClick={onClear}>
        Desseleccionar
      </button>
    </div>
  );
}
