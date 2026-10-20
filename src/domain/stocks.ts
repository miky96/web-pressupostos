/**
 * Inversions en accions, ETF i fons: cada valor guarda les seves operacions (compres i vendes) i
 * l'últim preu apuntat a mà. La posició (títols, cost, guany) es calcula.
 *
 * El cost i els guanys realitzats segueixen FIFO (els primers títols comprats són els primers que
 * es venen), que és el criteri d'Hisenda per a valors homogenis. Les comissions de compra sumen al
 * cost i les de venda resten de l'import obtingut. Els euros es calculen amb el tipus de canvi de
 * cada operació (o l'actual si no el tens), així que el guany en EUR inclou l'efecte divisa.
 */
import { normalizeDate } from './dates';
import type { Cents } from './money';
import type { FxRate, StockHolding, StockTrade, Valuation } from './types';

/** Marge per errors d'arrodoniment en quantitats fraccionàries. */
const EPS = 1e-9;
const round = (x: number) => Math.round(x) + 0;
const sum = (values: number[]) => values.reduce((s, v) => s + v, 0);

/** Euros per unitat de moneda (EUR = 1). undefined si no tens el tipus de canvi. */
export function eurRateFor(currency: string, rates: FxRate[]): number | undefined {
  if (currency === 'EUR') return 1;
  return rates.find((r) => r.id === currency)?.eurPerUnit;
}

export interface Lot {
  tradeId: string;
  date: string;
  quantity: number;
  /** Cost dels títols que queden d'aquest lot (moneda del valor, amb comissió). */
  costCents: Cents;
  costEurCents: Cents;
}

export interface RealizedSale {
  tradeId: string;
  date: string;
  quantity: number;
  /** Import net obtingut (sense comissió de venda). */
  proceedsCents: Cents;
  costCents: Cents;
  gainCents: Cents;
  proceedsEurCents: Cents;
  costEurCents: Cents;
  gainEurCents: Cents;
}

const byDate = (a: StockTrade, b: StockTrade) => a.date.localeCompare(b.date) || Number(a.side === 'sell') - Number(b.side === 'sell') || a.id.localeCompare(b.id);

/** Reprodueix les operacions en ordre (FIFO). Llança si en algun moment vens més títols dels que tens. */
export function replayTrades(trades: StockTrade[], currentRate: number | undefined): { lots: Lot[]; realized: RealizedSale[] } {
  const lots: Lot[] = [];
  const realized: RealizedSale[] = [];
  const rateOf = (t: StockTrade) => t.eurRate ?? currentRate ?? NaN;
  for (const t of [...trades].sort(byDate)) {
    if (t.side === 'buy') {
      const cost = t.grossCents + t.feeCents;
      lots.push({ tradeId: t.id, date: t.date, quantity: t.quantity, costCents: cost, costEurCents: round(cost * rateOf(t)) });
      continue;
    }
    const held = sum(lots.map((l) => l.quantity));
    if (t.quantity > held + EPS) throw new Error(`El ${t.date.slice(0, 10)} vens ${fmtQty(t.quantity)} títols però només en tens ${fmtQty(held)}`);
    let left = t.quantity;
    let cost = 0;
    let costEur = 0;
    while (left > EPS && lots.length) {
      const lot = lots[0];
      const take = Math.min(lot.quantity, left);
      const part = take / lot.quantity;
      const c = take >= lot.quantity - EPS ? lot.costCents : round(lot.costCents * part);
      const ce = take >= lot.quantity - EPS ? lot.costEurCents : round(lot.costEurCents * part);
      cost += c;
      costEur += ce;
      lot.quantity -= take;
      lot.costCents -= c;
      lot.costEurCents -= ce;
      left -= take;
      if (lot.quantity <= EPS) lots.shift();
    }
    const proceeds = t.grossCents - t.feeCents;
    const proceedsEur = round(proceeds * rateOf(t));
    realized.push({
      tradeId: t.id,
      date: t.date,
      quantity: t.quantity,
      proceedsCents: proceeds,
      costCents: cost,
      gainCents: proceeds - cost,
      proceedsEurCents: proceedsEur,
      costEurCents: costEur,
      gainEurCents: proceedsEur - costEur,
    });
  }
  return { lots, realized };
}

export interface StockPosition {
  holding: StockHolding;
  quantity: number;
  /** Cost dels títols que tens (moneda del valor). */
  costCents: Cents;
  costEurCents: Cents;
  /** Preu mitjà per títol dels que tens (cèntims, amb decimals). */
  avgPriceCents: number;
  priceCents?: number;
  priceDate?: string;
  valueCents?: Cents;
  valueEurCents?: Cents;
  /** Guany latent en la moneda del valor (sense efecte divisa). */
  unrealizedCents?: Cents;
  /** Guany latent en euros (inclou l'efecte divisa). */
  unrealizedEurCents?: Cents;
  unrealizedRatio?: number;
  realized: RealizedSale[];
  realizedEurCents: Cents;
  feesCents: Cents;
  /** Tipus de canvi actual (undefined si falta i la moneda no és EUR). */
  eurRate?: number;
  /** Algun càlcul en euros no és possible perquè falta el tipus de canvi. */
  missingRate: boolean;
}

