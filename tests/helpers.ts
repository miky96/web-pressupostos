import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { planImport, requiredAccounts } from '../src/application/importService';
import { builtInRules } from '../src/application/seed';
import { createAccount, mergeOpening } from '../src/domain/accounts';
import type { Account, BudgetSettings } from '../src/domain/types';
import { importCsv } from '../src/importers/registry';

export const SAMPLE_SETTINGS: BudgetSettings = {
  ownerName: 'JOAN EXEMPLE PUIG',
  employerPattern: 'ACME GAMES',
};

export function readFixture(name: string): string {
  return readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf-8');
}

/** Flux complet d'importació tal com el fa la UI: detectar, crear comptes, planificar. */
export function importText(text: string, settings = SAMPLE_SETTINGS, existing: { accounts?: Account[]; ids?: Set<string> } = {}) {
  const rules = builtInRules(settings);
  const { result } = importCsv(text);
  const accounts = [...(existing.accounts ?? [])];
  for (const req of requiredAccounts(result, rules)) {
    let acc = accounts.find((a) => a.importKey === req.key);
    if (!acc) {
      acc = createAccount(
        {
          name: req.suggestedName,
          type: req.suggestedType,
          currency: req.currency,
          importKey: req.key,
          balanceMode: req.mirrorOnly ? 'valuations' : 'transactions',
        },
        `acc_${req.key}`,
      );
      accounts.push(acc);
    }
  }
  for (const d of result.accounts) {
    const i = accounts.findIndex((a) => a.importKey === d.key);
    accounts[i] = mergeOpening(accounts[i], { date: d.openingDate, balanceCents: d.openingBalanceCents });
  }
  const accountIdByKey = Object.fromEntries(accounts.map((a) => [a.importKey!, a.id]));
  const plan = planImport(result, { rules, accountIdByKey, existingIds: existing.ids ?? new Set() });
  return { result, plan, accounts, rules };
}
