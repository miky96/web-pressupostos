import { useEffect, useState } from 'react';
import type { BudgetRepository, SessionService, SessionUser } from '../application/ports';
import { App, Logo } from './App';
import { Button } from './kit/Button';
import { Alert } from './kit/Feedback';

type State =
  | { status: 'checking' }
  | { status: 'signedOut' }
  | { status: 'opening'; user: SessionUser }
  | { status: 'ready'; user: SessionUser; repo: BudgetRepository }
  | { status: 'denied'; user: SessionUser; message: string };

function isPermissionError(e: unknown) {
  return typeof e === 'object' && e !== null && 'code' in e && (e as { code: string }).code === 'permission-denied';
}

/** Mostra el login, obre el pressupost de l'usuari i, quan és a punt, l'App. */
export function AuthGate({ session, emulated }: { session: SessionService; emulated?: boolean }) {
  const [state, setState] = useState<State>({ status: 'checking' });
  const [error, setError] = useState<string | null>(null);

  useEffect(
    () =>
      session.onChange((user) => {
        if (!user) return setState({ status: 'signedOut' });
        setState({ status: 'opening', user });
        session
          .openBudget(user)
          .then((repo) => setState({ status: 'ready', user, repo }))
          .catch((e: unknown) =>
            setState({
              status: 'denied',
              user,
              message: isPermissionError(e)
                ? `El compte ${user.email ?? ''} no té accés a aquesta app (no és a la llista blanca o les regles de Firestore no estan publicades).`
                : `No s'ha pogut obrir el pressupost: ${e instanceof Error ? e.message : String(e)}`,
            }),
          );
      }),
    [session],
  );

  async function signIn() {
    try {
      setError(null);
      await session.signIn();
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code !== 'auth/popup-closed-by-user' && code !== 'auth/cancelled-popup-request') setError(e instanceof Error ? e.message : String(e));
    }
  }

  if (state.status === 'ready') {
    return <App repo={state.repo} account={{ email: state.user.email, signOut: () => session.signOut() }} />;
  }

  return (
    <div className="grid min-h-dvh place-items-center bg-canvas px-4">
      <div className="w-full max-w-sm rounded-2xl border border-line bg-surface p-8 text-center shadow-pop">
        <div className="mb-6 flex justify-center">
          <Logo />
        </div>
        <h1 className="text-xl font-semibold">Benvingut</h1>
        <p className="mt-1 mb-6 text-sm text-ink-muted">Controla ingressos, despeses i estalvi dels teus comptes.</p>
        <div className="space-y-4">
          {emulated && <Alert tone="warn">Mode emulador: les dades són locals i es perden en aturar-lo.</Alert>}
          {(state.status === 'checking' || state.status === 'opening') && <p className="text-sm text-ink-muted">Carregant…</p>}
          {state.status === 'signedOut' && (
            <Button variant="primary" className="w-full" onClick={signIn}>
              Entra amb Google
            </Button>
          )}
          {state.status === 'denied' && (
            <>
              <Alert tone="neg">{state.message}</Alert>
              <Button className="w-full" onClick={() => session.signOut()}>
                Sortir i provar amb un altre compte
              </Button>
            </>
          )}
          {error && <Alert tone="neg">{error}</Alert>}
        </div>
      </div>
    </div>
  );
}
