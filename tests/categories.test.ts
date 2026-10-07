import { describe, expect, it } from 'vitest';
import { refreshBuiltInRules } from '../src/application/seed';
import { builtInRules } from '../src/application/seed';
import type { Rule } from '../src/domain/classification';
import { planCategoryDeletion, saveCategory } from '../src/domain/categories';
import { DEFAULT_CATEGORIES } from '../src/domain/defaultCategories';
import type { Transaction } from '../src/domain/types';
import { SAMPLE_SETTINGS } from './helpers';

const tx = (id: string, categoryId?: string): Transaction => ({
  id, accountId: 'a', date: '2026-09-01T00:00:00', amountCents: -100, feeCents: 0, currency: 'EUR', description: 'x', kind: 'expense', source: 'import', categoryId,
});
const rule = (id: string, then: Rule['then'], builtIn = false): Rule => ({ id, name: id, priority: 50, when: { descriptionContains: id }, then, builtIn });

describe('categories', () => {
  it('no deixa noms buits ni repetits dins del mateix tipus', () => {
    expect(saveCategory({ name: ' Mascotes ', kind: 'expense', color: '#000' }, DEFAULT_CATEGORIES, 'c1')).toMatchObject({ id: 'c1', name: 'Mascotes' });
    expect(() => saveCategory({ name: 'supermercat', kind: 'expense' }, DEFAULT_CATEGORIES, 'c2')).toThrow();
    expect(saveCategory({ name: 'Supermercat', kind: 'income' }, DEFAULT_CATEGORIES, 'c3').name).toBe('Supermercat');
    // Reanomenar-se a si mateixa (canviar majúscules) sí
    expect(saveCategory({ name: 'SUPERMERCAT', kind: 'expense' }, DEFAULT_CATEGORIES, 'supermercat').color).toBe('#2a9d8f');
  });

  it('en eliminar, mou moviments i regles a la categoria de destí', () => {
    const plan = planCategoryDeletion('oci', 'compres', {
      transactions: [tx('t1', 'oci'), tx('t2', 'salut'), tx('t3', 'oci')],
      rules: [rule('r1', { categoryId: 'oci' }), rule('r2', { categoryId: 'salut' })],
      categories: DEFAULT_CATEGORIES,
    });
    expect(plan.transactions.map((t) => [t.id, t.categoryId])).toEqual([['t1', 'compres'], ['t3', 'compres']]);
    expect(plan.rulesToUpsert.map((r) => r.then.categoryId)).toEqual(['compres']);
    expect(plan.rulesToDelete).toEqual([]);
  });

  it("sense destí: els moviments queden sense categoria i les regles de l'usuari sense efecte s'eliminen", () => {
    const plan = planCategoryDeletion('oci', undefined, {
      transactions: [tx('t1', 'oci')],
      rules: [rule('r1', { categoryId: 'oci' }), rule('r2', { categoryId: 'oci', kind: 'expense' }), rule('r3', { categoryId: 'oci' }, true)],
      categories: DEFAULT_CATEGORIES,
    });
    expect(plan.transactions[0].categoryId).toBeUndefined();
    expect(plan.rulesToDelete).toEqual(['r1']);
    expect(plan.rulesToUpsert.map((r) => r.id)).toEqual(['r2', 'r3']);
    expect(() => planCategoryDeletion('oci', 'oci', { transactions: [], rules: [], categories: DEFAULT_CATEGORIES })).toThrow();
  });

  it('regenerar les regles per defecte respecta les categories eliminades', () => {
    const fresh = builtInRules(SAMPLE_SETTINGS);
    const target = fresh.find((r) => r.then.categoryId === 'supermercat')!;
    const ids = new Set(DEFAULT_CATEGORIES.map((c) => c.id).filter((id) => id !== 'supermercat'));
    const current = fresh.map((r) => (r.id === target.id ? { ...r, then: { ...r.then, categoryId: 'compres' } } : r));
    const next = refreshBuiltInRules(current, SAMPLE_SETTINGS, ids);
    expect(next.find((r) => r.id === target.id)!.then.categoryId).toBe('compres');
    expect(next.some((r) => r.then.categoryId === 'supermercat')).toBe(false);
  });
});
