import { collection, doc, getDoc, getDocs, writeBatch, type Firestore } from 'firebase/firestore';
import type { BudgetData } from '../../application/ports';
import { DEFAULT_SETTINGS } from '../../application/seed';
import type { BudgetSettings } from '../../domain/types';
import { chunk, COLLECTIONS, type BudgetStore, type WriteOp } from '../cachedRepository';


/**
 * Model a Firestore:
 *   users/{uid}                         { email, defaultBudgetId }
 *   budgets/{budgetId}                  { name, members: { uid: 'owner' | 'editor' | 'viewer' }, settings, seeded }
 *   budgets/{budgetId}/{col}/{id}       accounts | transactions | categories | rules | valuations
 * Cada entitat és un document amb el mateix id que a l'app.
 */
export class FirestoreBudgetStore implements BudgetStore {
  constructor(
    private readonly db: Firestore,
    private readonly budgetId: string,
  ) {}

  private get budgetPath() {
    return `budgets/${this.budgetId}`;
  }

  async loadAll(): Promise<BudgetData> {
    const [budgetSnap, ...cols] = await Promise.all([
      getDoc(doc(this.db, this.budgetPath)),
      ...COLLECTIONS.map((c) => getDocs(collection(this.db, this.budgetPath, c))),
    ]);
    if (!budgetSnap.exists()) throw new Error(`El pressupost ${this.budgetId} no existeix`);
    const settings = (budgetSnap.data().settings as BudgetSettings | undefined) ?? DEFAULT_SETTINGS;
    const data = { settings: { ...DEFAULT_SETTINGS, ...settings } } as BudgetData;
    COLLECTIONS.forEach((c, i) => {
      (data as unknown as Record<string, unknown[]>)[c] = cols[i].docs.map((d) => ({ ...d.data(), id: d.id }));
    });
    return data;
  }

  /** Els batches (de 450) no són atòmics entre ells: és acceptable (tot són upserts idempotents). */
  async commit(ops: WriteOp[]): Promise<void> {
    for (const op of ops) if (op.op !== 'settings' && (!op.id || op.id.includes('/'))) throw new Error(`Id no vàlid per a Firestore: "${op.id}"`);
    for (const part of chunk(ops)) {
      const batch = writeBatch(this.db);
      for (const op of part) {
        if (op.op === 'settings') batch.update(doc(this.db, this.budgetPath), { settings: op.settings });
        else if (op.op === 'delete') batch.delete(doc(this.db, this.budgetPath, op.collection, op.id));
        else batch.set(doc(this.db, this.budgetPath, op.collection, op.id), op.data);
      }
      await batch.commit();
    }
  }
}
