import type { BudgetData, BudgetRepository } from '../application/ports';
import type { BudgetSettings } from '../domain/types';

export type CollectionName = 'accounts' | 'transactions' | 'categories' | 'rules' | 'valuations';
export const COLLECTIONS: readonly CollectionName[] = ['accounts', 'transactions', 'categories', 'rules', 'valuations'];

export type WriteOp =
  | { op: 'set'; collection: CollectionName; id: string; data: { id: string } }
  | { op: 'delete'; collection: CollectionName; id: string }
  | { op: 'settings'; settings: BudgetSettings };

/**
 * Magatzem remot "tonto": llegeix un pressupost sencer i aplica una llista d'escriptures.
 * L'adaptador de Firestore l'implementa; als tests, una versió en memòria.
 */
export interface BudgetStore {
  loadAll(): Promise<BudgetData>;
  commit(ops: WriteOp[]): Promise<void>;
}

/** Firestore admet fins a 500 escriptures per batch; en deixem marge. */
export const BATCH_SIZE = 450;

export function chunk<T>(items: T[], size = BATCH_SIZE): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** JSON amb claus ordenades: dos objectes iguals donen el mateix text. */
function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_k, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== undefined).sort(([a], [b]) => (a < b ? -1 : 1)))
      : v,
  );
}

/**
 * BudgetRepository sobre un BudgetStore remot amb una còpia en memòria:
 * - Es llegeix del servidor una sola vegada per sessió (Firestore cobra per lectura).
 * - Només s'envien els documents que han canviat (reaplicar regles no reescriu tot).
 * - Primer s'escriu al servidor i després a la cache: si falla, la cache no queda desquadrada.
 */
export class CachedBudgetRepository implements BudgetRepository {
  private cache: Promise<BudgetData> | null = null;

  constructor(
    private readonly store: BudgetStore,
    readonly budgetId: string,
  ) {}

  private data(): Promise<BudgetData> {
    if (!this.cache) {
      this.cache = this.store.loadAll();
      this.cache.catch(() => (this.cache = null)); // permet reintentar
    }
    return this.cache;
  }

  async load(): Promise<BudgetData> {
    return structuredClone(await this.data());
  }

  private async commit(ops: WriteOp[]) {
    if (ops.length === 0) return;
    await this.store.commit(ops);
    const data = await this.data();
    for (const op of ops) {
      if (op.op === 'settings') {
        data.settings = { ...op.settings };
        continue;
      }
      const list = data[op.collection] as { id: string }[];
      const i = list.findIndex((x) => x.id === op.id);
      if (op.op === 'delete') {
        if (i >= 0) list.splice(i, 1);
      } else if (i >= 0) {
        list[i] = structuredClone(op.data);
      } else {
        list.push(structuredClone(op.data));
      }
    }
  }

  private async upsert(collection: CollectionName, items: { id: string }[]) {
    const current = new Map(((await this.data())[collection] as { id: string }[]).map((x) => [x.id, stableStringify(x)]));
    const latest = new Map(items.map((x) => [x.id, x])); // si un id surt dos cops, guanya l'últim
    const ops: WriteOp[] = [];
    for (const item of latest.values()) {
      if (current.get(item.id) !== stableStringify(item)) ops.push({ op: 'set', collection, id: item.id, data: item });
    }
    await this.commit(ops);
  }

  private async remove(collection: CollectionName, ids: string[]) {
    const existing = new Set(((await this.data())[collection] as { id: string }[]).map((x) => x.id));
    await this.commit([...new Set(ids)].filter((id) => existing.has(id)).map((id) => ({ op: 'delete', collection, id }) as const));
  }

  upsertAccounts = (items: BudgetData['accounts']) => this.upsert('accounts', items);
  deleteAccounts = (ids: string[]) => this.remove('accounts', ids);
  upsertTransactions = (items: BudgetData['transactions']) => this.upsert('transactions', items);
  deleteTransactions = (ids: string[]) => this.remove('transactions', ids);
  upsertCategories = (items: BudgetData['categories']) => this.upsert('categories', items);
  upsertRules = (items: BudgetData['rules']) => this.upsert('rules', items);
  deleteRules = (ids: string[]) => this.remove('rules', ids);
  upsertValuations = (items: BudgetData['valuations']) => this.upsert('valuations', items);
  deleteValuations = (ids: string[]) => this.remove('valuations', ids);

  async saveSettings(settings: BudgetSettings): Promise<void> {
    await this.commit([{ op: 'settings', settings }]);
  }

  async replaceAll(next: BudgetData): Promise<void> {
    const current = await this.data();
    const ops: WriteOp[] = [];
    for (const collection of COLLECTIONS) {
      const keep = new Set((next[collection] as { id: string }[]).map((x) => x.id));
      for (const x of current[collection] as { id: string }[]) if (!keep.has(x.id)) ops.push({ op: 'delete', collection, id: x.id });
    }
    await this.commit(ops);
    for (const collection of COLLECTIONS) await this.upsert(collection, next[collection] as { id: string }[]);
    await this.saveSettings(next.settings);
  }
}

/** BudgetStore en memòria (tests i desenvolupament). */
export class MemoryBudgetStore implements BudgetStore {
  commits: WriteOp[][] = [];
  constructor(public state: BudgetData) {}
  async loadAll() {
    return structuredClone(this.state);
  }
  async commit(ops: WriteOp[]) {
    this.commits.push(ops);
    for (const op of ops) {
      if (op.op === 'settings') this.state.settings = { ...op.settings };
      else {
        const list = this.state[op.collection] as { id: string }[];
        const i = list.findIndex((x) => x.id === op.id);
        if (i >= 0) list.splice(i, 1);
        if (op.op === 'set') list.push(structuredClone(op.data));
      }
    }
  }
}
