import { useState } from 'react';
import { PageHeader } from '../kit/Card';
import { Segmented } from '../kit/Feedback';
import type { BudgetState } from '../useBudget';
import { SavingsGoals } from './SavingsGoals';
import { SpendingLimits } from './SpendingLimits';

type Section = 'estalvi' | 'limits';

const SECTIONS: { value: Section; label: string }[] = [
  { value: 'estalvi', label: "Objectius d'estalvi" },
  { value: 'limits', label: 'Límits de despesa' },
];

export function GoalsPage({ budget }: { budget: BudgetState }) {
  const [section, setSection] = useState<Section>('estalvi');
  if (!budget.data) return null;
  return (
    <section className="max-w-5xl">
      <PageHeader
        title="Objectius"
        subtitle={
          section === 'estalvi'
            ? "Fites d'estalvi amb seguiment automàtic: el saldo dels comptes que hi vinculis i les aportacions que hi apuntis a mà."
            : 'Un pressupost mensual per categoria. Compta la despesa neta (les devolucions i els Bizums enllaçats resten).'
        }
      />
      <div className="mb-6">
        <Segmented value={section} options={SECTIONS} onChange={setSection} />
      </div>
      {section === 'estalvi' ? <SavingsGoals budget={budget} /> : <SpendingLimits budget={budget} />}
    </section>
  );
}
