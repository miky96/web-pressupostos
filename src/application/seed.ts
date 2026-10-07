import type { Rule } from '../domain/classification';
import { DEFAULT_CATEGORIES } from '../domain/defaultCategories';
import type { BudgetSettings } from '../domain/types';
import { IMPORTERS } from '../importers/registry';
import type { BudgetData } from './ports';

export const DEFAULT_SETTINGS: BudgetSettings = { ownerName: '', employerPattern: '' };

export function builtInRules(settings: BudgetSettings): Rule[] {
  return IMPORTERS.flatMap((imp) => imp.defaultRules(settings));
}

export function initialData(settings: BudgetSettings = DEFAULT_SETTINGS): BudgetData {
  return {
    accounts: [],
    transactions: [],
    categories: DEFAULT_CATEGORIES,
    rules: builtInRules(settings),
    valuations: [],
    debts: [],
    settings,
  };
}

/**
 * Regenera les regles per defecte (p.ex. quan canvia el nom del titular) mantenint
 * les regles de l'usuari i l'estat activat/desactivat de les per defecte.
 */
export function refreshBuiltInRules(current: Rule[], settings: BudgetSettings, categoryIds?: Set<string>): Rule[] {
  const previous = new Map(current.filter((r) => r.builtIn).map((r) => [r.id, r]));
  const fresh = builtInRules(settings).map((r) => {
    const prev = previous.get(r.id);
    let then = r.then;
    // Si l'usuari ha eliminat la categoria d'una regla per defecte, es manté la reassignació que es va fer.
    if (categoryIds && then.categoryId && !categoryIds.has(then.categoryId)) {
      const kept = prev?.then.categoryId && categoryIds.has(prev.then.categoryId) ? prev.then.categoryId : undefined;
      then = { ...then, categoryId: kept };
    }
    return { ...r, then, ...(prev?.enabled === false ? { enabled: false } : {}) };
  });
  return [...fresh, ...current.filter((r) => !r.builtIn)];
}
