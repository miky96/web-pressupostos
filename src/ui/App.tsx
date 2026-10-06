import { useMemo, useState } from 'react';
import type { BudgetRepository } from '../application/ports';
import { AccountsPage } from './AccountsPage';
import { ImportPage } from './ImportPage';
import { RulesPage } from './RulesPage';
import { SettingsPage } from './SettingsPage';
import { TransactionsPage } from './TransactionsPage';
import { useBudget } from './useBudget';

const TABS = {
  moviments: 'Moviments',
  comptes: 'Comptes',
  importar: 'Importar',
  regles: 'Regles',
  configuracio: 'Configuració',
} as const;
type Tab = keyof typeof TABS;

export function App({ repo }: { repo: BudgetRepository }) {
  const budget = useBudget(repo);
  const [tab, setTab] = useState<Tab>('moviments');
  const reviewCount = useMemo(() => budget.data?.transactions.filter((t) => t.needsReview && !t.hidden).length ?? 0, [budget.data]);

  return (
    <div className="app">
      <header>
        <h1>Pressupostos</h1>
        <nav>
          {(Object.keys(TABS) as Tab[]).map((t) => (
            <button key={t} className={t === tab ? 'active' : ''} onClick={() => setTab(t)}>
              {TABS[t]}
              {t === 'moviments' && reviewCount > 0 && <span className="pill" title="Per revisar">{reviewCount}</span>}
            </button>
          ))}
        </nav>
      </header>
      {budget.error && (
        <div className="error" role="alert">
          {budget.error} <button className="link" onClick={() => budget.setError(null)}>✕</button>
        </div>
      )}
      <main>
        {!budget.data && <p>Carregant…</p>}
        {tab === 'moviments' && <TransactionsPage budget={budget} />}
        {tab === 'comptes' && <AccountsPage budget={budget} />}
        {tab === 'importar' && <ImportPage budget={budget} />}
        {tab === 'regles' && <RulesPage budget={budget} />}
        {tab === 'configuracio' && <SettingsPage budget={budget} />}
      </main>
    </div>
  );
}
