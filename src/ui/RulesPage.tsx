import { useState, type FormEvent } from 'react';
import { reclassify } from '../application/importService';
import { isValidPattern, type Rule } from '../domain/classification';
import { TRANSACTION_KINDS, type TransactionKind } from '../domain/types';
import { KIND_LABELS } from './labels';
import { newId, type BudgetState } from './useBudget';

function describe(rule: Rule): string {
  const w = rule.when;
  const parts: string[] = [];
  if (w.descriptionContains) parts.push(`conté "${w.descriptionContains}"`);
  if (w.descriptionMatches) parts.push(`patró /${w.descriptionMatches}/`);
  if (w.bankTypes) parts.push(`tipus banc: ${w.bankTypes.join(', ')}`);
  if (w.direction) parts.push(w.direction === 'in' ? 'entrada' : 'sortida');
  return parts.join(' · ') || 'sempre';
}

export function RulesPage({ budget }: { budget: BudgetState }) {
  const { data, run, lookups, setError } = budget;
  const [text, setText] = useState('');
  const [isRegex, setIsRegex] = useState(false);
  const [direction, setDirection] = useState<'' | 'in' | 'out'>('');
  const [kind, setKind] = useState<TransactionKind | ''>('');
  const [categoryId, setCategoryId] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  if (!data) return null;

  const rules = [...data.rules].sort((a, b) => a.priority - b.priority);

  async function reapply(allRules: Rule[]) {
    const keyById = Object.fromEntries(data!.accounts.map((a) => [a.id, a.importKey ?? '']));
    const before = data!.transactions;
    const after = reclassify(before, allRules, keyById);
    const changed = after.filter((t, i) => t.kind !== before[i].kind || t.categoryId !== before[i].categoryId || t.hidden !== before[i].hidden);
    await run((repo) => repo.upsertTransactions(changed));
    setMessage(`${changed.length} moviments actualitzats. Els que has editat a mà no s'han tocat.`);
  }

  async function add(e: FormEvent) {
    e.preventDefault();
    if (isRegex && !isValidPattern(text)) return setError('El patró no és una expressió regular vàlida');
    if (!kind && !categoryId) return setError('Tria un tipus o una categoria');
    const rule: Rule = {
      id: newId('rule'),
      name: text,
      priority: kind ? 8 : 90, // les de l'usuari van abans que les per defecte
      when: { ...(isRegex ? { descriptionMatches: text } : { descriptionContains: text }), ...(direction ? { direction } : {}) },
      then: { ...(kind ? { kind } : {}), ...(categoryId ? { categoryId } : {}) },
    };
    await run((repo) => repo.upsertRules([rule]));
    await reapply([rule, ...data!.rules]);
    setText('');
  }

  return (
    <section>
      <h2>Regles de classificació</h2>
      <p className="muted">
        S'apliquen en importar i quan prems "Reaplicar". Per a cada moviment, guanya la primera regla (per ordre) que en defineix el tipus, i la
        primera que en defineix la categoria.
      </p>
      <form className="card form-grid" onSubmit={add}>
        <label className="wide">
          Si la descripció {isRegex ? 'coincideix amb el patró' : 'conté'}
          <input value={text} onChange={(e) => setText(e.target.value)} required placeholder="p.ex. MULTIPLAYER GAMES" />
        </label>
        <label>
          <input type="checkbox" checked={isRegex} onChange={(e) => setIsRegex(e.target.checked)} /> Expressió regular
        </label>
        <label>
          Direcció
          <select value={direction} onChange={(e) => setDirection(e.target.value as '' | 'in' | 'out')}>
            <option value="">Qualsevol</option>
            <option value="in">Entren diners</option>
            <option value="out">Surten diners</option>
          </select>
        </label>
        <label>
          Tipus
          <select value={kind} onChange={(e) => setKind(e.target.value as TransactionKind | '')}>
            <option value="">— no canviar —</option>
            {TRANSACTION_KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Categoria
          <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">— no canviar —</option>
            {data.categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <div className="wide">
          <button className="primary" type="submit">
            Afegir regla i aplicar
          </button>{' '}
          <button type="button" onClick={() => reapply(data.rules)}>
            Reaplicar totes les regles
          </button>
        </div>
      </form>
      {message && <p className="ok">{message}</p>}

      <table>
        <thead>
          <tr>
            <th>Activa</th>
            <th>Regla</th>
            <th>Condició</th>
            <th>Resultat</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rules.map((r) => (
            <tr key={r.id} className={r.enabled === false ? 'hidden-row' : ''}>
              <td>
                <input type="checkbox" checked={r.enabled !== false} onChange={(e) => run((repo) => repo.upsertRules([{ ...r, enabled: e.target.checked }]))} />
              </td>
              <td>
                {r.name}
                {r.builtIn && <span className="badge">per defecte</span>}
              </td>
              <td className="muted">{describe(r)}</td>
              <td>
                {[r.then.kind && KIND_LABELS[r.then.kind], r.then.categoryId && lookups.categories.get(r.then.categoryId)?.name, r.then.hidden && 'amagar', r.then.mirrorTo && `→ ${r.then.mirrorTo.suggestedName}`]
                  .filter(Boolean)
                  .join(' · ')}
              </td>
              <td>
                {!r.builtIn && (
                  <button className="link" onClick={() => run((repo) => repo.deleteRules([r.id]))}>
                    ✕
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
