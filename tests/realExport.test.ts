import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { importText } from './helpers';

/**
 * Prova opcional amb un export real (que MAI es puja al repo).
 * Executa: REVOLUT_CSV=private/export.csv OWNER_NAME="NOM COGNOMS" npm run test:run
 */
const path = process.env.REVOLUT_CSV;
const run = path && existsSync(path) ? describe : describe.skip;

run('export real de Revolut', () => {
  it('importa sense errors i el saldo quadra', () => {
    const { result, plan } = importText(readFileSync(path!, 'utf-8'), {
      ownerName: process.env.OWNER_NAME ?? '',
      employerPattern: process.env.EMPLOYER ?? '',
    });
    expect(result.issues).toEqual([]);
    expect(plan.transactions.length).toBeGreaterThan(0);
    const kinds = plan.byKind;
    console.table({ ...kinds, needsReview: plan.needsReview, skipped: result.skipped.length });
  });
});
