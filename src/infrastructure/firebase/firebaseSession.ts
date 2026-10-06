import { GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth';
import { doc, getDoc, serverTimestamp, setDoc, updateDoc, type Firestore } from 'firebase/firestore';
import type { BudgetRepository, SessionService, SessionUser } from '../../application/ports';
import { initialData } from '../../application/seed';
import { CachedBudgetRepository } from '../cachedRepository';
import type { FirebaseHandles } from './firebaseApp';
import { FirestoreBudgetStore } from './firestoreStore';

/** Id determinista del pressupost personal: reintentar la creació és idempotent. */
export const personalBudgetId = (uid: string) => `personal-${uid}`;

/**
 * Primer accés: crea budgets/personal-{uid} (amb l'usuari com a owner), hi posa les
 * categories i regles per defecte i, al final, users/{uid}. Si falla a mig camí, el
 * següent accés ho reprèn gràcies a `seeded`.
 */
export async function ensureDefaultBudget(db: Firestore, user: SessionUser): Promise<BudgetRepository> {
  const userRef = doc(db, 'users', user.uid);
  const userSnap = await getDoc(userRef);
  const budgetId = (userSnap.exists() && (userSnap.data().defaultBudgetId as string | undefined)) || personalBudgetId(user.uid);
  const repo = new CachedBudgetRepository(new FirestoreBudgetStore(db, budgetId), budgetId);

  const budgetRef = doc(db, 'budgets', budgetId);
  const budgetSnap = await getDoc(budgetRef);
  if (!budgetSnap.exists()) {
    const seed = initialData();
    await setDoc(budgetRef, {
      name: 'Personal',
      members: { [user.uid]: 'owner' },
      settings: seed.settings,
      seeded: false,
      createdAt: serverTimestamp(),
    });
  }
  if (!budgetSnap.exists() || budgetSnap.data().seeded !== true) {
    const seed = initialData();
    await repo.upsertCategories(seed.categories);
    await repo.upsertRules(seed.rules);
    await updateDoc(budgetRef, { seeded: true });
  }
  if (!userSnap.exists()) {
    await setDoc(userRef, { email: user.email, defaultBudgetId: budgetId, createdAt: serverTimestamp() });
  }
  return repo;
}

export function firebaseSession({ auth, db }: FirebaseHandles): SessionService {
  const toUser = (u: { uid: string; email: string | null; displayName: string | null }): SessionUser => ({
    uid: u.uid,
    email: u.email,
    displayName: u.displayName,
  });
  return {
    onChange: (listener) => onAuthStateChanged(auth, (u) => listener(u ? toUser(u) : null)),
    signIn: async () => {
      await signInWithPopup(auth, new GoogleAuthProvider());
    },
    signOut: () => signOut(auth),
    openBudget: (user) => ensureDefaultBudget(db, user),
  };
}
