import { describe, expect, it } from 'vitest';
import { reclassify } from '../src/application/importService';
import { builtInRules, refreshBuiltInRules } from '../src/application/seed';
import type { Rule } from '../src/domain/classification';
import { KeyValueBudgetRepository, memoryStorage } from '../src/infrastructure/keyValueRepository';
import { importText, readFixture, SAMPLE_SETTINGS } from './helpers';

describe('repositori local', () => {
  it('neix amb categories i regles, i persisteix canvis', async () => {
    const storage = memoryStorage();
    const repo = new KeyValueBudgetRepository(storage, 'personal');
    const data = await repo.load();
    expect(data.categories.length).toBeGreaterThan(10);
    expect(data.rules.length).toBeGreaterThan(10);

    const { plan, accounts } = importText(readFixture('revolut-sample.csv'));
    await repo.upsertAccounts(accounts);
    await repo.upsertTransactions(plan.transactions);
    await repo.deleteTransactions([plan.transactions[0].id]);

    const reopened = await new KeyValueBudgetRepository(storage, 'personal').load();
    expect(reopened.accounts).toHaveLength(accounts.length);
    expect(reopened.transactions).toHaveLength(plan.transactions.length - 1);
    // Un altre pressupost no veu aquestes dades
    expect((await new KeyValueBudgetRepository(storage, 'altre').load()).transactions).toHaveLength(0);
  });
});

describe('regles', () => {
  it('reaplicar regles respecta les edicions de l\'usuari', () => {
    const { plan, accounts } = importText(readFixture('revolut-sample.csv'));
    const keyById = Object.fromEntries(accounts.map((a) => [a.id, a.importKey!]));
    const mine: Rule = { id: 'u1', name: 'Amic', priority: 1, when: { descriptionContains: 'AMIC QUALSEVOL' }, then: { kind: 'income', categoryId: 'altres-ingressos' } };
    const edited = plan.transactions.map((t) => (t.description === 'Mercadona' ? { ...t, categoryId: 'oci', userEdited: true } : t));
    const out = reclassify(edited, [mine, ...builtInRules(SAMPLE_SETTINGS)], keyById);
    expect(out.find((t) => t.description === 'Payment from AMIC QUALSEVOL')).toMatchObject({ kind: 'income', categoryId: 'altres-ingressos' });
    expect(out.find((t) => t.description === 'Payment from AMIC QUALSEVOL')!.needsReview).toBeUndefined();
    expect(out.find((t) => t.description === 'Mercadona')!.categoryId).toBe('oci');
  });

  it('regenerar les regles per defecte manté les de l\'usuari i les desactivades', () => {
    const mine: Rule = { id: 'u1', name: 'x', priority: 1, when: {}, then: {} };
    const base = refreshBuiltInRules([mine], SAMPLE_SETTINGS);
    const withDisabled = base.map((r) => (r.id === 'revolut-atm' ? { ...r, enabled: false } : r));
    const next = refreshBuiltInRules(withDisabled, { ownerName: '', employerPattern: '' });
    expect(next.find((r) => r.id === 'u1')).toBeDefined();
    expect(next.find((r) => r.id === 'revolut-atm')!.enabled).toBe(false);
    expect(next.find((r) => r.id === 'revolut-joint-out')).toBeUndefined();
  });
});
