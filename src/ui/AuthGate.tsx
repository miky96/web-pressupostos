import { useEffect, useState } from 'react';
import type { BudgetRepository, SessionService, SessionUser } from '../application/ports';
import { App } from './App';

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
    <div className="app">
      <div className="card login">
        <h1>Pressupostos</h1>
        {emulated && <p className="warning">Mode emulador: les dades són locals i es perden en aturar-lo.</p>}
        {(state.status === 'checking' || state.status === 'opening') && <p className="muted">Carregant…</p>}
        {state.status === 'signedOut' && (
          <button className="primary" onClick={signIn}>
            Entra amb Google
          </button>
        )}
        {state.status === 'denied' && (
          <>
            <p className="error">{state.message}</p>
            <button onClick={() => session.signOut()}>Sortir i provar amb un altre compte</button>
          </>
        )}
        {error && <p className="error">{error}</p>}
      </div>
    </div>
  );
}
