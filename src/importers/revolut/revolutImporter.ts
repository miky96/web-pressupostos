import { formatCents, parseDecimalToCents, type Cents } from '../../domain/money';
import type { AccountType } from '../../domain/types';
import { stableHash } from '../hash';
import type { BankImporter, DiscoveredAccount, ImportIssue, ImportedRow, ImportResult } from '../types';
import { revolutDefaultRules } from './revolutRules';

const COLUMNS = [
  'Type',
  'Product',
  'Started Date',
  'Completed Date',
  'Description',
  'Amount',
  'Fee',
  'Currency',
  'State',
  'Balance',
] as const;
type Column = (typeof COLUMNS)[number];

const DATE_RE = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})$/;

function slug(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, '-');
}

export function revolutAccountKey(product: string, currency: string): string {
  return `revolut:${slug(product)}:${currency}`;
}

const CLOSING_RE = /^Closing transaction$/i;

function suggestAccount(product: string): { name: string; type: AccountType } {
  switch (product) {
    case 'Current':
      return { name: 'Revolut', type: 'bank' };
    case 'Deposit':
    case 'Savings':
      return { name: 'Revolut Estalvi', type: 'savings' };
    default:
      return { name: `Revolut ${product}`, type: 'bank' };
  }
}

/**
 * Export "Account statement" de Revolut (CSV, en-US). Un sol fitxer conté tots els productes
 * (Current, Deposit...). Cada producte té el seu saldo acumulat, ordenat per Completed Date.
 * Es compleix sempre: saldo anterior + Amount - Fee = Balance. Ho fem servir per validar el fitxer.
 */
export const revolutImporter: BankImporter = {
  id: 'revolut',
  label: 'Revolut',

  canParse(header) {
    const cols = header.map((h) => h.trim());
    return COLUMNS.every((c) => cols.includes(c));
  },

  defaultRules: revolutDefaultRules,

  parse(records): ImportResult {
    const [header, ...body] = records;
    const index = new Map(header.map((h, i) => [h.trim(), i]));
    const get = (r: string[], c: Column) => (r[index.get(c)!] ?? '').trim();

    const rows: ImportedRow[] = [];
    const skipped: ImportResult['skipped'] = [];
    const issues: ImportIssue[] = [];
    const accounts = new Map<string, DiscoveredAccount>();
    const lastBalance = new Map<string, Cents>();
    const seenIds = new Map<string, number>();

    body.forEach((r, i) => {
      const line = i + 2; // 1 = capçalera
      if (r.length < header.length) {
        issues.push({ level: 'error', line, message: `Fila incompleta (${r.length} columnes)` });
        return;
      }
      const state = get(r, 'State');
      if (state !== 'COMPLETED') {
        skipped.push({ line, reason: state || 'sense estat' });
        return;
      }
      const started = DATE_RE.exec(get(r, 'Started Date'));
      if (!started) {
        issues.push({ level: 'error', line, message: `Data no vàlida: "${get(r, 'Started Date')}"` });
        return;
      }

      let amount: Cents, fee: Cents, balance: Cents | undefined;
      try {
        amount = parseDecimalToCents(get(r, 'Amount'));
        fee = parseDecimalToCents(get(r, 'Fee') || '0');
        balance = get(r, 'Balance') ? parseDecimalToCents(get(r, 'Balance')) : undefined;
      } catch (e) {
        issues.push({ level: 'error', line, message: (e as Error).message });
        return;
      }

      const product = get(r, 'Product');
      const currency = get(r, 'Currency');
      const key = revolutAccountKey(product, currency);
      const date = `${started[1]}T${started[2]}`;
      const net = amount - fee;

      if (!accounts.has(key)) {
        const s = suggestAccount(product);
        accounts.set(key, {
          key,
          suggestedName: currency === 'EUR' ? s.name : `${s.name} ${currency}`,
          suggestedType: s.type,
          currency,
          openingDate: date,
          openingBalanceCents: balance !== undefined ? balance - net : 0,
          closingBalanceCents: 0,
          rowCount: 0,
        });
      }
      const acc = accounts.get(key)!;
      acc.rowCount++;
      // L'última fila d'un producte tancat és "Closing transaction" (import 0).
      acc.closedAt = CLOSING_RE.test(get(r, 'Description')) ? date : undefined;

      if (balance !== undefined) {
        const prev = lastBalance.get(key);
        if (prev !== undefined && prev + net !== balance) {
          issues.push({
            level: 'warning',
            line,
            message: `El saldo de ${product} no quadra: s'esperava ${formatCents(prev + net, currency)} i el fitxer diu ${formatCents(balance, currency)}. Pot faltar alguna fila.`,
          });
        }
        lastBalance.set(key, balance);
        acc.closingBalanceCents = balance;
      }

      const fingerprint = [
        product,
        currency,
        get(r, 'Started Date'),
        get(r, 'Description'),
        get(r, 'Amount'),
        get(r, 'Fee'),
        get(r, 'Balance'),
      ].join('|');
      let externalId = `rv_${stableHash(fingerprint)}`;
      const n = seenIds.get(externalId) ?? 0;
      seenIds.set(externalId, n + 1);
      if (n > 0) externalId = `${externalId}_${n}`;

      rows.push({
        externalId,
        line,
        accountKey: key,
        date,
        amountCents: net,
        feeCents: fee,
        currency,
        description: get(r, 'Description'),
        bankType: get(r, 'Type'),
        balanceAfterCents: balance,
      });
    });

    for (const acc of accounts.values()) {
      if (acc.closingBalanceCents !== 0 || !acc.closedAt) delete acc.closedAt;
    }
    return { importerId: 'revolut', rows, accounts: [...accounts.values()], skipped, issues };
  },
};