export function stockPosition(holding: StockHolding, rates: FxRate[]): StockPosition {
  const eurRate = eurRateFor(holding.currency, rates);
  const { lots, realized } = replayTrades(holding.trades, eurRate);
  const quantity = Math.max(0, sum(lots.map((l) => l.quantity)));
  const costCents = sum(lots.map((l) => l.costCents));
  const costEurCents = sum(lots.map((l) => l.costEurCents));
  const missingRate = eurRate === undefined && holding.trades.some((t) => t.eurRate === undefined);
  const price = holding.lastPrice;
  const valueCents = price ? round(quantity * price.cents) : undefined;
  const valueEurCents = valueCents !== undefined && eurRate !== undefined ? round(valueCents * eurRate) : undefined;
  const ok = (x: number | undefined) => (x === undefined || Number.isNaN(x) ? undefined : x);
  return {
    holding,
    quantity: quantity < EPS ? 0 : quantity,
    costCents,
    costEurCents: ok(costEurCents) ?? 0,
    avgPriceCents: quantity > EPS ? costCents / quantity : 0,
    priceCents: price?.cents,
    priceDate: price?.date,
    valueCents,
    valueEurCents,
    unrealizedCents: valueCents !== undefined ? valueCents - costCents : undefined,
    unrealizedEurCents: valueEurCents !== undefined ? ok(valueEurCents - costEurCents) : undefined,
    unrealizedRatio: valueCents !== undefined && costCents > 0 ? (valueCents - costCents) / costCents : undefined,
    realized,
    realizedEurCents: ok(sum(realized.map((r) => r.gainEurCents))) ?? 0,
    feesCents: sum(holding.trades.map((t) => t.feeCents)),
    eurRate,
    missingRate,
  };
}

export interface PortfolioSummary {
  /** Valors amb títols, de més a menys valor. */
  open: StockPosition[];
  /** Valors venuts del tot (només hi queda el guany realitzat). */
  closed: StockPosition[];
  valueEurCents: Cents;
  costEurCents: Cents;
  unrealizedEurCents: Cents;
  realizedEurCents: Cents;
  /** Valors amb títols però sense preu apuntat (no compten al valor). */
  missingPrice: StockHolding[];
  /** Monedes sense tipus de canvi. */
  missingRates: string[];
}

export function portfolioSummary(holdings: StockHolding[], rates: FxRate[]): PortfolioSummary {
  const positions = holdings.map((h) => stockPosition(h, rates));
  const open = positions.filter((p) => p.quantity > 0).sort((a, b) => (b.valueEurCents ?? b.costEurCents) - (a.valueEurCents ?? a.costEurCents));
  const priced = open.filter((p) => p.valueEurCents !== undefined);
  return {
    open,
    closed: positions.filter((p) => p.quantity === 0 && p.holding.trades.length > 0),
    valueEurCents: sum(priced.map((p) => p.valueEurCents!)),
    costEurCents: sum(open.map((p) => p.costEurCents)),
    unrealizedEurCents: sum(priced.map((p) => p.unrealizedEurCents ?? 0)),
    realizedEurCents: sum(positions.map((p) => p.realizedEurCents)),
    missingPrice: open.filter((p) => p.priceCents === undefined).map((p) => p.holding),
    missingRates: [...new Set(positions.filter((p) => p.eurRate === undefined).map((p) => p.holding.currency))].sort(),
  };
}

export interface YearRealized {
  year: string;
  gainEurCents: Cents;
  proceedsEurCents: Cents;
  costEurCents: Cents;
  sales: (RealizedSale & { holding: StockHolding })[];
}

/** Guanys i pèrdues realitzats per any (en EUR, FIFO): el que va a la declaració de la renda. */
export function realizedByYear(positions: StockPosition[]): YearRealized[] {
  const years = new Map<string, YearRealized>();
  for (const p of positions) {
    for (const s of p.realized) {
      const year = s.date.slice(0, 4);
      const y = years.get(year) ?? { year, gainEurCents: 0, proceedsEurCents: 0, costEurCents: 0, sales: [] };
      y.gainEurCents += s.gainEurCents;
      y.proceedsEurCents += s.proceedsEurCents;
      y.costEurCents += s.costEurCents;
      y.sales.push({ ...s, holding: p.holding });
      years.set(year, y);
    }
  }
  for (const y of years.values()) y.sales.sort((a, b) => a.date.localeCompare(b.date));
  return [...years.values()].sort((a, b) => b.year.localeCompare(a.year));
}

// --- Edició --------------------------------------------------------------------------------

