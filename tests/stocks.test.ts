import { describe, expect, it } from 'vitest';
import { parseUserNumber } from '../src/domain/money';
import { holdingsValuation, portfolioSummary, realizedByYear, removeTrade, saveFxRate, saveHolding, saveTrade, setLastPrice, stockPosition } from '../src/domain/stocks';
import type { FxRate, StockHolding } from '../src/domain/types';

const usd: FxRate = { id: 'USD', eurPerUnit: 0.9, date: '2026-10-20T00:00:00' };

function apple(): StockHolding {
  let h = saveHolding({ symbol: ' aapl ', name: 'Apple', currency: 'usd', accountId: 'broker' }, 'h_aapl', []);
  h = saveTrade(h, { date: '2025-01-10', side: 'buy', quantity: 10, priceCents: 10000, feeCents: 100, eurRate: 0.95 }, 'b1');
  h = saveTrade(h, { date: '2025-06-10', side: 'buy', quantity: 5, priceCents: 12000, feeCents: 0, eurRate: 0.9 }, 'b2');
  return h;
}

describe('accions: posició i FIFO', () => {
  it('normalitza el ticker i la moneda i no deixa duplicar-los', () => {
    const h = apple();
    expect(h).toMatchObject({ symbol: 'AAPL', currency: 'USD' });
    expect(() => saveHolding({ symbol: 'AAPL', currency: 'USD' }, 'other', [h])).toThrow(/Ja tens AAPL/);
    expect(() => saveHolding({ symbol: 'X', currency: 'dollars' }, 'x', [])).toThrow(/3 lletres/);
  });

  it('calcula títols, cost amb comissions i preu mitjà', () => {
    const p = stockPosition(apple(), [usd]);
    expect(p.quantity).toBe(15);
    expect(p.costCents).toBe(100000 + 100 + 60000);
    expect(p.avgPriceCents).toBeCloseTo(160100 / 15);
    // Cost en euros amb el tipus de canvi de cada compra.
    expect(p.costEurCents).toBe(Math.round(100100 * 0.95) + 54000);
    expect(p.valueCents).toBeUndefined();
  });

  it('amb preu: valor i guany latent, en dòlars i en euros (efecte divisa inclòs)', () => {
    const h = setLastPrice(apple(), 15000, '2026-10-20');
    const p = stockPosition(h, [usd]);
    expect(p.valueCents).toBe(225000);
    expect(p.unrealizedCents).toBe(225000 - 160100);
    expect(p.valueEurCents).toBe(202500);
    expect(p.unrealizedEurCents).toBe(202500 - (95095 + 54000));
  });

  it('la venda consumeix primer els títols més antics (FIFO)', () => {
    const h = saveTrade(apple(), { date: '2026-02-01', side: 'sell', quantity: 12, grossCents: 168000, feeCents: 200, eurRate: 0.92 }, 's1');
    const p = stockPosition(h, [usd]);
    expect(p.quantity).toBe(3);
    // Queden 3 dels 5 del segon lot.
    expect(p.costCents).toBe(36000);
    const [sale] = p.realized;
    expect(sale.costCents).toBe(100100 + 24000);
    expect(sale.proceedsCents).toBe(167800);
    expect(sale.gainCents).toBe(167800 - 124100);
    expect(sale.gainEurCents).toBe(Math.round(167800 * 0.92) - (95095 + 21600));
    expect(realizedByYear([p]).map((y) => [y.year, y.gainEurCents])).toEqual([['2026', sale.gainEurCents]]);
  });

  it('no deixa vendre més del que tens, ni esborrar la compra que ho permetia', () => {
    expect(() => saveTrade(apple(), { date: '2026-01-01', side: 'sell', quantity: 16, grossCents: 1000 }, 's')).toThrow(/només en tens 15/);
    // Una venda el mateix dia que la compra és vàlida (la compra va primer).
    const h = saveTrade(apple(), { date: '2025-01-10', side: 'sell', quantity: 10, grossCents: 100000 }, 's');
    expect(() => removeTrade(h, 'b1')).toThrow(/No es pot esborrar/);
    expect(removeTrade(h, 's').trades).toHaveLength(2);
  });

  it('sense tipus de canvi, els euros no es poden calcular però la resta sí', () => {
    let h = saveHolding({ symbol: 'MSFT', currency: 'USD' }, 'h_msft', []);
    h = setLastPrice(saveTrade(h, { date: '2026-01-01', side: 'buy', quantity: 1, priceCents: 40000 }, 'b'), 41000, '2026-10-20');
    const p = stockPosition(h, []);
    expect(p.missingRate).toBe(true);
    expect(p.unrealizedCents).toBe(1000);
    expect(p.valueEurCents).toBeUndefined();
    const s = portfolioSummary([h], []);
    expect(s.missingRates).toEqual(['USD']);
    expect(s.valueEurCents).toBe(0);
  });
});

describe('cartera', () => {
  it('suma en euros, separa els valors venuts del tot i avisa dels que no tenen preu', () => {
    let eur = saveHolding({ symbol: 'VWCE', currency: 'EUR', accountId: 'broker' }, 'h_vwce', []);
    eur = setLastPrice(saveTrade(eur, { date: '2026-01-01', side: 'buy', quantity: 2, priceCents: 12000 }, 'b'), 13000, '2026-10-20');
    let sold = saveHolding({ symbol: 'OLD', currency: 'EUR' }, 'h_old', []);
    sold = saveTrade(saveTrade(sold, { date: '2025-01-01', side: 'buy', quantity: 1, priceCents: 1000 }, 'b'), { date: '2025-05-01', side: 'sell', quantity: 1, grossCents: 1500 }, 's');
    const noPrice = apple();
    const s = portfolioSummary([eur, sold, noPrice], [usd]);
    expect(s.open.map((p) => p.holding.symbol)).toEqual(['AAPL', 'VWCE']);
    expect(s.closed.map((p) => p.holding.symbol)).toEqual(['OLD']);
    expect(s.valueEurCents).toBe(26000);
    expect(s.unrealizedEurCents).toBe(2000);
    expect(s.realizedEurCents).toBe(500);
    expect(s.missingPrice.map((h) => h.symbol)).toEqual(['AAPL']);
  });

  it('desa el valor de les accions del broker com a valoració del compte', () => {
    let eur = saveHolding({ symbol: 'VWCE', currency: 'EUR', accountId: 'broker' }, 'h_vwce', []);
    eur = setLastPrice(saveTrade(eur, { date: '2026-01-01', side: 'buy', quantity: 2, priceCents: 12000 }, 'b'), 13000, '2026-10-20');
    expect(() => holdingsValuation('broker', [eur, apple()], [usd], '2026-10-20', 'v')).toThrow(/AAPL/);
    const aapl = setLastPrice(apple(), 15000, '2026-10-20');
    expect(holdingsValuation('broker', [eur, aapl], [usd], '2026-10-20', 'v')).toMatchObject({ accountId: 'broker', valueCents: 26000 + 202500 });
  });

  it('valida tipus de canvi i nombres decimals', () => {
    expect(saveFxRate('usd', 0.92, '2026-10-20')).toMatchObject({ id: 'USD', eurPerUnit: 0.92 });
    expect(() => saveFxRate('EUR', 1, '2026-10-20')).toThrow();
    expect(parseUserNumber('0,123456')).toBe(0.123456);
    expect(() => parseUserNumber('1,2,3')).toThrow();
  });
});
