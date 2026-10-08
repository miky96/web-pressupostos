import { useCallback, useState } from 'react';
import type { ReportingView } from '../domain/recoveries';

const KEY = 'pressupostos:reporting-view';

function read(): ReportingView {
  try {
    return localStorage.getItem(KEY) === 'cash' ? 'cash' : 'consumption';
  } catch {
    return 'consumption';
  }
}

/** Vista de consum real o flux de caixa. Es recorda per navegador (preferència de qui mira). */
export function useReportingView() {
  const [view, setView] = useState<ReportingView>(read);
  const change = useCallback((v: ReportingView) => {
    setView(v);
    try {
      localStorage.setItem(KEY, v);
    } catch {
      // sense emmagatzematge: només dura la sessió
    }
  }, []);
  return [view, change] as const;
}

export const VIEW_OPTIONS: { value: ReportingView; label: string }[] = [
  { value: 'consumption', label: 'Consum real' },
  { value: 'cash', label: 'Flux de caixa' },
];

export const VIEW_HINT: Record<ReportingView, string> = {
  consumption: 'Les devolucions i els Bizums enllaçats compten al mes de la compra, i el que esperes recuperar ja no és despesa teva.',
  cash: 'Cada moviment compta el dia que passa pel banc.',
};
