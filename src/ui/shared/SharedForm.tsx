import { useState, type FormEvent } from 'react';
import { todayIso } from '../../domain/dates';
import { knownNames, saveShared } from '../../domain/shared';
import { ME, type SharedItem } from '../../domain/types';
import { Button } from '../kit/Button';
import { Alert, Segmented } from '../kit/Feedback';
import { Icon } from '../kit/Icon';
import { newId, type BudgetState } from '../useBudget';

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
type Row = { id?: string; name: string; weight: string };
const toWeight = (s: string) => Number(s.replace(',', '.'));

/** Alta o edició d'una cosa compartida: nom, participants i com es reparteix per defecte. */
export function SharedForm({ budget, item, onDone, onCancel }: { budget: BudgetState; item?: SharedItem; onDone: (id: string) => void; onCancel: () => void }) {
  const data = budget.data!;
  const me = item?.participants.find((p) => p.id === ME);
  const [name, setName] = useState(item?.name ?? '');
  const [kind, setKind] = useState<SharedItem['kind']>(item?.kind ?? 'oneoff');
  const [myWeight, setMyWeight] = useState(String(me?.weight ?? 1));
  const [rows, setRows] = useState<Row[]>(
    item ? item.participants.filter((p) => p.id !== ME).map((p) => ({ id: p.id, name: p.name, weight: String(p.weight) })) : [{ name: '', weight: '1' }],
  );
  const [categoryId, setCategoryId] = useState(item?.categoryId ?? '');
  const [subscriptionId, setSubscriptionId] = useState(item?.subscriptionId ?? '');
  const [since, setSince] = useState(item?.subscriptionSince?.slice(0, 10) ?? todayIso().slice(0, 10));
  const [notes, setNotes] = useState(item?.notes ?? '');
  const [error, setError] = useState<string | null>(null);

  const names = knownNames(data.shared, data.debts);
  const categories = data.categories.filter((c) => c.kind === 'expense');
  const subscriptions = data.subscriptions.filter((s) => s.kind === 'expense');
  const setRow = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      const saved = saveShared(
        {
          name,
          kind,
          myWeight: toWeight(myWeight),
          others: rows.map((r) => ({ id: r.id, name: r.name, weight: toWeight(r.weight) })),
          categoryId,
          subscriptionId,
          subscriptionSince: since,
          notes,
        },
        item?.id ?? newId('shared'),
        newId,
        todayIso(),
        item,
      );
      await budget.run((repo) => repo.upsertShared([saved]));
      onDone(saved.id);
    } catch (err) {
      setError(errorText(err));
    }
  }

  return (
    <form className="space-y-5" onSubmit={submit}>
      {error && (
        <Alert tone="neg" onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      <label className="label">
        Nom
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="p.ex. Viatge a Roma, Pis, Cotxe, Netflix" required autoFocus={!item} />
      </label>
      <div className="space-y-1.5">
        <Segmented
          value={kind}
          onChange={setKind}
          options={[
            { value: 'oneoff', label: 'Puntual' },
            { value: 'ongoing', label: 'Continu' },
          ]}
        />
        <p className="hint">{kind === 'oneoff' ? "Una compra o un viatge: quan quadra, s'acaba." : "El pis, el cotxe, una subscripció: no s'acaba mai, només es van quadrant comptes."}</p>
      </div>

      <fieldset className="space-y-2">
        <legend className="text-[13px] font-medium text-ink-muted">Participants i part de cadascú</legend>
        <div className="flex items-center gap-2">
          <input className="input flex-1" value="Tu" disabled aria-label="Tu" />
          <input className="input w-20 text-right" inputMode="decimal" value={myWeight} onChange={(e) => setMyWeight(e.target.value)} aria-label="La teva part" />
          <span className="size-8" />
        </div>
        {rows.map((r, i) => (
          <div key={r.id ?? `new-${i}`} className="flex items-center gap-2">
            <input className="input flex-1" value={r.name} onChange={(e) => setRow(i, { name: e.target.value })} list="shared-people" placeholder="Nom" aria-label="Nom" />
            <input className="input w-20 text-right" inputMode="decimal" value={r.weight} onChange={(e) => setRow(i, { weight: e.target.value })} aria-label={`Part de ${r.name || 'la persona'}`} />
            <button type="button" className="grid size-8 place-items-center rounded-lg text-ink-faint hover:bg-subtle hover:text-neg" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} aria-label="Treure">
              <Icon name="x" />
            </button>
          </div>
        ))}
        <datalist id="shared-people">
          {names.map((n) => (
            <option key={n} value={n} />
          ))}
        </datalist>
        <Button size="sm" variant="ghost" icon="plus" onClick={() => setRows((rs) => [...rs, { name: '', weight: '1' }])}>
          Afegir persona
        </Button>
        <p className="hint">Parts iguals (1 i 1) és a mitges; 60 i 40 vol dir 60 % i 40 %. Cada despesa es pot repartir diferent.</p>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="label">
          Categoria
          <select className="input" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">La de cada moviment</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        {subscriptions.length > 0 && (
          <label className="label">
            Subscripció
            <select className="input" value={subscriptionId} onChange={(e) => setSubscriptionId(e.target.value)}>
              <option value="">Cap</option>
              {subscriptions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {subscriptionId && (
        <label className="label">
          Compta els cobraments des de
          <input className="input" type="date" value={since} onChange={(e) => setSince(e.target.value)} />
          <span className="hint">Cada cobrament de la subscripció serà una despesa pagada per tu i repartida segons les parts.</span>
        </label>
      )}
      <label className="label">
        Notes
        <textarea className="input h-auto min-h-20 py-2" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Opcional" />
      </label>
      <div className="flex gap-2">
        <Button variant="primary" type="submit">
          Desar
        </Button>
        <Button onClick={onCancel}>Cancel·lar</Button>
      </div>
    </form>
  );
}
