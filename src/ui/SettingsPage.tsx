import { useState } from 'react';
import type { BudgetData } from '../application/ports';
import { refreshBuiltInRules } from '../application/seed';
import { LOCAL_BUDGET_ID, readStoredBudget } from '../infrastructure/keyValueRepository';
import { Button, buttonClass } from './kit/Button';
import { Card, CardHeader, PageHeader } from './kit/Card';
import { Alert } from './kit/Feedback';
import { Icon } from './kit/Icon';
import type { BudgetState } from './useBudget';

export function SettingsPage({ budget, cloud = false }: { budget: BudgetState; cloud?: boolean }) {
  const { data, run, setError } = budget;
  const [ownerName, setOwnerName] = useState(data?.settings.ownerName ?? '');
  const [employerPattern, setEmployerPattern] = useState(data?.settings.employerPattern ?? '');
  const [saved, setSaved] = useState(false);
  const [localCopy] = useState(() => (cloud ? readStoredBudget(window.localStorage, LOCAL_BUDGET_ID) : null));
  if (!data) return null;

  async function save() {
    const settings = { ownerName: ownerName.trim(), employerPattern: employerPattern.trim() };
    await run(async (repo) => {
      await repo.saveSettings(settings);
      const rules = refreshBuiltInRules(data!.rules, settings, new Set(data!.categories.map((c) => c.id)));
      await repo.deleteRules(data!.rules.filter((r) => r.builtIn).map((r) => r.id));
      await repo.upsertRules(rules);
    });
    setSaved(true);
  }

  function exportBackup() {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `pressupostos-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function restore(parsed: BudgetData) {
    if (!Array.isArray(parsed.transactions) || !Array.isArray(parsed.accounts)) throw new Error('No és una còpia de seguretat vàlida');
    if (!window.confirm(`Substituir totes les dades actuals per la còpia (${parsed.transactions.length} moviments)?`)) return;
    await run((repo) => repo.replaceAll(parsed));
  }

  async function importBackup(file: File) {
    try {
      await restore(JSON.parse(await file.text()) as BudgetData);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <section className="max-w-3xl">
      <PageHeader title="Configuració" />

      <Card className="mb-6">
        <CardHeader title="Detecció automàtica" subtitle="Ajuda les regles per defecte a reconèixer traspassos propis i la nòmina." />
        <div className="space-y-5 p-5">
          <label className="label">
            El teu nom tal com surt als extractes
            <input className="input" value={ownerName} onChange={(e) => setOwnerName(e.target.value)} placeholder="NOM COGNOM1 COGNOM2" />
            <span className="hint">Serveix per detectar traspassos entre comptes teus i el compte conjunt.</span>
          </label>
          <label className="label">
            Text que identifica la teva nòmina
            <input className="input" value={employerPattern} onChange={(e) => setEmployerPattern(e.target.value)} placeholder="p.ex. MULTIPLAYER GAMES GROUP" />
          </label>
          {saved && <Alert tone="pos">Desat. Ves a Regles → Reaplicar per actualitzar els moviments ja importats.</Alert>}
        </div>
        <div className="border-t border-line px-5 py-4">
          <Button variant="primary" onClick={save}>
            Desar
          </Button>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Còpia de seguretat"
          subtitle={
            cloud
              ? 'Les dades es guarden al núvol (Firestore). Pots descarregar-ne una còpia quan vulguis.'
              : 'Les dades es guarden només en aquest navegador. Fes-ne còpies de seguretat.'
          }
        />
        <div className="space-y-4 p-5">
          {localCopy && (
            <Alert
              tone="warn"
              action={
                <Button size="sm" onClick={() => restore(localCopy).catch((e: unknown) => setError(String(e)))}>
                  Copiar-les al núvol
                </Button>
              }
            >
              Aquest navegador té dades de la versió local ({localCopy.transactions.length} moviments, {localCopy.accounts.length} comptes).
            </Alert>
          )}
          <div className="flex flex-wrap gap-2">
            <Button icon="download" onClick={exportBackup}>
              Descarregar còpia (JSON)
            </Button>
            <label className={buttonClass('secondary')}>
              <Icon name="upload" />
              Restaurar còpia
              <input type="file" accept="application/json" hidden onChange={(e) => e.target.files?.[0] && importBackup(e.target.files[0])} />
            </label>
          </div>
        </div>
      </Card>
    </section>
  );
}
