import type { Rule } from '../domain/classification';
import type { Cents } from '../domain/money';
import type { AccountType } from '../domain/types';

/** Port: cada banc és un adaptador que converteix el seu export a aquest format comú. */
export interface BankImporter {
  id: string;
  label: string;
  canParse(header: string[]): boolean;
  parse(records: string[][]): ImportResult;
  /** Regles de classificació per defecte d'aquest banc. */
  defaultRules(options: { ownerName?: string; employerPattern?: string }): Rule[];
}

export interface ImportedRow {
  /** Id estable (hash de la fila): el mateix moviment reimportat té el mateix id. */
  externalId: string;
  line: number;
  accountKey: string;
  date: string;
  /** Import net amb signe = import - comissió. */
  amountCents: Cents;
  feeCents: Cents;
  currency: string;
  description: string;
  bankType: string;
  balanceAfterCents?: Cents;
}

export interface DiscoveredAccount {
  key: string;
  suggestedName: string;
  suggestedType: AccountType;
  currency: string;
  openingDate: string;
  openingBalanceCents: Cents;
  closingBalanceCents: Cents;
  rowCount: number;
  /** Data de tancament si el banc indica que el producte s'ha tancat (i el saldo final és 0). */
  closedAt?: string;
}

export interface ImportIssue {
  level: 'error' | 'warning';
  line?: number;
  message: string;
}

export interface ImportResult {
  importerId: string;
  rows: ImportedRow[];
  accounts: DiscoveredAccount[];
  skipped: { line: number; reason: string }[];
  issues: ImportIssue[];
}
