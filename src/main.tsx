import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { KeyValueBudgetRepository } from './infrastructure/keyValueRepository';
import { App } from './ui/App';
import './styles.css';

// De moment: un sol pressupost personal guardat al navegador. Amb Firebase, el budgetId
// vindrà de l'usuari autenticat (users/{uid}.defaultBudgetId).
const repo = new KeyValueBudgetRepository(window.localStorage, 'personal');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App repo={repo} />
  </StrictMode>,
);
