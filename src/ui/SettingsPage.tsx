import { useState } from 'react';
import type { BudgetData } from '../application/ports';
import { refreshBuiltInRules } from '../application/seed';
import type { BudgetState } from './useBudget';

export function SettingsPage({ budget }: { budget: BudgetState }) {
  const { data, run, setError } = budget;
  const [ownerName, setOwnerName] = useState(data?.settings.ownerName ?? '');
  const [employerPattern, setEmployerPattern] = useState(data?.settings.employerPattern ?? '');
  const [saved, setSaved] = useState(false);
  if (!data) return null;

  async function save() {
    const settings = { ownerName: ownerName.trim(), employerPattern: employerPattern.trim() };
    await run(async (repo) => {
      await repo.saveSettings(settings);
      const rules = refreshBuiltInRules(data!.rules, settings);
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

  async function importBackup(file: File) {
    try {
      const parsed = JSON.parse(await file.text()) as BudgetData;
      if (!Array.isArray(parsed.transactions) || !Array.isArray(parsed.accounts)) throw new Error('No és una còpia de seguretat vàlida');
      if (!window.confirm(`Substituir totes les dades actuals per la còpia (${parsed.transactions.length} moviments)?`)) return;
      await run((repo) => repo.replaceAll(parsed));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <section>
      <h2>Configuració</h2>
      <div className="card form-grid">
        <label className="wide">
          El teu nom tal com surt als extractes
          <input value={ownerName} onChange={(e) => setOwnerName(e.target.value)} placeholder="NOM COGNOM1 COGNOM2" />
          <span className="muted">Serveix per detectar traspassos entre comptes teus i el compte conjunt.</span>
        </label>
        <label className="wide">
          Text que identifica la teva nòmina
          <input value={employerPattern} onChange={(e) => setEmployerPattern(e.target.value)} placeholder="p.ex. MULTIPLAYER GAMES GROUP" />
        </label>
        <div className="wide">
          <button className="primary" onClick={save}>
            Desar
          </button>
          {saved && <span className="ok"> Desat. Ves a Regles → "Reaplicar" per actualitzar els moviments ja importats.</span>}
        </div>
      </div>

      <h3>Còpia de seguretat</h3>
      <p className="muted">
        De moment les dades es guarden només en aquest navegador. Fes-ne còpies fins que connectem Firebase.
      </p>
      <button onClick={exportBackup}>Descarregar còpia (JSON)</button>{' '}
      <label className="button">
        Restaurar còpia
        <input type="file" accept="application/json" hidden onChange={(e) => e.target.files?.[0] && importBackup(e.target.files[0])} />
      </label>
    </section>
  );
}
