/**
 * Tests de les regles de seguretat contra l'emulador de Firestore.
 * S'executen amb `npm run test:rules` (arrenca l'emulador, necessita Java 21+).
 */
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

const ALICE = { uid: 'alice', email: 'alice@example.com' };
const BOB = { uid: 'bob', email: 'bob@example.com' };
const MALLORY = { uid: 'mallory', email: 'mallory@example.com' }; // no és a la llista blanca

/** Les regles reals (plantilla), amb una llista blanca de proves. */
function rulesForTest(): string {
  const template = readFileSync('firestore.rules.template', 'utf8');
  if (!template.includes('ALLOWED_EMAILS_PLACEHOLDER')) throw new Error('No he trobat ALLOWED_EMAILS_PLACEHOLDER a firestore.rules.template');
  return template.replace('ALLOWED_EMAILS_PLACEHOLDER', `['${ALICE.email}', '${BOB.email}']`);
}

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-pressupostos', firestore: { rules: rulesForTest() } });
});
afterAll(() => env.cleanup());
beforeEach(() => env.clearFirestore());

const as = (u: { uid: string; email: string }, emailVerified = true) =>
  env.authenticatedContext(u.uid, { email: u.email, email_verified: emailVerified }).firestore();

async function seedBudget(id: string, members: Record<string, string>) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await db.doc(`budgets/${id}`).set({ name: 'x', members, settings: {} });
    await db.doc(`budgets/${id}/transactions/t1`).set({ id: 't1', amountCents: -100 });
  });
}

describe('pressupostos', () => {
  it("l'usuari es pot crear el seu pressupost personal i llegir-lo abans que existeixi", async () => {
    const db = as(ALICE);
    await assertSucceeds(db.doc('budgets/personal-alice').get());
    await assertSucceeds(db.doc('budgets/personal-alice').set({ name: 'Personal', members: { alice: 'owner' }, settings: {} }));
    await assertSucceeds(db.doc('budgets/personal-alice/transactions/t1').set({ id: 't1' }));
    await assertSucceeds(db.collection('budgets/personal-alice/transactions').get());
  });

  it('no es pot crear el pressupost personal d\'un altre ni afegir-hi altres membres', async () => {
    const db = as(ALICE);
    await assertFails(db.doc('budgets/personal-bob').set({ members: { alice: 'owner' } }));
    await assertFails(db.doc('budgets/b1').set({ members: { alice: 'owner', bob: 'owner' } }));
    await assertFails(db.doc('budgets/b2').set({ members: { bob: 'owner' } }));
    await assertFails(db.doc('budgets/b3').set({ members: { alice: 'editor' } }));
  });

  it('un altre usuari de la llista blanca no veu ni toca el teu pressupost', async () => {
    await seedBudget('personal-alice', { alice: 'owner' });
    const db = as(BOB);
    await assertFails(db.doc('budgets/personal-alice').get());
    await assertFails(db.doc('budgets/personal-alice/transactions/t1').get());
    await assertFails(db.collection('budgets/personal-alice/transactions').get());
    await assertFails(db.doc('budgets/personal-alice/transactions/t2').set({ id: 't2' }));
    await assertFails(db.doc('budgets/personal-alice').update({ members: { alice: 'owner', bob: 'owner' } }));
  });

  it("l'owner pot canviar la configuració però no els membres", async () => {
    await seedBudget('personal-alice', { alice: 'owner' });
    const db = as(ALICE);
    await assertSucceeds(db.doc('budgets/personal-alice').update({ settings: { ownerName: 'A' } }));
    await assertFails(db.doc('budgets/personal-alice').update({ members: { alice: 'owner', bob: 'viewer' } }));
    await assertFails(db.doc('budgets/personal-alice').delete());
  });

  it('un viewer pot llegir però no escriure', async () => {
    await seedBudget('shared', { alice: 'owner', bob: 'viewer' });
    const db = as(BOB);
    await assertSucceeds(db.doc('budgets/shared/transactions/t1').get());
    await assertFails(db.doc('budgets/shared/transactions/t1').set({ id: 't1', amountCents: 0 }));
    await assertFails(db.doc('budgets/shared').update({ settings: {} }));
  });

  it("l'owner pot gestionar deutes i esborrar categories; un altre usuari no", async () => {
    await seedBudget('personal-alice', { alice: 'owner' });
    await assertSucceeds(as(ALICE).doc('budgets/personal-alice/debts/d1').set({ id: 'd1', person: 'Pau', amountCents: 1000 }));
    await assertSucceeds(as(ALICE).collection('budgets/personal-alice/debts').get());
    await assertSucceeds(as(ALICE).doc('budgets/personal-alice/categories/oci').delete());
    await assertFails(as(BOB).doc('budgets/personal-alice/debts/d1').get());
    await assertFails(as(BOB).doc('budgets/personal-alice/debts/d2').set({ id: 'd2' }));
  });

  it('no es poden crear subcol·leccions desconegudes ni llistar pressupostos', async () => {
    await seedBudget('personal-alice', { alice: 'owner' });
    const db = as(ALICE);
    await assertFails(db.doc('budgets/personal-alice/secrets/x').set({ a: 1 }));
    await assertFails(db.collection('budgets').get());
  });
});

describe('accés', () => {
  it('fora de la llista blanca, sense verificar o sense login: res', async () => {
    await seedBudget('personal-mallory', { mallory: 'owner' });
    for (const db of [as(MALLORY), as(ALICE, false), env.unauthenticatedContext().firestore()]) {
      await assertFails(db.doc('budgets/personal-mallory').get());
      await assertFails(db.doc('budgets/personal-mallory/transactions/t1').get());
      await assertFails(db.doc('budgets/personal-x').set({ members: { mallory: 'owner' } }));
    }
  });
});

describe('usuaris', () => {
  it('cadascú només llegeix i escriu el seu document, amb camps coneguts', async () => {
    const db = as(ALICE);
    await assertSucceeds(db.doc('users/alice').set({ email: ALICE.email, defaultBudgetId: 'personal-alice' }));
    await assertSucceeds(db.doc('users/alice').get());
    await assertFails(db.doc('users/alice').set({ email: ALICE.email, admin: true }));
    await assertFails(db.doc('users/bob').get());
    await assertFails(db.doc('users/bob').set({ email: 'x' }));
  });
});
