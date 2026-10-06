import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { initFirebase } from './infrastructure/firebase/firebaseApp';
import { firebaseSession } from './infrastructure/firebase/firebaseSession';
import { KeyValueBudgetRepository, LOCAL_BUDGET_ID } from './infrastructure/keyValueRepository';
import { App } from './ui/App';
import { AuthGate } from './ui/AuthGate';
import './styles.css';

// Amb configuració de Firebase (.env.local o mode emulador): login + Firestore.
// Sense: tot al navegador (localStorage), útil per desenvolupar sense xarxa.
const firebase = initFirebase();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {firebase ? (
      <AuthGate session={firebaseSession(firebase)} emulated={firebase.emulated} />
    ) : (
      <App repo={new KeyValueBudgetRepository(window.localStorage, LOCAL_BUDGET_ID)} />
    )}
  </StrictMode>,
);
