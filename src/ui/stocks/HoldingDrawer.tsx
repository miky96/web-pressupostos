import { useState, type FormEvent } from 'react';
import { todayIso } from '../../domain/dates';
import { formatCents, parseUserAmount, parseUserNumber } from '../../domain/money';
import { eurRateFor, fmtQty, removeTrade, saveHolding, saveTrade, setLastPrice, stockPosition, type StockPosition } from '../../domain/stocks';
import type { StockHolding, StockTrade } from '../../domain/types';
import { errorText } from '../goals/shared';
import { Button } from '../kit/Button';
import { Stat } from '../kit/Card';
import { cx } from '../kit/cx';
import { Drawer } from '../kit/Drawer';
import { Alert, Badge, Segmented } from '../kit/Feedback';
import { formatDate, formatPct } from '../labels';
import { newId, type BudgetState } from '../useBudget';
import { formatPrice, numberToInput, parsePriceCents, tryNumber } from './format';

const today = () => todayIso().slice(0, 10);
const signed = (cents: number, currency = 'EUR') => `${cents > 0 ? '+' : ''}${formatCents(cents, currency)}`;

export function HoldingDrawer({ budget, holding, onClose }: { budget: BudgetState; holding: StockHolding; onClose: () => void }) {
  const data = budget.data!;
  const [editing, setEditing] = useState(false);
  const [trade, setTrade] = useState<StockTrade | 'new' | null>(null);
  const [error, setError] = useState<string | null>(null);
  let position: StockPosition | undefined;
  let positionError: string | undefined;
  try {
    position = stockPosition(holding, data.fxRates);
  } catch (e) {
    positionError = errorText(e);
  }
  const account = holding.accountId ? budget.lookups.accounts.get(holding.accountId) : undefined;

  async function save(next: StockHolding) {
    setError(null);
    return budget.run((repo) => repo.upsertHoldings([next]));
  }

  async function dropTrade(t: StockTrade) {
    try {
      const next = removeTrade(holding, t.id);
      if (!window.confirm(`Esborrar la ${t.side === 'buy' ? 'compra' : 'venda'} de ${fmtQty(t.quantity)} títols del ${formatDate(t.date.slice(0, 10))}?`)) return;
      await save(next);
    } catch (err) {
      setError(errorText(err));
    }
  }

  async function remove() {
    const msg = holding.trades.length
      ? `Eliminar ${holding.symbol} i les seves ${holding.trades.length} operacions? Si l'has venut del tot i vols conservar l'historial per a la renda, millor arxiva'l.`
      : `Eliminar ${holding.symbol}?`;
    if (!window.confirm(msg)) return;
    await budget.run((repo) => repo.deleteHoldings([holding.id]));
    onClose();
  }

  const p = position;
  return (
    <Drawer
      open
      onClose={onClose}
      title={holding.name ? `${holding.symbol} · ${holding.name}` : holding.symbol}
      subtitle={[holding.currency, account?.name].filter(Boolean).join(' · ')}
      footer={
        <>
          <Button variant="danger" icon="trash" onClick={remove}>
            Eliminar
          </Button>
          <div className="flex-1" />
          {p && p.quantity === 0 && holding.trades.length > 0 && (
            <Button onClick={() => save({ ...holding, archived: !holding.archived }).then(() => onClose())}>{holding.archived ? 'Desarxivar' : 'Arxivar'}</Button>
          )}
          <Button icon="edit" onClick={() => setEditing((v) => !v)}>
            {editing ? 'Tancar edició' : 'Editar'}
          </Button>
        </>
      }
    >
      {editing ? (
        <HoldingForm budget={budget} holding={holding} onDone={() => setEditing(false)} onCancel={() => setEditing(false)} />
      ) : (
        <div className="space-y-7">
          {error && (
            <Alert tone="neg" onClose={() => setError(null)}>
              {error}
            </Alert>
          )}
          {positionError && <Alert tone="neg" title="Les operacions no quadren">{positionError}</Alert>}
          {p && (
            <div className="grid grid-cols-2 gap-5">
              <Stat
                label="Valor"
                value={p.valueEurCents !== undefined ? formatCents(p.valueEurCents) : p.valueCents !== undefined ? formatCents(p.valueCents, holding.currency) : '—'}
                hint={p.valueCents !== undefined && holding.currency !== 'EUR' ? formatCents(p.valueCents, holding.currency) : undefined}
              />
              <Stat
                label="Guany latent"
                value={p.unrealizedEurCents !== undefined ? signed(p.unrealizedEurCents) : p.unrealizedCents !== undefined ? signed(p.unrealizedCents, holding.currency) : '—'}
                tone={p.unrealizedCents === undefined || p.unrealizedCents === 0 ? undefined : p.unrealizedCents > 0 ? 'pos' : 'neg'}
                hint={
                  p.unrealizedRatio !== undefined
                    ? `${formatPct(p.unrealizedRatio, 1)}${holding.currency !== 'EUR' && p.unrealizedCents !== undefined ? ` · ${signed(p.unrealizedCents, holding.currency)} sense divisa` : ''}`
                    : undefined
                }
              />
              <Stat label="Títols" value={fmtQty(p.quantity)} size="md" hint={p.quantity > 0 ? `preu mitjà ${formatPrice(p.avgPriceCents, holding.currency)}` : undefined} />
              <Stat label="Guany realitzat" value={signed(p.realizedEurCents)} size="md" tone={p.realizedEurCents > 0 ? 'pos' : p.realizedEurCents < 0 ? 'neg' : undefined} hint={p.feesCents ? `comissions ${formatCents(p.feesCents, holding.currency)}` : undefined} />
            </div>
          )}
          {p?.missingRate && <Alert tone="warn">Falta el tipus de canvi de {holding.currency} (a la pàgina d'Inversions): els imports en euros no es poden calcular.</Alert>}

          {(p?.quantity ?? 0) > 0 && <PriceForm holding={holding} onSave={(next) => save(next)} />}

          <div>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold">Operacions</h3>
              {trade === null && (
                <Button size="sm" icon="plus" onClick={() => setTrade('new')}>
                  Afegir
                </Button>
              )}
            </div>
            {trade !== null && (
              <div className="mb-3 rounded-lg bg-subtle/60 p-3">
                <TradeForm
                  key={trade === 'new' ? 'new' : trade.id}
                  holding={holding}
                  trade={trade === 'new' ? undefined : trade}
                  defaultRate={eurRateFor(holding.currency, data.fxRates)}
                  held={p?.quantity ?? 0}
                  onSave={async (next) => (await save(next)) && setTrade(null)}
                  onCancel={() => setTrade(null)}
                />
              </div>
            )}
            {holding.trades.length === 0 ? (
              <p className="text-sm text-ink-muted">Encara cap operació. Afegeix la primera compra.</p>
            ) : (
              <ul className="divide-y divide-line rounded-lg border border-line">
                {[...holding.trades].reverse().map((t) => {
                  const sale = p?.realized.find((r) => r.tradeId === t.id);
                  return (
                    <li key={t.id} className="flex items-center gap-3 px-3 py-2.5 text-sm">
                      <button className="min-w-0 flex-1 text-left" onClick={() => setTrade(t)}>
                        <div className="flex items-center gap-2">
                          <Badge tone={t.side === 'buy' ? 'neutral' : 'pos'}>{t.side === 'buy' ? 'compra' : 'venda'}</Badge>
                          <span className="font-medium">{fmtQty(t.quantity)} títols</span>
                          <span className="text-ink-muted">a {formatPrice(t.grossCents / t.quantity, holding.currency)}</span>
                        </div>
                        <div className="mt-0.5 text-xs text-ink-muted">
                          {[formatDate(t.date.slice(0, 10)), t.feeCents ? `comissió ${formatCents(t.feeCents, holding.currency)}` : undefined, t.eurRate ? `1 ${holding.currency} = ${numberToInput(t.eurRate, 4)} €` : undefined, t.note]
                            .filter(Boolean)
                            .join(' · ')}
                        </div>
                      </button>
                      <div className="text-right">
                        <div className="amount font-medium">{formatCents(t.side === 'buy' ? t.grossCents + t.feeCents : t.grossCents - t.feeCents, holding.currency)}</div>
                        {sale && <div className={cx('amount text-xs', sale.gainEurCents >= 0 ? 'text-pos' : 'text-neg')}>{signed(sale.gainEurCents)}</div>}
                      </div>
                      <Button variant="ghost" size="sm" icon="x" aria-label="Esborrar" title="Esborrar" onClick={() => dropTrade(t)} />
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          {holding.notes && <p className="text-sm whitespace-pre-wrap text-ink-muted">{holding.notes}</p>}
        </div>
      )}
    </Drawer>
  );
}

function PriceForm({ holding, onSave }: { holding: StockHolding; onSave: (h: StockHolding) => Promise<unknown> }) {
  const [price, setPrice] = useState('');
  const [date, setDate] = useState(today());
  const [error, setError] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      setError(null);
      await onSave(setLastPrice(holding, parsePriceCents(price), date));
      setPrice('');
    } catch (err) {
      setError(errorText(err));
    }
  }
  return (
    <form className="rounded-xl border border-line p-4" onSubmit={submit}>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-semibold">Preu actual</h3>
        <span className="text-xs text-ink-muted">
          {holding.lastPrice ? `${formatPrice(holding.lastPrice.cents, holding.currency)} el ${formatDate(holding.lastPrice.date.slice(0, 10))}` : 'Encara no n\'has apuntat cap'}
        </span>
      </div>
      <div className="flex gap-2">
        <input className="input" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder={`Preu (${holding.currency})`} aria-label="Preu per títol" required />
        <input className="input w-36 shrink-0" type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Data del preu" required />
        <Button type="submit" variant="primary">
          Desar
        </Button>
      </div>
      {error && <p className="mt-1.5 text-xs text-neg">{error}</p>}
    </form>
  );
}

function TradeForm({
  holding,
  trade,
  defaultRate,
  held,
  onSave,
  onCancel,
}: {
  holding: StockHolding;
  trade?: StockTrade;
  defaultRate?: number;
  held: number;
  onSave: (h: StockHolding) => Promise<unknown>;
  onCancel: () => void;
}) {
  const foreign = holding.currency !== 'EUR';
  const [side, setSide] = useState<StockTrade['side']>(trade?.side ?? 'buy');
  const [date, setDate] = useState(trade?.date.slice(0, 10) ?? today());
  const [quantity, setQuantity] = useState(numberToInput(trade?.quantity));
  const [mode, setMode] = useState<'price' | 'total'>(trade ? 'total' : 'price');
  const [price, setPrice] = useState('');
  const [total, setTotal] = useState(trade ? numberToInput(trade.grossCents / 100, 2) : '');
  const [fee, setFee] = useState(trade?.feeCents ? numberToInput(trade.feeCents / 100, 2) : '');
  const [rate, setRate] = useState(numberToInput(trade?.eurRate ?? (trade ? undefined : defaultRate), 6));
  const [note, setNote] = useState(trade?.note ?? '');
  const [error, setError] = useState<string | null>(null);

  const q = tryNumber(quantity);
  const pr = tryNumber(price);
  const preview = mode === 'price' && q && pr ? Math.round(q * pr * 100) : undefined;

  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      setError(null);
      const next = saveTrade(
        holding,
        {
          date,
          side,
          quantity: parseUserNumber(quantity),
          priceCents: mode === 'price' ? parsePriceCents(price) : undefined,
          grossCents: mode === 'total' ? parseUserAmount(total) : undefined,
          feeCents: fee.trim() ? parseUserAmount(fee) : 0,
          eurRate: foreign && rate.trim() ? parseUserNumber(rate) : undefined,
          note,
        },
        trade?.id ?? newId('tr'),
      );
      await onSave(next);
    } catch (err) {
      setError(errorText(err));
    }
  }

  return (
    <form className="space-y-3" onSubmit={submit}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Segmented
          value={side}
          onChange={setSide}
          options={[
            { value: 'buy', label: 'Compra' },
            { value: 'sell', label: 'Venda' },
          ]}
        />
        {side === 'sell' && !trade && held > 0 && (
          <button type="button" className="text-xs font-medium text-accent" onClick={() => setQuantity(numberToInput(held))}>
            Vendre-ho tot ({fmtQty(held)})
          </button>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="label">
          Data
          <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </label>
        <label className="label">
          Títols
          <input className="input text-right tabular-nums" inputMode="decimal" value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder="10" required />
        </label>
      </div>
      <div>
        <div className="mb-1 flex gap-3 text-xs">
          {(['price', 'total'] as const).map((m) => (
            <button key={m} type="button" className={cx('font-medium', mode === m ? 'text-ink' : 'text-ink-faint hover:text-ink-muted')} onClick={() => setMode(m)}>
              {m === 'price' ? 'Preu per títol' : 'Import total'}
            </button>
          ))}
        </div>
        {mode === 'price' ? (
          <input className="input text-right tabular-nums" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder={`0,00 ${holding.currency}`} aria-label="Preu per títol" required />
        ) : (
          <input className="input text-right tabular-nums" inputMode="decimal" value={total} onChange={(e) => setTotal(e.target.value)} placeholder={`0,00 ${holding.currency}`} aria-label="Import total" required />
        )}
        <p className="hint mt-1">
          {mode === 'price'
            ? preview !== undefined
              ? `Total ${formatCents(preview, holding.currency)}, sense comissió.`
              : 'Sense comissió.'
            : "Títols × preu, sense comissió (com surt a l'extracte del broker)."}
        </p>
      </div>
      <div className={cx('grid gap-2', foreign ? 'grid-cols-2' : 'grid-cols-1')}>
        <label className="label">
          Comissió ({holding.currency})
          <input className="input text-right tabular-nums" inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value)} placeholder="0,00" />
        </label>
        {foreign && (
          <label className="label">
            1 {holding.currency} = … €
            <input className="input text-right tabular-nums" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="0,92" />
          </label>
        )}
      </div>
      {foreign && <p className="hint -mt-1">El tipus de canvi d'aquell dia: serveix per calcular el guany en euros. Si el deixes buit, es fa servir l'actual.</p>}
      <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Nota (opcional)" />
      {error && (
        <Alert tone="neg" onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      <div className="flex gap-2">
        <Button size="sm" variant="primary" type="submit">
          {trade ? 'Desar canvis' : side === 'buy' ? 'Afegir compra' : 'Afegir venda'}
        </Button>
        <Button size="sm" onClick={onCancel}>
          Cancel·lar
        </Button>
      </div>
    </form>
  );
}

export function HoldingForm({ budget, holding, onDone, onCancel }: { budget: BudgetState; holding?: StockHolding; onDone: (id: string) => void; onCancel: () => void }) {
  const data = budget.data!;
  const brokers = data.accounts.filter((a) => a.type === 'investment' && (!a.archived || a.id === holding?.accountId));
  const [symbol, setSymbol] = useState(holding?.symbol ?? '');
  const [name, setName] = useState(holding?.name ?? '');
  const [currency, setCurrency] = useState(holding?.currency ?? 'EUR');
  const [accountId, setAccountId] = useState(holding?.accountId ?? (holding ? '' : brokers[0]?.id ?? ''));
  const [notes, setNotes] = useState(holding?.notes ?? '');
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      const saved = saveHolding({ symbol, name, currency, accountId, notes }, holding?.id ?? newId('hold'), data.holdings, holding);
      const ok = await budget.run((repo) => repo.upsertHoldings([saved]));
      if (ok) onDone(saved.id);
    } catch (err) {
      setError(errorText(err));
    }
  }

  return (
    <form className="space-y-5" onSubmit={submit}>
      {error && (
        <Alert tone="neg" onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      <div className="grid grid-cols-[1fr_7rem] gap-4">
        <label className="label">
          Ticker
          <input className="input uppercase" value={symbol} onChange={(e) => setSymbol(e.target.value)} placeholder="AAPL" required autoFocus={!holding} />
        </label>
        <label className="label">
          Moneda
          <input className="input uppercase" value={currency} onChange={(e) => setCurrency(e.target.value)} list="stock-currencies" maxLength={3} required />
          <datalist id="stock-currencies">
            {['EUR', 'USD', 'GBP', 'CHF'].map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </label>
      </div>
      <label className="label">
        Nom
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="p.ex. Apple" />
      </label>
      <label className="label">
        Compte del broker
        <select className="input" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
          <option value="">Cap</option>
          {brokers.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <span className="hint">Opcional. Serveix per desar el valor de les accions com a valoració del compte.</span>
      </label>
      <label className="label">
        Notes
        <textarea className="input h-auto min-h-20 py-2" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Opcional" />
      </label>
      <div className="flex gap-2">
        <Button variant="primary" type="submit">
          Desar
        </Button>
        <Button onClick={onCancel}>Cancel·lar</Button>
      </div>
    </form>
  );
}
