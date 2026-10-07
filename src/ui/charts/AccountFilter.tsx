import { useState } from 'react';
import type { Account } from '../../domain/types';
import { Button } from '../kit/Button';
import { Icon } from '../kit/Icon';

/** Selector de comptes. `selected` null = tots. */
export function AccountFilter({ accounts, selected, onChange }: { accounts: Account[]; selected: Set<string> | null; onChange: (s: Set<string> | null) => void }) {
  const [open, setOpen] = useState(false);
  const isOn = (id: string) => !selected || selected.has(id);
  const label = !selected ? 'Tots els comptes' : selected.size === 1 ? (accounts.find((a) => selected.has(a.id))?.name ?? '1 compte') : `${selected.size} comptes`;

  function toggle(id: string) {
    const next = new Set(selected ?? accounts.map((a) => a.id));
    if (next.has(id)) next.delete(id);
    else next.add(id);
    // Cap o tots = sense filtre.
    onChange(next.size === 0 || next.size === accounts.length ? null : next);
  }

  return (
    <div className="relative">
      <Button size="sm" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <Icon name="wallet" className="size-3.5" />
        {label}
        <Icon name="chevronDown" className="size-3.5 text-ink-faint" />
      </Button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-40 mt-1.5 w-64 rounded-xl border border-line bg-surface p-1.5 shadow-pop">
            <div className="max-h-72 overflow-y-auto">
              {accounts.map((a) => (
                <label key={a.id} className="flex h-9 cursor-pointer items-center gap-2.5 rounded-lg px-2.5 text-sm hover:bg-subtle">
                  <input type="checkbox" className="checkbox" checked={isOn(a.id)} onChange={() => toggle(a.id)} />
                  <span className="min-w-0 flex-1 truncate">{a.name}</span>
                  {a.archived && <span className="text-[11px] text-ink-faint">arxivat</span>}
                </label>
              ))}
            </div>
            {selected && (
              <button className="mt-1 w-full rounded-lg px-2.5 py-1.5 text-left text-xs font-medium text-accent hover:bg-subtle" onClick={() => onChange(null)}>
                Seleccionar tots
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
