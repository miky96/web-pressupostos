import { useState, type FormEvent } from 'react';
import { reclassify } from '../application/importService';
import { isValidPattern, type Rule } from '../domain/classification';
import { TRANSACTION_KINDS, type TransactionKind } from '../domain/types';
import { CategoryDot } from './CategoryAvatar';
import { Button } from './kit/Button';
import { Card, CardHeader, PageHeader } from './kit/Card';
import { cx } from './kit/cx';
import { Alert, Badge, Switch } from './kit/Feedback';
import { Icon } from './kit/Icon';
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
  const [query, setQuery] = useState('');
  const [showBuiltIn, setShowBuiltIn] = useState(false);
  if (!data) return null;

  const q = query.trim().toLowerCase();
  const rules = [...data.rules]
    .sort((a, b) => a.priority - b.priority)
    .filter((r) => !q || r.name.toLowerCase().includes(q) || describe(r).toLowerCase().includes(q));
  const mine = rules.filter((r) => !r.builtIn);
  const builtIn = rules.filter((r) => r.builtIn);

  const ruleRow = (r: Rule) => {
    const outcome = [
      r.then.kind && KIND_LABELS[r.then.kind],
      r.then.categoryId && lookups.categories.get(r.then.categoryId)?.name,
      r.then.hidden && 'amagar',
      r.then.mirrorTo && `→ ${r.then.mirrorTo.suggestedName}`,
    ].filter((x): x is string => !!x);
    const category = r.then.categoryId ? lookups.categories.get(r.then.categoryId) : undefined;
    return (
      <li key={r.id} className={cx('group flex items-center gap-4 px-4 py-3', r.enabled === false && 'opacity-50')}>
        <Switch checked={r.enabled !== false} onChange={(v) => run((repo) => repo.upsertRules([{ ...r, enabled: v }]))} label="Activa" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{r.name}</div>
          <div className="truncate font-mono text-xs text-ink-muted">{describe(r)}</div>
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-1.5 max-sm:hidden">
          {outcome.map((o) => (
            <Badge key={o} tone={o === category?.name ? 'accent' : 'neutral'}>
              {o === category?.name && <CategoryDot color={category.color} className="size-2" />}
              {o}
            </Badge>
          ))}
        </div>
        {!r.builtIn ? (
          <button className="text-ink-faint opacity-0 transition group-hover:opacity-100 hover:text-neg" onClick={() => run((repo) => repo.deleteRules([r.id]))} aria-label="Eliminar">
            <Icon name="trash" />
          </button>
        ) : (
          <span className="w-4" />
        )}
      </li>
    );
  };

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
      <PageHeader
        title="Regles de classificació"
        subtitle="S'apliquen en importar i quan prems Reaplicar. Per a cada moviment guanya la primera regla (per ordre) que en defineix el tipus, i la primera que en defineix la categoria."
        actions={
          <Button icon="sparkle" onClick={() => reapply(data.rules)}>
            Reaplicar totes
          </Button>
        }
      />
      {message && (
        <Alert tone="pos" className="mb-6" onClose={() => setMessage(null)}>
          {message}
        </Alert>
      )}

      <Card className="mb-8">
        <CardHeader title="Nova regla" subtitle="Es desa i s'aplica de seguida als moviments existents (excepte els que has editat a mà)." />
        <form className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4" onSubmit={add}>
          <label className="label sm:col-span-2 lg:col-span-4">
            <span className="flex items-center justify-between">
              Si la descripció {isRegex ? 'coincideix amb el patró' : 'conté'}
              <span className="flex items-center gap-2 text-xs font-normal text-ink-muted">
                Expressió regular <Switch checked={isRegex} onChange={setIsRegex} label="Expressió regular" />
              </span>
            </span>
            <input className={cx('input', isRegex && 'font-mono')} value={text} onChange={(e) => setText(e.target.value)} required placeholder="p.ex. MULTIPLAYER GAMES" />
          </label>
          <label className="label">
            Direcció
            <select className="input" value={direction} onChange={(e) => setDirection(e.target.value as '' | 'in' | 'out')}>
              <option value="">Qualsevol</option>
              <option value="in">Entren diners</option>
              <option value="out">Surten diners</option>
            </select>
          </label>
          <label className="label">
            Llavors el tipus és
            <select className="input" value={kind} onChange={(e) => setKind(e.target.value as TransactionKind | '')}>
              <option value="">— no canviar —</option>
              {TRANSACTION_KINDS.map((k) => (
                <option key={k} value={k}>
                  {KIND_LABELS[k]}
                </option>
              ))}
            </select>
          </label>
          <label className="label">
            I la categoria
            <select className="input" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">— no canviar —</option>
              {data.categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-end">
            <Button variant="primary" type="submit" icon="plus" className="w-full">
              Afegir i aplicar
            </Button>
          </div>
        </form>
      </Card>

      <div className="mb-4 flex items-center gap-2">
        <div className="relative max-w-sm flex-1">
          <Icon name="search" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-faint" />
          <input className="input pl-9" placeholder="Cerca regles" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
      </div>

      <h2 className="mb-2 text-[13px] font-semibold text-ink-muted">Les teves regles ({mine.length})</h2>
      {mine.length > 0 ? (
        <ul className="mb-8 divide-y divide-line rounded-xl border border-line bg-surface shadow-card">{mine.map(ruleRow)}</ul>
      ) : (
        <p className="mb-8 rounded-xl border border-dashed border-line-strong px-4 py-6 text-center text-sm text-ink-muted">
          Encara no n'has creat cap. També se'n creen soles quan canvies la categoria d'un moviment.
        </p>
      )}

      <button className="mb-2 inline-flex items-center gap-1 text-[13px] font-semibold text-ink-muted hover:text-ink" onClick={() => setShowBuiltIn((v) => !v)}>
        <Icon name={showBuiltIn || q ? 'chevronDown' : 'chevronRight'} className="size-4" />
        Per defecte ({builtIn.length})
      </button>
      {(showBuiltIn || q) && <ul className="divide-y divide-line rounded-xl border border-line bg-surface shadow-card">{builtIn.map(ruleRow)}</ul>}
    </section>
  );
}
