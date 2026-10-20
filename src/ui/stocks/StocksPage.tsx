import { useMemo, useState, type FormEvent } from 'react';
import { todayIso } from '../../domain/dates';
import { formatCents, parseUserNumber } from '../../domain/money';
import { fmtQty, holdingsValuation, portfolioSummary, realizedByYear, saveFxRate, type StockPosition } from '../../domain/stocks';
import type { FxRate } from '../../domain/types';
import { errorText } from '../goals/shared';
import { Button } from '../kit/Button';
import { Card, CardHeader, PageHeader, Stat } from '../kit/Card';
import { cx } from '../kit/cx';
import { Drawer } from '../kit/Drawer';
import { Alert, Badge, EmptyState } from '../kit/Feedback';
import { Icon } from '../kit/Icon';
import { formatDate, formatPct } from '../labels';
import type { BudgetState } from '../useBudget';
import { formatPrice, numberToInput } from './format';
import { HoldingDrawer, HoldingForm } from './HoldingDrawer';

type Open = { mode: 'new' } | { mode: 'view'; id: string } | null;

const tone = (cents: number | undefined) => (cents === undefined || cents === 0 ? undefined : cents > 0 ? 'pos' : 'neg');
const signed = (cents: number) => `${cents > 0 ? '+' : ''}${formatCents(cents)}`;

/**
 * Accions, ETF i fons: què tens, quant t'ha costat, quant val ara i quant has guanyat. Els preus
 * s'apunten a mà; els guanys realitzats per any (FIFO, en EUR) serveixen per a la renda.
 */
