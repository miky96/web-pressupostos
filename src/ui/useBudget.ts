import { useCallback, useEffect, useMemo, useState } from 'react';
import type { BudgetData, BudgetRepository } from '../application/ports';

/** Carrega el pressupost i ofereix `run` per fer canvis i refrescar la vista. */
export function useBudget(repo: BudgetRepository) {
  const [data, setData] = useState<BudgetData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setData(await repo.load());
  }, [repo]);

  useEffect(() => {
    reload().catch((e: unknown) => setError(String(e)));
  }, [reload]);

  const run = useCallback(
    async (action: (r: BudgetRepository) => Promise<unknown>) => {
      try {
        setError(null);
        await action(repo);
        await reload();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [repo, reload],
  );

  const lookups = useMemo(() => {
    const accounts = new Map((data?.accounts ?? []).map((a) => [a.id, a]));
    const categories = new Map((data?.categories ?? []).map((c) => [c.id, c]));
    return { accounts, categories };
  }, [data]);

  return { data, error, setError, run, lookups };
}

export type BudgetState = ReturnType<typeof useBudget>;

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}
