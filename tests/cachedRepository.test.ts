import { describe, expect, it } from 'vitest';
import { initialData } from '../src/application/seed';
import type { Transaction } from '../src/domain/types';
import { CachedBudgetRepository, chunk, MemoryBudgetStore } from '../src/infrastructure/cachedRepository';

const tx = (id: string, amountCents = -100, extra: Partial<Transaction> = {}): Transaction => ({
  id,
  accountId: 'acc',
  date: '2026-09-01T10:00:00',
  amountCents,
  feeCents: 0,
  currency: 'EUR',
  description: 'Mercadona',
  kind: 'expense',
  source: 'import',
  ...extra,
});

function setup() {
  const store = new MemoryBudgetStore(initialData());
  return { store, repo: new CachedBudgetRepository(store, 'b1') };
}

describe('CachedBudgetRepository', () => {
  it('llegeix del magatzem una sola vegada', async () => {
    const { store, repo } = setup();
    let loads = 0;
    const loadAll = store.loadAll.bind(store);
    store.loadAll = () => (loads++, loadAll());
    await Promise.all([repo.load(), repo.load()]);
    await repo.upsertTransactions([tx('a')]);
    await repo.load();
    expect(loads).toBe(1);
  });

  it("només escriu el que ha canviat (l'ordre de les claus i els undefined no compten)", async () => {
    const { store, repo } = setup();
    await repo.upsertTransactions([tx('a'), tx('b')]);
    expect(store.commits.at(-1)).toHaveLength(2);

    const commits = store.commits.length;
    const reordered = { ...tx('a'), notes: undefined };
    await repo.upsertTransactions([Object.fromEntries(Object.entries(reordered).reverse()) as Transaction, tx('b')]);
    expect(store.commits.length).toBe(commits); // res a escriure

    await repo.upsertTransactions([tx('a', -200), tx('b')]);
    expect(store.commits.at(-1)).toEqual([expect.objectContaining({ op: 'set', id: 'a' })]);
    expect((await repo.load()).transactions.find((t) => t.id === 'a')?.amountCents).toBe(-200);
  });

  it('esborra només ids existents i manté la cache coherent amb el magatzem', async () => {
    const { store, repo } = setup();
    await repo.upsertTransactions([tx('a'), tx('b')]);
    await repo.deleteTransactions(['a', 'zzz']);
    expect(store.commits.at(-1)).toEqual([{ op: 'delete', collection: 'transactions', id: 'a' }]);
    expect((await repo.load()).transactions.map((t) => t.id)).toEqual(['b']);
    expect(store.state.transactions.map((t) => t.id)).toEqual(['b']);
  });

  it('si el magatzem falla, la cache no canvia', async () => {
    const { store, repo } = setup();
    await repo.load();
    store.commit = async () => {
      throw new Error('offline');
    };
    await expect(repo.upsertTransactions([tx('a')])).rejects.toThrow('offline');
    expect((await repo.load()).transactions).toEqual([]);
  });

  it('replaceAll deixa exactament les dades de la còpia', async () => {
    const { store, repo } = setup();
    await repo.upsertTransactions([tx('a'), tx('b')]);
    const backup = { ...initialData({ ownerName: 'JOAN', employerPattern: 'ACME' }), transactions: [tx('b', -5), tx('c')] };
    await repo.replaceAll(backup);
    const loaded = await new CachedBudgetRepository(store, 'b1').load();
    expect(loaded.transactions.map((t) => [t.id, t.amountCents]).sort()).toEqual([
      ['b', -5],
      ['c', -100],
    ]);
    expect(loaded.settings.ownerName).toBe('JOAN');
    expect(loaded.rules.length).toBe(backup.rules.length);
  });
});

describe('chunk', () => {
  it('parteix en batches de com a molt 450', () => {
    expect(chunk(Array.from({ length: 1000 }, (_, i) => i)).map((c) => c.length)).toEqual([450, 450, 100]);
    expect(chunk([])).toEqual([]);
  });
});

describe('deutes i categories al repositori', () => {
  it('desa i esborra deutes i categories', async () => {
    const { store, repo } = setup();
    await repo.upsertDebts([{ id: 'd1', person: 'Anna', amountCents: 100, reason: '', date: '2026-09-01T00:00:00', repayments: [] }]);
    await repo.deleteCategories(['oci']);
    expect(store.state.debts).toHaveLength(1);
    expect(store.state.categories.some((c) => c.id === 'oci')).toBe(false);
    await repo.deleteDebts(['d1']);
    expect((await repo.load()).debts).toEqual([]);
  });

  it('restaurar una còpia antiga sense deutes no falla i els buida', async () => {
    const { store, repo } = setup();
    await repo.upsertDebts([{ id: 'd1', person: 'Anna', amountCents: 100, reason: '', date: '2026-09-01T00:00:00', repayments: [] }]);
    const old = initialData() as Partial<ReturnType<typeof initialData>>;
    delete old.debts;
    await repo.replaceAll(old as ReturnType<typeof initialData>);
    expect(store.state.debts).toEqual([]);
  });
});