export function StocksPage({ budget }: { budget: BudgetState }) {
  const { data } = budget;
  const [open, setOpen] = useState<Open>(null);
  const [showClosed, setShowClosed] = useState(false);
  const holdings = useMemo(() => (data?.holdings ?? []).filter((h) => !h.archived), [data]);
  const rates = useMemo(() => data?.fxRates ?? [], [data]);
  const summary = useMemo(() => {
    try {
      return { ok: portfolioSummary(holdings, rates) };
    } catch (e) {
      return { error: errorText(e) };
    }
  }, [holdings, rates]);
  if (!data) return null;

  const newButton = (
    <Button variant="primary" icon="plus" onClick={() => setOpen({ mode: 'new' })}>
      Nou valor
    </Button>
  );
  const s = summary.ok;
  const currencies = [...new Set(holdings.map((h) => h.currency).filter((c) => c !== 'EUR'))].sort();
  const years = s ? realizedByYear([...s.open, ...s.closed]) : [];
  const brokers = data.accounts.filter((a) => holdings.some((h) => h.accountId === a.id));
  const viewing = open?.mode === 'view' ? data.holdings.find((h) => h.id === open.id) : undefined;

  return (
    <section className="max-w-5xl">
      <PageHeader
        title="Inversions"
        subtitle="Les teves accions, ETF i fons. Apunta les compres i vendes i, de tant en tant, el preu actual: el cost i els guanys es calculen (FIFO, com Hisenda)."
        actions={holdings.length > 0 && newButton}
      />

      {summary.error && (
        <Alert tone="neg" className="mb-6" title="Hi ha operacions que no quadren">
          {summary.error}
        </Alert>
      )}

      {holdings.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line-strong bg-surface">
          <EmptyState icon="briefcase" title="Encara no has apuntat cap inversió" action={newButton}>
            Afegeix un valor (p.ex. AAPL o VWCE) i les compres que n'has fet.
          </EmptyState>
        </div>
      ) : (
        s && (
          <>
            <Card className="mb-6 grid grid-cols-2 gap-5 p-5 sm:grid-cols-4 sm:p-6">
              <Stat label="Valor actual" value={formatCents(s.valueEurCents)} className="col-span-2 sm:col-span-1" hint={s.missingPrice.length ? `sense ${s.missingPrice.map((h) => h.symbol).join(', ')}` : undefined} />
              <Stat label="Invertit" value={formatCents(s.costEurCents)} size="md" hint="cost dels títols que tens" />
              <Stat
                label="Guany latent"
                value={signed(s.unrealizedEurCents)}
                tone={tone(s.unrealizedEurCents)}
                size="md"
                hint={s.costEurCents > 0 && !s.missingPrice.length ? formatPct(s.unrealizedEurCents / s.costEurCents, 1) : undefined}
              />
              <Stat label="Guany realitzat" value={signed(s.realizedEurCents)} tone={tone(s.realizedEurCents)} size="md" hint="vendes, des del principi" />
            </Card>

            {s.missingRates.length > 0 && (
              <Alert tone="warn" className="mb-6" title="Falta el tipus de canvi">
                Apunta quants euros val 1 {s.missingRates.join(' / ')} a la secció de tipus de canvi per veure el valor en euros.
              </Alert>
            )}

            <Card className="mb-6">
              <CardHeader title="Posicions" subtitle={`${s.open.length} ${s.open.length === 1 ? 'valor' : 'valors'}`} />
              {s.open.length === 0 ? (
                <p className="px-5 py-6 text-sm text-ink-muted">Ara mateix no tens cap títol: ho has venut tot.</p>
              ) : (
                <ul className="divide-y divide-line">
                  {s.open.map((p) => (
                    <PositionRow key={p.holding.id} p={p} total={s.valueEurCents} onClick={() => setOpen({ mode: 'view', id: p.holding.id })} />
                  ))}
                </ul>
              )}
              {s.closed.length > 0 && (
                <div className="border-t border-line px-5 py-3">
                  <button className="text-sm font-medium text-accent" onClick={() => setShowClosed((v) => !v)}>
                    {showClosed ? 'Amagar' : 'Veure'} els venuts del tot ({s.closed.length})
                  </button>
                </div>
              )}
              {showClosed && (
                <ul className="divide-y divide-line border-t border-line">
                  {s.closed.map((p) => (
                    <PositionRow key={p.holding.id} p={p} total={0} onClick={() => setOpen({ mode: 'view', id: p.holding.id })} />
                  ))}
                </ul>
              )}
            </Card>

            <div className="grid gap-6 lg:grid-cols-2">
              {currencies.length > 0 && <FxRates budget={budget} currencies={currencies} rates={rates} />}
              {brokers.length > 0 && <BrokerValuations budget={budget} accounts={brokers} />}
              {years.length > 0 && (
                <Card className="lg:col-span-2">
                  <CardHeader title="Guanys realitzats per any" subtitle="En euros i amb FIFO: és el que va a la declaració de la renda (guanys i pèrdues patrimonials)." />
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="text-left text-xs text-ink-muted">
                        <tr className="border-b border-line">
                          <th className="px-5 py-2 font-medium">Any</th>
                          <th className="px-3 py-2 text-right font-medium">Vendes</th>
                          <th className="px-3 py-2 text-right font-medium">Transmissió</th>
                          <th className="px-3 py-2 text-right font-medium">Adquisició</th>
                          <th className="px-5 py-2 text-right font-medium">Guany</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-line">
                        {years.map((y) => (
                          <tr key={y.year}>
                            <td className="px-5 py-2.5 font-medium">{y.year}</td>
                            <td className="px-3 py-2.5 text-right text-ink-muted" title={y.sales.map((x) => `${x.holding.symbol} ${formatDate(x.date.slice(0, 10))}`).join('\n')}>
                              {y.sales.length}
                            </td>
                            <td className="amount px-3 py-2.5 text-right">{formatCents(y.proceedsEurCents)}</td>
                            <td className="amount px-3 py-2.5 text-right">{formatCents(y.costEurCents)}</td>
                            <td className={cx('amount px-5 py-2.5 text-right font-semibold', y.gainEurCents > 0 ? 'text-pos' : y.gainEurCents < 0 && 'text-neg')}>{signed(y.gainEurCents)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>
              )}
            </div>
          </>
        )
      )}

      {open?.mode === 'new' && (
        <Drawer open onClose={() => setOpen(null)} title="Nou valor" subtitle="Després hi podràs afegir les compres">
          <HoldingForm budget={budget} onDone={(id) => setOpen({ mode: 'view', id })} onCancel={() => setOpen(null)} />
        </Drawer>
      )}
      {viewing && <HoldingDrawer budget={budget} holding={viewing} onClose={() => setOpen(null)} />}
    </section>
  );
}

function PositionRow({ p, total, onClick }: { p: StockPosition; total: number; onClick: () => void }) {
  const h = p.holding;
  const share = total > 0 && p.valueEurCents !== undefined ? p.valueEurCents / total : undefined;
  return (
    <li>
      <button className="group flex w-full items-center gap-4 px-4 py-3.5 text-left hover:bg-subtle/60 sm:px-5" onClick={onClick}>
        <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-accent-soft text-[11px] font-bold tracking-tight text-accent-ink">{h.symbol.slice(0, 5)}</div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium">{h.name || h.symbol}</span>
            {h.currency !== 'EUR' && <Badge>{h.currency}</Badge>}
          </div>
          <div className="mt-0.5 truncate text-xs text-ink-muted">
            {p.quantity > 0
              ? [`${fmtQty(p.quantity)} títols`, `mitjà ${formatPrice(p.avgPriceCents, h.currency)}`, p.priceCents !== undefined ? `ara ${formatPrice(p.priceCents, h.currency)} (${formatDate(p.priceDate!.slice(0, 10))})` : 'sense preu'].join(' · ')
              : `Venut · guany ${signed(p.realizedEurCents)}`}
          </div>
        </div>
        {p.quantity > 0 && (
          <div className="text-right">
            <div className="amount text-sm font-semibold">{p.valueEurCents !== undefined ? formatCents(p.valueEurCents) : p.valueCents !== undefined ? formatCents(p.valueCents, h.currency) : '—'}</div>
            <div className={cx('amount text-xs', p.unrealizedCents === undefined ? 'text-ink-faint' : p.unrealizedCents >= 0 ? 'text-pos' : 'text-neg')}>
              {p.unrealizedRatio !== undefined ? `${p.unrealizedRatio > 0 ? '+' : ''}${formatPct(p.unrealizedRatio, 1)}` : share !== undefined ? formatPct(share, 0) : ''}
              {share !== undefined && p.unrealizedRatio !== undefined && <span className="text-ink-faint max-sm:hidden"> · {formatPct(share, 0)} cartera</span>}
            </div>
          </div>
        )}
        <Icon name="chevronRight" className="size-4 text-ink-faint opacity-0 transition group-hover:opacity-100" />
      </button>
    </li>
  );
}

function FxRates({ budget, currencies, rates }: { budget: BudgetState; currencies: string[]; rates: FxRate[] }) {
  return (
    <Card>
      <CardHeader title="Tipus de canvi" subtitle="Euros per unitat. Actualitza'l quan apuntis preus nous." />
      <ul className="divide-y divide-line">
        {currencies.map((c) => (
          <FxRow key={c} budget={budget} currency={c} rate={rates.find((r) => r.id === c)} />
        ))}
      </ul>
    </Card>
  );
}

function FxRow({ budget, currency, rate }: { budget: BudgetState; currency: string; rate?: FxRate }) {
  const [value, setValue] = useState(numberToInput(rate?.eurPerUnit));
  const [error, setError] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      setError(null);
      const next = saveFxRate(currency, parseUserNumber(value), todayIso());
      await budget.run((repo) => repo.upsertFxRates([next]));
    } catch (err) {
      setError(errorText(err));
    }
  }
  return (
    <li className="px-5 py-3">
      <form className="flex items-center gap-3" onSubmit={submit}>
        <span className="w-24 text-sm font-medium">1 {currency} =</span>
        <input className="input h-8 w-28 text-right tabular-nums" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} placeholder="0,92" aria-label={`Euros per ${currency}`} />
        <span className="text-sm text-ink-muted">€</span>
        <div className="flex-1 text-right text-xs text-ink-faint">{rate ? formatDate(rate.date.slice(0, 10)) : 'sense apuntar'}</div>
        <Button size="sm" type="submit" disabled={!value.trim() || value === numberToInput(rate?.eurPerUnit)}>
          Desar
        </Button>
      </form>
      {error && <p className="mt-1 text-xs text-neg">{error}</p>}
    </li>
  );
}

