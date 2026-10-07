import { describe, expect, it } from 'vitest';
import { addRepayment, isSettled, knownPeople, pendingCents, removeRepayment, saveDebt, summarizeDebts } from '../src/domain/debts';

const debt = (id: string, person: string, amountCents: number, date = '2026-09-01') =>
  saveDebt({ person, amountCents, reason: 'Sopar', date }, id);

describe('deutes', () => {
  it('valida i normalitza en crear', () => {
    const d = debt('d1', '  Anna ', 5000);
    expect(d).toMatchObject({ person: 'Anna', date: '2026-09-01T00:00:00', repayments: [] });
    expect(() => debt('d2', ' ', 100)).toThrow();
    expect(() => debt('d3', 'Anna', 0)).toThrow();
  });

  it('els retorns parcials redueixen el pendent fins a saldar-lo', () => {
    let d = debt('d1', 'Anna', 5000);
    d = addRepayment(d, { date: '2026-09-10', amountCents: 2000 }, 'r1');
    expect(pendingCents(d)).toBe(3000);
    expect(isSettled(d)).toBe(false);
    expect(() => addRepayment(d, { date: '2026-09-11', amountCents: 3001 }, 'r2')).toThrow();
    d = addRepayment(d, { date: '2026-09-05', amountCents: 3000 }, 'r2');
    expect(isSettled(d)).toBe(true);
    expect(d.repayments.map((r) => r.id)).toEqual(['r2', 'r1']); // ordenats per data
    expect(isSettled(removeRepayment(d, 'r1'))).toBe(false);
  });

  it("en editar es mantenen els retorns i l'import no pot baixar del retornat", () => {
    const d = addRepayment(debt('d1', 'Anna', 5000), { date: '2026-09-10', amountCents: 2000 }, 'r1');
    const edited = saveDebt({ person: 'Anna', amountCents: 6000, reason: 'Sopar i taxi', date: '2026-09-01' }, 'd1', d);
    expect(edited.repayments).toHaveLength(1);
    expect(pendingCents(edited)).toBe(4000);
    expect(() => saveDebt({ person: 'Anna', amountCents: 1000, reason: '', date: '2026-09-01' }, 'd1', d)).toThrow();
  });

  it('resum per persona (sense distingir majúscules) i sense els saldats', () => {
    const paid = addRepayment(debt('d3', 'Pau', 1000), { date: '2026-09-02', amountCents: 1000 }, 'r');
    const s = summarizeDebts([debt('d1', 'Anna', 5000), debt('d2', 'anna', 1500), paid, debt('d4', 'Pau', 800)]);
    expect(s.pendingCents).toBe(7300);
    expect(s.lentCents).toBe(8300);
    expect(s.repaidCents).toBe(1000);
    expect(s.byPerson.map((p) => [p.person, p.pendingCents, p.debts.length])).toEqual([
      ['Anna', 6500, 2],
      ['Pau', 800, 1],
    ]);
    expect(knownPeople([debt('a', 'Anna', 1), debt('b', 'anna', 1), debt('c', 'Pau', 1)])).toEqual(['anna', 'Pau']);
  });
});
