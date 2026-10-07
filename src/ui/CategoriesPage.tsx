import { useMemo, useState, type FormEvent } from 'react';
import { CATEGORY_COLORS, categoryUsage, planCategoryDeletion, saveCategory } from '../domain/categories';
import type { Category } from '../domain/types';
import { CategoryAvatar } from './CategoryAvatar';
import { Button } from './kit/Button';
import { PageHeader } from './kit/Card';
import { cx } from './kit/cx';
import { Drawer } from './kit/Drawer';
import { Alert, Segmented } from './kit/Feedback';
import { Icon } from './kit/Icon';
import { newId, type BudgetState } from './useBudget';

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const usageText = (u: { transactions: number; rules: number }) => plural(u.transactions, 'moviment', 'moviments') + ' · ' + plural(u.rules, 'regla', 'regles');

const KIND_TITLES: Record<Category['kind'], string> = { expense: 'Despeses', income: 'Ingressos' };

/** "new" = creant; id = editant; null = tancat. */
type Editing = { mode: 'new'; kind: Category['kind'] } | { mode: 'edit'; id: string } | null;

export function CategoriesPage({ budget }: { budget: BudgetState }) {
  const { data } = budget;
  const [editing, setEditing] = useState<Editing>(null);
  const usage = useMemo(() => {
    const m = new Map<string, { transactions: number; rules: number }>();
    for (const c of data?.categories ?? []) m.set(c.id, categoryUsage(c.id, data!.transactions, data!.rules));
    return m;
  }, [data]);
  if (!data) return null;

  const editingCategory = editing?.mode === 'edit' ? data.categories.find((c) => c.id === editing.id) : undefined;

  return (
    <section className="max-w-3xl">
      <PageHeader
        title="Categories"
        subtitle="Crea, canvia el nom o el color de les categories. Si n'elimines una, tries on van a parar els seus moviments i regles."
        actions={
          <Button variant="primary" icon="plus" onClick={() => setEditing({ mode: 'new', kind: 'expense' })}>
            Nova categoria
          </Button>
        }
      />

      {(['expense', 'income'] as const).map((kind) => {
        const list = data.categories.filter((c) => c.kind === kind).sort((a, b) => a.name.localeCompare(b.name, 'ca'));
        return (
          <div key={kind} className="mb-8">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-[13px] font-semibold text-ink-muted">
                {KIND_TITLES[kind]} ({list.length})
              </h2>
              <Button variant="ghost" size="sm" icon="plus" onClick={() => setEditing({ mode: 'new', kind })}>
                Afegir
              </Button>
            </div>
            {list.length === 0 ? (
              <p className="rounded-xl border border-dashed border-line-strong px-4 py-6 text-center text-sm text-ink-muted">Cap categoria d'aquest tipus.</p>
            ) : (
              <ul className="divide-y divide-line rounded-xl border border-line bg-surface shadow-card">
                {list.map((c) => {
                  const u = usage.get(c.id)!;
                  return (
                    <li key={c.id}>
                      <button className="group flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-subtle/60" onClick={() => setEditing({ mode: 'edit', id: c.id })}>
                        <CategoryAvatar category={c} className="size-8" />
                        <span className="min-w-0 flex-1 truncate text-sm font-medium">{c.name}</span>
                        <span className="text-xs text-ink-faint">
                          {plural(u.transactions, 'moviment', 'moviments')}
                          {u.rules ? ` · ${plural(u.rules, 'regla', 'regles')}` : ''}
                        </span>
                        <Icon name="chevronRight" className="size-4 text-ink-faint opacity-0 transition group-hover:opacity-100" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        );
      })}

      {editing && (editing.mode === 'new' || editingCategory) && (
        <CategoryDrawer
          key={editing.mode === 'new' ? `new-${editing.kind}` : editing.id}
          budget={budget}
          category={editingCategory}
          defaultKind={editing.mode === 'new' ? editing.kind : 'expense'}
          onClose={() => setEditing(null)}
        />
      )}
    </section>
  );
}

const NONE = '__none__';

function CategoryDrawer({ budget, category, defaultKind, onClose }: { budget: BudgetState; category?: Category; defaultKind: Category['kind']; onClose: () => void }) {
  const data = budget.data!;
  const [name, setName] = useState(category?.name ?? '');
  const [kind, setKind] = useState<Category['kind']>(category?.kind ?? defaultKind);
  const [color, setColor] = useState(category?.color ?? CATEGORY_COLORS[data.categories.length % CATEGORY_COLORS.length]);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [target, setTarget] = useState(NONE);

  const usage = category ? categoryUsage(category.id, data.transactions, data.rules) : { transactions: 0, rules: 0 };
  const others = data.categories.filter((c) => c.id !== category?.id).sort((a, b) => Number(b.kind === category?.kind) - Number(a.kind === category?.kind) || a.name.localeCompare(b.name, 'ca'));

  async function save(e: FormEvent) {
    e.preventDefault();
    try {
      const saved = saveCategory({ name, kind, color }, data.categories, category?.id ?? newId('cat'));
      await budget.run((repo) => repo.upsertCategories([saved]));
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function remove() {
    if (!category) return;
    try {
      const plan = planCategoryDeletion(category.id, target === NONE ? undefined : target, data);
      await budget.run(async (repo) => {
        // Primer es mou tot el que la fa servir i després s'esborra: si falla a mig camí no queden referències penjades.
        await repo.upsertTransactions(plan.transactions);
        await repo.upsertRules(plan.rulesToUpsert);
        await repo.deleteRules(plan.rulesToDelete);
        await repo.upsertCategories(plan.categories);
        await repo.deleteCategories([category.id]);
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const inUse = usage.transactions + usage.rules > 0;

  return (
    <Drawer
      open
      onClose={onClose}
      title={category ? category.name : 'Nova categoria'}
      subtitle={category ? usageText(usage) : undefined}
      footer={
        deleting ? undefined : (
          <>
            {category && (
              <Button variant="danger" icon="trash" onClick={() => setDeleting(true)}>
                Eliminar
              </Button>
            )}
            <div className="flex-1" />
            <Button onClick={onClose}>Cancel·lar</Button>
            <Button variant="primary" type="submit" form="category-form">
              Desar
            </Button>
          </>
        )
      }
    >
      {error && (
        <Alert tone="neg" className="mb-5" onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {deleting && category ? (
        <div className="space-y-5">
          <Alert tone="warn" title={`Eliminar "${category.name}"`}>
            {inUse
              ? `La fan servir ${usageText(usage).replace(' · ', ' i ')}. Tria a quina categoria els vols moure.`
              : 'No la fa servir cap moviment ni cap regla.'}
          </Alert>
          {inUse && (
            <label className="label">
              Moure-ho a
              <select className="input" value={target} onChange={(e) => setTarget(e.target.value)}>
                <option value={NONE}>— Sense categoria —</option>
                {others.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.kind !== category.kind ? ` (${KIND_TITLES[c.kind].toLowerCase()})` : ''}
                  </option>
                ))}
              </select>
              {target === NONE && usage.rules > 0 && <span className="hint">Les regles que només posaven aquesta categoria s'eliminaran.</span>}
            </label>
          )}
          <div className="flex gap-2">
            <Button variant="primary" className="bg-neg hover:bg-neg/90" icon="trash" onClick={remove}>
              Eliminar{inUse ? ' i moure' : ''}
            </Button>
            <Button onClick={() => setDeleting(false)}>Enrere</Button>
          </div>
        </div>
      ) : (
        <form id="category-form" className="space-y-6" onSubmit={save}>
          <div className="flex items-center gap-3">
            <CategoryAvatar category={{ id: 'preview', name: name || '?', kind, color }} className="size-11 text-base" />
            <label className="label flex-1">
              Nom
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="p.ex. Mascotes" required autoFocus />
            </label>
          </div>

          <div>
            <div className="mb-2 text-sm font-medium">Tipus</div>
            <Segmented
              value={kind}
              onChange={setKind}
              options={[
                { value: 'expense', label: 'Despesa' },
                { value: 'income', label: 'Ingrés' },
              ]}
            />
            {category && kind !== category.kind && usage.transactions > 0 && (
              <p className="hint mt-2">Els {usage.transactions} moviments mantindran la categoria; només canvia on surt suggerida.</p>
            )}
          </div>

          <div>
            <div className="mb-2 text-sm font-medium">Color</div>
            <div className="flex flex-wrap items-center gap-2">
              {CATEGORY_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  aria-label={`Color ${c}`}
                  className={cx('size-7 rounded-full ring-offset-2 ring-offset-surface transition', color === c ? 'ring-2 ring-ink' : 'hover:scale-110')}
                  style={{ backgroundColor: c }}
                />
              ))}
              <label className="relative grid size-7 cursor-pointer place-items-center rounded-full border border-dashed border-line-strong text-ink-muted hover:text-ink" title="Color personalitzat">
                <Icon name="plus" className="size-3.5" />
                <input type="color" className="absolute inset-0 cursor-pointer opacity-0" value={color} onChange={(e) => setColor(e.target.value)} />
              </label>
            </div>
          </div>
        </form>
      )}
    </Drawer>
  );
}
