import { useEffect, useRef, useState } from 'react';
import { todayIso } from '../../domain/dates';
import { migrateDebtSplits } from '../../domain/shared';
import type { SharedItem } from '../../domain/types';
import type { BudgetState } from '../useBudget';

/**
 * En obrir l'app, passa a Compartit les despeses repartides que encara són a Deutes (format antic).
 * Ordre: primer les coses compartides i els moviments, i al final s'esborren els deutes; si es talla
 * a mitges, la propera vegada es torna a fer igual (ids deterministes).
 */
export function useDebtSplitMigration(budget: BudgetState) {
  const done = useRef(false);
  const [migrated, setMigrated] = useState<SharedItem[]>([]);
  const { data, run } = budget;

  useEffect(() => {
    if (!data || done.current) return;
    done.current = true;
    const plan = migrateDebtSplits(data.debts, data.transactions, todayIso());
    if (plan.shared.length === 0) return;
    void run(async (repo) => {
      await repo.upsertShared(plan.shared);
      if (plan.txs.length) await repo.upsertTransactions(plan.txs);
      await repo.deleteDebts(plan.deleteDebtIds);
    }).then((ok) => ok && setMigrated(plan.shared));
  }, [data, run]);

  return { migrated, dismiss: () => setMigrated([]) };
}
