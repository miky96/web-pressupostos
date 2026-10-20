import type { Rule } from '../domain/classification';
import type { Account, BudgetSettings, Category, Debt, SavingsGoal, SharedItem, SpendingLimit, Subscription, Transaction, Valuation } from '../domain/types';

export interface BudgetData {
  accounts: Account[];
  transactions: Transaction[];
  categories: Category[];
  rules: Rule[];
  valuations: Valuation[];
  debts: Debt[];
  goals: SavingsGoal[];
  limits: SpendingLimit[];
  subscriptions: Subscription[];
  shared: SharedItem[];
  settings: BudgetSettings;
}

/**
 * Port de persistència. Totes les dades pengen d'un pressupost (budgetId), no de l'usuari,
 * per poder compartir pressupostos en el futur. Implementacions: memòria/localStorage (ara)
 * i Firestore (budgets/{budgetId}/...) més endavant.
 */
export interface BudgetRepository {
  readonly budgetId: string;
  load(): Promise<BudgetData>;
  upsertAccounts(items: Account[]): Promise<void>;
  deleteAccounts(ids: string[]): Promise<void>;
  upsertTransactions(items: Transaction[]): Promise<void>;
  deleteTransactions(ids: string[]): Promise<void>;
  upsertCategories(items: Category[]): Promise<void>;
  deleteCategories(ids: string[]): Promise<void>;
  upsertRules(items: Rule[]): Promise<void>;
  deleteRules(ids: string[]): Promise<void>;
  upsertValuations(items: Valuation[]): Promise<void>;
  deleteValuations(ids: string[]): Promise<void>;
  upsertDebts(items: Debt[]): Promise<void>;
  deleteDebts(ids: string[]): Promise<void>;
  upsertGoals(items: SavingsGoal[]): Promise<void>;
  deleteGoals(ids: string[]): Promise<void>;
  upsertLimits(items: SpendingLimit[]): Promise<void>;
  deleteLimits(ids: string[]): Promise<void>;
  upsertSubscriptions(items: Subscription[]): Promise<void>;
  deleteSubscriptions(ids: string[]): Promise<void>;
  upsertShared(items: SharedItem[]): Promise<void>;
  deleteShared(ids: string[]): Promise<void>;
  saveSettings(settings: BudgetSettings): Promise<void>;
  /** Substitueix totes les dades (restaurar una còpia de seguretat). */
  replaceAll(data: BudgetData): Promise<void>;
}

export interface SessionUser {
  uid: string;
  email: string | null;
  displayName: string | null;
}

/**
 * Port d'autenticació: la UI no sap res de Firebase. `openBudget` retorna el repositori
 * del pressupost per defecte de l'usuari (i el crea el primer cop).
 */
export interface SessionService {
  onChange(listener: (user: SessionUser | null) => void): () => void;
  signIn(): Promise<void>;
  signOut(): Promise<void>;
  openBudget(user: SessionUser): Promise<BudgetRepository>;
}
