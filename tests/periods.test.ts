import { describe, expect, it } from 'vitest';
import { groupByDay, latestMonth, periodRange, relativeChange, shiftMonth, shiftPeriod } from '../src/domain/periods';
import type { Transaction } from '../src/domain/types';

const tx = (id: string, date: string, hidden = false) => ({ id, date, hidden }) as Transaction;

describe('periods', () => {
  it('desplaça mesos travessant anys', () => {
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-05', -17)).toBe('2024-12');
  });

  it('calcula rangs que inclouen tot el període', () => {
    const r = periodRange({ kind: 'month', month: '2026-02' });
    expect('2026-02-28T23:00:00' >= r.from! && '2026-02-28T23:00:00' <= r.to!).toBe(true);
    expect('2026-03-01T00:00:00' <= r.to!).toBe(false);
    expect(periodRange({ kind: 'all' })).toEqual({});
    expect(periodRange({ kind: 'range', from: '2026-01-05' })).toEqual({ from: '2026-01-05T00:00:00', to: undefined });
  });

  it('només els mesos i anys tenen anterior/següent', () => {
    expect(shiftPeriod({ kind: 'year', year: '2026' }, -1)).toEqual({ kind: 'year', year: '2025' });
    expect(shiftPeriod({ kind: 'all' }, -1)).toBeNull();
  });

  it('el mes per defecte és el del moviment més recent visible', () => {
    expect(latestMonth([tx('a', '2026-08-03T10:00:00'), tx('b', '2026-09-30T10:00:00', true)], '2026-10-07T00:00:00')).toBe('2026-08');
    expect(latestMonth([], '2026-10-07T00:00:00')).toBe('2026-10');
  });

  it('agrupa per dia', () => {
    const g = groupByDay([tx('a', '2026-10-07T10:00:00'), tx('b', '2026-10-07T09:00:00'), tx('c', '2026-10-05T09:00:00')]);
    expect(g.map((x) => [x.day, x.items.length])).toEqual([
      ['2026-10-07', 2],
      ['2026-10-05', 1],
    ]);
  });

  it('variació relativa', () => {
    expect(relativeChange(110, 100)).toBeCloseTo(0.1);
    expect(relativeChange(5, 0)).toBeNull();
  });
});