export interface HoldingInput {
  symbol: string;
  name?: string;
  currency: string;
  accountId?: string;
  notes?: string;
}

export function saveHolding(input: HoldingInput, id: string, existing: StockHolding[], current?: StockHolding): StockHolding {
  const symbol = input.symbol.trim().toUpperCase();
  if (!symbol) throw new Error('Cal el ticker (p.ex. AAPL)');
  const currency = input.currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error('La moneda ha de ser un codi de 3 lletres (EUR, USD...)');
  if (current && current.currency !== currency && current.trades.length) throw new Error("No pots canviar la moneda d'un valor que ja té operacions");
  if (existing.some((h) => h.id !== id && h.symbol === symbol && !h.archived)) throw new Error(`Ja tens ${symbol}`);
  return {
    id,
    symbol,
    name: input.name?.trim() || undefined,
    currency,
    accountId: input.accountId || undefined,
    trades: current?.trades ?? [],
    lastPrice: current?.lastPrice,
    notes: input.notes?.trim() || undefined,
    archived: current?.archived,
  };
}

export interface TradeInput {
  date: string;
  side: StockTrade['side'];
  quantity: number;
  /** Preu per títol (cèntims, pot tenir decimals). S'ignora si hi ha `grossCents`. */
  priceCents?: number;
  /** Import total sense comissió (si el saps exacte, p.ex. de l'extracte del broker). */
  grossCents?: Cents;
  feeCents?: Cents;
  eurRate?: number;
  note?: string;
}

/** Crea o substitueix (mateix id) una operació. Comprova que mai vens més títols dels que tens. */
export function saveTrade(holding: StockHolding, input: TradeInput, id: string): StockHolding {
  if (!(input.quantity > 0)) throw new Error('El nombre de títols ha de ser més gran que 0');
  const gross = input.grossCents ?? (input.priceCents !== undefined ? round(input.quantity * input.priceCents) : NaN);
  if (!Number.isFinite(gross) || gross < 0) throw new Error('Cal el preu per títol o l\'import total');
  const fee = input.feeCents ?? 0;
  if (fee < 0) throw new Error('La comissió no pot ser negativa');
  if (input.side === 'sell' && fee > gross) throw new Error('La comissió no pot superar l\'import de la venda');
  const eurRate = holding.currency === 'EUR' ? undefined : input.eurRate;
  if (eurRate !== undefined && !(eurRate > 0)) throw new Error('El tipus de canvi ha de ser més gran que 0');
  const trade: StockTrade = {
    id,
    date: normalizeDate(input.date),
    side: input.side,
    quantity: input.quantity,
    grossCents: gross,
    feeCents: fee,
    eurRate,
    note: input.note?.trim() || undefined,
  };
  const trades = [...holding.trades.filter((t) => t.id !== id), trade].sort(byDate);
  replayTrades(trades, 1);
  return { ...holding, trades };
}

export function removeTrade(holding: StockHolding, tradeId: string): StockHolding {
  const trades = holding.trades.filter((t) => t.id !== tradeId);
  try {
    replayTrades(trades, 1);
  } catch {
    throw new Error("No es pot esborrar: sense aquesta compra, hi hauria vendes de títols que no tenies");
  }
  return { ...holding, trades };
}

export function setLastPrice(holding: StockHolding, priceCents: number, date: string): StockHolding {
  if (!(priceCents > 0)) throw new Error('El preu ha de ser més gran que 0');
  return { ...holding, lastPrice: { cents: priceCents, date: normalizeDate(date) } };
}

export function saveFxRate(currency: string, eurPerUnit: number, date: string): FxRate {
  const id = currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(id) || id === 'EUR') throw new Error('Moneda no vàlida');
  if (!(eurPerUnit > 0)) throw new Error('El tipus de canvi ha de ser més gran que 0');
  return { id, eurPerUnit, date: normalizeDate(date) };
}

/**
 * Valoració d'un compte de broker amb el valor actual dels seus valors (en EUR). Permet que el
 * patrimoni i les gràfiques ho recullin sense lligar-les a les accions.
 */
export function holdingsValuation(accountId: string, holdings: StockHolding[], rates: FxRate[], date: string, id: string): Valuation {
  const positions = holdings.filter((h) => h.accountId === accountId).map((h) => stockPosition(h, rates)).filter((p) => p.quantity > 0);
  const missing = positions.filter((p) => p.valueEurCents === undefined).map((p) => p.holding.symbol);
  if (missing.length) throw new Error(`Falta el preu o el tipus de canvi de: ${missing.join(', ')}`);
  return { id, accountId, date: normalizeDate(date), valueCents: sum(positions.map((p) => p.valueEurCents!)), note: 'Valor de les accions' };
}

export function fmtQty(q: number): string {
  return new Intl.NumberFormat('ca-ES', { maximumFractionDigits: 6 }).format(q);
}