function BrokerValuations({ budget, accounts }: { budget: BudgetState; accounts: { id: string; name: string }[] }) {
  const data = budget.data!;
  const [message, setMessage] = useState<{ tone: 'pos' | 'neg'; text: string } | null>(null);
  async function save(accountId: string, name: string) {
    try {
      const today = todayIso().slice(0, 10);
      // Una valoració per compte i dia: tornar-la a desar el mateix dia la substitueix.
      const v = holdingsValuation(accountId, data.holdings, data.fxRates, today, `val_stocks_${accountId}_${today}`);
      if (!window.confirm(`Desar ${formatCents(v.valueCents)} com a valor de ${name} a dia d'avui?`)) return;
      const ok = await budget.run((repo) => repo.upsertValuations([v]));
      if (ok) setMessage({ tone: 'pos', text: `${name}: valoració de ${formatCents(v.valueCents)} desada.` });
    } catch (err) {
      setMessage({ tone: 'neg', text: errorText(err) });
    }
  }
  return (
    <Card>
      <CardHeader title="Valor als comptes" subtitle="Desa el valor de les accions com a valoració del compte del broker, perquè el patrimoni i les gràfiques el recullin. Si hi tens també efectiu, no hi és inclòs." />
      <div className="space-y-3 p-5">
        {message && (
          <Alert tone={message.tone} onClose={() => setMessage(null)}>
            {message.text}
          </Alert>
        )}
        {accounts.map((a) => {
          const last = data.valuations.filter((v) => v.accountId === a.id).sort((x, y) => y.date.localeCompare(x.date))[0];
          return (
            <div key={a.id} className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{a.name}</div>
                <div className="text-xs text-ink-muted">{last ? `última valoració ${formatCents(last.valueCents)} (${formatDate(last.date.slice(0, 10))})` : 'sense valoracions'}</div>
              </div>
              <Button size="sm" icon="check" onClick={() => save(a.id, a.name)}>
                Desar valor d'avui
              </Button>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

