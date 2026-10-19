import { useEffect, useRef, useState } from 'react';
import { todayIso } from '../../domain/dates';
import { planSubscriptionRun, type SubscriptionRun } from '../../domain/subscriptions';
import type { BudgetRepository } from '../../application/ports';
import type { BudgetState } from '../useBudget';

/** Desa el resultat d'una passada: primer els moviments, després fins on s'ha arribat. */
export async function applySubscriptionRun(repo: BudgetRepository, run: SubscriptionRun) {
  if (run.transactions.length) await repo.upsertTransactions(run.transactions);
  if (run.subscriptions.length) await repo.upsertSubscriptions(run.subscriptions);
}

/**
 * En obrir l'app, crea (o reconeix) els cobraments de subscripcions vençuts fins avui.
 * Només una vegada per sessió; retorna què s'ha creat per poder-ho avisar.
 */
export function useSubscriptionAutoRun(budget: BudgetState) {
  const done = useRef(false);
  const [created, setCreated] = useState<SubscriptionRun['created']>([]);
  const { data, run } = budget;

  useEffect(() => {
    if (!data || done.current) return;
    done.current = true;
    const currency = new Map(data.accounts.map((a) => [a.id, a.currency]));
    const plan = planSubscriptionRun(data.subscriptions, data.transactions, todayIso(), (id) => currency.get(id) ?? 'EUR');
    if (plan.subscriptions.length === 0) return;
    void run((repo) => applySubscriptionRun(repo, plan)).then(() => setCreated(plan.created));
  }, [data, run]);

  return { created, dismiss: () => setCreated([]) };
}
