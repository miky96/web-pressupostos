import type { Rule } from './classification';
import type { Category, Transaction } from './types';

/** Colors suggerits per a categories noves (llegibles en mode clar i fosc). */
export const CATEGORY_COLORS = [
  '#2a9d8f', '#e76f51', '#457b9d', '#8d5fd3', '#f4a261', '#e9c46a',
  '#06a77d', '#d6457a', '#0096c7', '#6d597a', '#2b9348', '#999999',
];

export interface CategoryInput {
  name: string;
  kind: Category['kind'];
  color?: string;
}

const norm = (s: string) => s.trim().toLocaleLowerCase('ca');

/** Crea o actualitza una categoria validant que el nom no estigui buit ni repetit (dins del mateix tipus). */
export function saveCategory(input: CategoryInput, existing: Category[], id: string): Category {
  const name = input.name.trim();
  if (!name) throw new Error('Cal un nom');
  if (existing.some((c) => c.id !== id && c.kind === input.kind && norm(c.name) === norm(name))) {
    throw new Error(`Ja tens una categoria "${name}"`);
  }
  const current = existing.find((c) => c.id === id);
  return { ...current, id, name, kind: input.kind, color: input.color || current?.color };
}

export interface CategoryUsage {
  transactions: number;
  rules: number;
}

export function categoryUsage(categoryId: string, transactions: Transaction[], rules: Rule[]): CategoryUsage {
  return {
    transactions: transactions.filter((t) => t.categoryId === categoryId).length,
    rules: rules.filter((r) => r.then.categoryId === categoryId).length,
  };
}

export interface CategoryDeletionPlan {
  transactions: Transaction[];
  rulesToUpsert: Rule[];
  rulesToDelete: string[];
  categories: Category[];
}

/**
 * Què cal escriure per eliminar una categoria movent-ne l'ús a `targetId`
 * (o deixant-ho sense categoria si és undefined). Una regla de l'usuari que només
 * posava aquesta categoria i es queda sense cap efecte s'elimina.
 */
export function planCategoryDeletion(
  categoryId: string,
  targetId: string | undefined,
  data: { transactions: Transaction[]; rules: Rule[]; categories: Category[] },
): CategoryDeletionPlan {
  if (targetId === categoryId) throw new Error('La categoria de destí ha de ser una altra');
  if (targetId && !data.categories.some((c) => c.id === targetId)) throw new Error('La categoria de destí no existeix');

  const transactions = data.transactions
    .filter((t) => t.categoryId === categoryId)
    .map((t) => ({ ...t, categoryId: targetId }));

  const rulesToUpsert: Rule[] = [];
  const rulesToDelete: string[] = [];
  for (const r of data.rules.filter((x) => x.then.categoryId === categoryId)) {
    const then = { ...r.then, categoryId: targetId };
    const hasEffect = then.categoryId || then.kind || then.hidden || then.mirrorTo;
    if (!hasEffect && !r.builtIn) rulesToDelete.push(r.id);
    else rulesToUpsert.push({ ...r, then });
  }

  const categories = data.categories
    .filter((c) => c.parentId === categoryId)
    .map((c) => ({ ...c, parentId: undefined }));

  return { transactions, rulesToUpsert, rulesToDelete, categories };
}
