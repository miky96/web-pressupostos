import type { AccountType, TransactionKind } from './types';

/**
 * Regles de classificació: són DADES (es poden guardar, editar i afegir des de l'app),
 * no codi. S'avaluen per prioritat; per a cada camp (tipus, categoria...) guanya la
 * primera regla que el defineix.
 */
export interface RuleCondition {
  /** Expressió regular (sense barres), insensible a majúscules. */
  descriptionMatches?: string;
  /** Text que ha de contenir la descripció, insensible a majúscules. */
  descriptionContains?: string;
  /** Tipus original del banc, p.ex. ["Card Payment", "Rev Payment"]. */
  bankTypes?: string[];
  /** in = entren diners, out = en surten. */
  direction?: 'in' | 'out';
  /** Només per a comptes amb aquesta clau d'importació (prefix). */
  accountKeyPrefix?: string;
}

export interface MirrorTarget {
  accountKey: string;
  suggestedName: string;
  suggestedType: AccountType;
}

export interface RuleAction {
  kind?: TransactionKind;
  categoryId?: string;
  hidden?: boolean;
  /** Només té efecte a la regla que fixa el tipus (kind). */
  needsReview?: boolean;
  /**
   * Crea la pota contrària del traspàs en un altre compte. Útil per a comptes que
   * l'export no inclou (Flexible Cash Funds): així en tenim l'historial d'aportacions.
   */
  mirrorTo?: MirrorTarget;
}

export interface Rule {
  id: string;
  name: string;
  priority: number;
  when: RuleCondition;
  then: RuleAction;
  enabled?: boolean;
  /** Regles per defecte de l'app (es poden regenerar); les de l'usuari no. */
  builtIn?: boolean;
}

export interface ClassifiableTx {
  description: string;
  amountCents: number;
  bankType?: string;
  accountKey?: string;
}

export interface Classification {
  kind: TransactionKind;
  categoryId?: string;
  hidden: boolean;
  needsReview: boolean;
  mirrorTo?: MirrorTarget;
  matchedRuleIds: string[];
}

const regexCache = new Map<string, RegExp | null>();

function compile(source: string): RegExp | null {
  if (!regexCache.has(source)) {
    try {
      regexCache.set(source, new RegExp(source, 'i'));
    } catch {
      regexCache.set(source, null); // regla mal escrita: no coincideix mai
    }
  }
  return regexCache.get(source) ?? null;
}

export function isValidPattern(source: string): boolean {
  return compile(source) !== null;
}

export function ruleMatches(rule: Rule, tx: ClassifiableTx): boolean {
  if (rule.enabled === false) return false;
  const w = rule.when;
  if (w.direction === 'in' && tx.amountCents < 0) return false;
  if (w.direction === 'out' && tx.amountCents >= 0) return false;
  if (w.bankTypes && !(tx.bankType && w.bankTypes.includes(tx.bankType))) return false;
  if (w.accountKeyPrefix && !(tx.accountKey ?? '').startsWith(w.accountKeyPrefix)) return false;
  if (w.descriptionContains && !tx.description.toLowerCase().includes(w.descriptionContains.toLowerCase()))
    return false;
  if (w.descriptionMatches) {
    const re = compile(w.descriptionMatches);
    if (!re || !re.test(tx.description)) return false;
  }
  return true;
}

export function classify(tx: ClassifiableTx, rules: Rule[]): Classification {
  const sorted = [...rules].sort((a, b) => a.priority - b.priority);
  let kind: TransactionKind | undefined;
  let categoryId: string | undefined;
  let hidden: boolean | undefined;
  let mirrorTo: MirrorTarget | undefined;
  // "Per revisar" el decideix la regla que ha fixat el tipus (no una regla posterior).
  let needsReview = true;
  const matchedRuleIds: string[] = [];

  for (const rule of sorted) {
    if (!ruleMatches(rule, tx)) continue;
    const t = rule.then;
    const before = [kind, categoryId, hidden, mirrorTo];
    if (kind === undefined && t.kind !== undefined) {
      kind = t.kind;
      needsReview = t.needsReview ?? false;
    }
    categoryId ??= t.categoryId;
    hidden ??= t.hidden;
    mirrorTo ??= t.mirrorTo;
    const after = [kind, categoryId, hidden, mirrorTo];
    if (after.some((v, i) => v !== before[i])) matchedRuleIds.push(rule.id);
  }

  return {
    kind: kind ?? (tx.amountCents < 0 ? 'expense' : 'income'),
    categoryId,
    hidden: hidden ?? false,
    needsReview,
    mirrorTo,
    matchedRuleIds,
  };
}

/** Escapa text perquè es pugui fer servir dins d'una expressió regular. */
export function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
