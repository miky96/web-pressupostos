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
    settings,
  };
}

/**
 * Regenera les regles per defecte (p.ex. quan canvia el nom del titular) mantenint
 * les regles de l'usuari i l'estat activat/desactivat de les per defecte.
 */
export function refreshBuiltInRules(current: Rule[], settings: BudgetSettings): Rule[] {
  const disabled = new Set(current.filter((r) => r.builtIn && r.enabled === false).map((r) => r.id));
  const fresh = builtInRules(settings).map((r) => (disabled.has(r.id) ? { ...r, enabled: false } : r));
  return [...fresh, ...current.filter((r) => !r.builtIn)];
}
