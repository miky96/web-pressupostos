import type { BudgetData, BudgetRepository } from '../application/ports';
import { initialData } from '../application/seed';
import type { BudgetSettings } from '../domain/types';

/** Subconjunt de l'API de localStorage (permet passar un fals als tests). */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function memoryStorage(): KeyValueStorage {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) };
}

type Collection = 'accounts' | 'transactions' | 'categories' | 'rules' | 'valuations';

/**
 * Adaptador provisional: guarda tot el pressupost com un JSON a localStorage.
 * Serveix per desenvolupar i provar l'app sense backend. Es substituirà per Firestore
 * implementant el mateix port (BudgetRepository).
 */
export class KeyValueBudgetRepository implements BudgetRepository {
  private cache: BudgetData | null = null;

  constructor(
    private readonly storage: KeyValueStorage,
    readonly budgetId: string,
  ) {}

  private get key() {
    return `pressupostos:budget:${this.budgetId}`;
  }

  async load(): Promise<BudgetData> {
    if (!this.cache) {
      const raw = this.storage.getItem(this.key);
      this.cache = raw ? { ...initialData(), ...(JSON.parse(raw) as Partial<BudgetData>) } : initialData();
      if (!raw) this.persist();
    }
    return structuredClone(this.cache);
  }

  private persist() {
    this.storage.setItem(this.key, JSON.stringify(this.cache));
  }

  private async upsert<T extends { id: string }>(col: Collection, items: T[]) {
    const data = await this.loadRef();
    const cols = data as unknown as Record<Collection, T[]>;
    const byId = new Map(cols[col].map((x) => [x.id, x]));
    for (const item of items) byId.set(item.id, structuredClone(item));
    cols[col] = [...byId.values()];
    this.persist();
  }

  private async remove(col: Collection, ids: string[]) {
    const data = await this.loadRef();
    const drop = new Set(ids);
    const cols = data as unknown as Record<Collection, { id: string }[]>;
    cols[col] = cols[col].filter((x) => !drop.has(x.id));
    this.persist();
  }

  private async loadRef(): Promise<BudgetData> {
    if (!this.cache) await this.load();
    return this.cache!;
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
    const data = await this.loadRef();
    data.settings = { ...settings };
    this.persist();
  }

  async replaceAll(data: BudgetData): Promise<void> {
    this.cache = structuredClone(data);
    this.persist();
  }
}
