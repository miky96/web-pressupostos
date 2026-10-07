import { useMemo, useState } from 'react';
import type { BudgetRepository } from '../application/ports';
import { AccountsPage } from './AccountsPage';
import { ImportPage } from './ImportPage';
import { cx } from './kit/cx';
import { Alert } from './kit/Feedback';
import { Icon, type IconName } from './kit/Icon';
import { RulesPage } from './RulesPage';
import { SettingsPage } from './SettingsPage';
import { TransactionsPage } from './TransactionsPage';
import { useBudget } from './useBudget';

const TABS: Record<string, { label: string; icon: IconName }> = {
  moviments: { label: 'Moviments', icon: 'list' },
  comptes: { label: 'Comptes', icon: 'wallet' },
  importar: { label: 'Importar', icon: 'upload' },
  regles: { label: 'Regles', icon: 'sliders' },
  configuracio: { label: 'Configuració', icon: 'settings' },
};
type Tab = keyof typeof TABS;

/** Present quan l'app funciona amb Firebase (hi ha un usuari autenticat). */
export interface AccountInfo {
  email: string | null;
  signOut: () => void;
}

export function Logo({ className }: { className?: string }) {
  return (
    <div className={cx('flex items-center gap-2.5', className)}>
      <div className="grid size-8 place-items-center rounded-lg bg-accent text-white shadow-xs">
        <Icon name="chart" className="size-[18px]" />
      </div>
      <span className="text-[15px] font-semibold tracking-tight">Pressupostos</span>
    </div>
  );
}

export function App({ repo, account }: { repo: BudgetRepository; account?: AccountInfo }) {
  const budget = useBudget(repo);
  const [tab, setTab] = useState<Tab>('moviments');
  const reviewCount = useMemo(() => budget.data?.transactions.filter((t) => t.needsReview && !t.hidden).length ?? 0, [budget.data]);

  const navItems = (Object.keys(TABS) as Tab[]).map((t) => ({ id: t, ...TABS[t], badge: t === 'moviments' ? reviewCount : 0 }));

  return (
    <div className="min-h-dvh lg:pl-60">
      {/* Navegació lateral (escriptori) */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-line bg-surface lg:flex">
        <Logo className="px-5 pt-5 pb-6" />
        <nav className="flex flex-col gap-0.5 px-3">
          {navItems.map((n) => (
            <button
              key={n.id}
              onClick={() => setTab(n.id)}
              className={cx(
                'flex h-9 items-center gap-3 rounded-lg px-3 text-sm font-medium transition',
                n.id === tab ? 'bg-accent-soft text-accent-ink' : 'text-ink-muted hover:bg-subtle hover:text-ink',
              )}
            >
              <Icon name={n.icon} className="size-[18px]" />
              <span className="flex-1 text-left">{n.label}</span>
              {n.badge > 0 && (
                <span className="rounded-full bg-warn-soft px-1.5 text-[11px] font-semibold text-warn" title="Per revisar">
                  {n.badge}
                </span>
              )}
            </button>
          ))}
        </nav>
        {account && (
          <div className="mt-auto flex items-center gap-2 border-t border-line px-4 py-3">
            <div className="grid size-8 place-items-center rounded-full bg-subtle text-xs font-semibold text-ink-muted uppercase">
              {account.email?.[0] ?? '?'}
            </div>
            <div className="min-w-0 flex-1 truncate text-xs text-ink-muted" title={account.email ?? ''}>
              {account.email}
            </div>
            <button className="rounded-lg p-1.5 text-ink-muted hover:bg-subtle hover:text-ink" onClick={account.signOut} title="Sortir">
              <Icon name="logout" />
            </button>
          </div>
        )}
      </aside>

      {/* Capçalera (mòbil) */}
      <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-line bg-surface/90 px-4 backdrop-blur lg:hidden">
        <Logo />
        {account && (
          <button className="rounded-lg p-2 text-ink-muted hover:bg-subtle" onClick={account.signOut} title="Sortir">
            <Icon name="logout" />
          </button>
        )}
      </header>

      <main className="mx-auto max-w-6xl px-4 pt-6 pb-28 sm:px-6 lg:px-10 lg:pt-10 lg:pb-16">
        {budget.error && (
          <Alert tone="neg" className="mb-6" onClose={() => budget.setError(null)}>
            {budget.error}
          </Alert>
        )}
        {!budget.data && <div className="py-20 text-center text-sm text-ink-muted">Carregant…</div>}
        {tab === 'moviments' && <TransactionsPage budget={budget} onNavigate={setTab} />}
        {tab === 'comptes' && <AccountsPage budget={budget} />}
        {tab === 'importar' && <ImportPage budget={budget} />}
        {tab === 'regles' && <RulesPage budget={budget} />}
        {tab === 'configuracio' && <SettingsPage budget={budget} cloud={!!account} />}
      </main>

      {/* Barra inferior (mòbil) */}
      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
        {navItems.map((n) => (
          <button
            key={n.id}
            onClick={() => setTab(n.id)}
            className={cx('relative flex flex-col items-center gap-1 py-2 text-[11px] font-medium', n.id === tab ? 'text-accent' : 'text-ink-faint')}
          >
            <Icon name={n.icon} className="size-5" />
            {n.label}
            {n.badge > 0 && <span className="absolute top-1.5 left-1/2 ml-2 size-2 rounded-full bg-warn" />}
          </button>
        ))}
      </nav>
    </div>
  );
}
