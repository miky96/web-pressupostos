import { shiftPeriod, type Period } from '../../domain/periods';
import { Button } from '../kit/Button';
import { Segmented } from '../kit/Feedback';
import { formatPeriod } from '../labels';

/** ◀ Octubre 2026 ▶ + Mes / Any / Tot / Rang */
export function PeriodPicker({ period, onChange, defaultMonth }: { period: Period; onChange: (p: Period) => void; defaultMonth: string }) {
  const prev = shiftPeriod(period, -1);
  const next = shiftPeriod(period, 1);

  function changeKind(kind: Period['kind']) {
    if (kind === period.kind) return;
    // Mantenir el context: si estàs veient el 2025 i passes a "Mes", vas a un mes del 2025.
    const year = period.kind === 'year' ? period.year : period.kind === 'month' ? period.month.slice(0, 4) : defaultMonth.slice(0, 4);
    const month = period.kind === 'month' ? period.month : year === defaultMonth.slice(0, 4) ? defaultMonth : `${year}-12`;
    if (kind === 'month') onChange({ kind, month });
    else if (kind === 'year') onChange({ kind, year });
    else if (kind === 'range') onChange({ kind, from: `${month}-01` });
    else onChange({ kind });
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex items-center gap-1">
        {prev && <Button variant="ghost" icon="chevronLeft" onClick={() => onChange(prev)} aria-label="Anterior" />}
        {period.kind === 'range' ? (
          <div className="flex items-center gap-2">
            <input
              type="date"
              className="input h-9 w-auto"
              value={period.from ?? ''}
              onChange={(e) => onChange({ ...period, from: e.target.value || undefined })}
              aria-label="Des de"
            />
            <span className="text-ink-faint">–</span>
            <input
              type="date"
              className="input h-9 w-auto"
              value={period.to ?? ''}
              onChange={(e) => onChange({ ...period, to: e.target.value || undefined })}
              aria-label="Fins a"
            />
          </div>
        ) : (
          <h2 className="min-w-36 text-center text-lg font-semibold">{formatPeriod(period)}</h2>
        )}
        {next && <Button variant="ghost" icon="chevronRight" onClick={() => onChange(next)} aria-label="Següent" />}
      </div>
      <Segmented
        value={period.kind}
        onChange={changeKind}
        options={[
          { value: 'month', label: 'Mes' },
          { value: 'year', label: 'Any' },
          { value: 'all', label: 'Tot' },
          { value: 'range', label: 'Dates' },
        ]}
      />
    </div>
  );
}
