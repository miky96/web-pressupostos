import { useState, type FormEvent } from 'react';
import { ACCOUNT_TYPE_LABELS, createAccount } from '../domain/accounts';
import { accountBalance } from '../domain/balances';
import { normalizeDate, todayIso } from '../domain/dates';
import { effectiveTae, project } from '../domain/interest';
import { accountPerformance } from '../domain/investments';
import { formatCents, parseUserAmount } from '../domain/money';
import type { Account, AccountType, BalanceMode, Compounding, InterestTerms } from '../domain/types';
import { CategoryDot } from './CategoryAvatar';
import { Button } from './kit/Button';
import { Card, PageHeader, Stat } from './kit/Card';
import { Drawer } from './kit/Drawer';
import { Badge, EmptyState } from './kit/Feedback';
import { Icon, type IconName } from './kit/Icon';
import { ACCOUNT_GROUPS, formatDate, formatPct } from './labels';
import { newId, type BudgetState } from './useBudget';

const TYPE_ICON: Record<AccountType, IconName> = { bank: 'wallet', savings: 'percent', investment: 'trend', cash: 'banknote' };

export function AccountsPage({ budget }: { budget: BudgetState }) {
  const { data } = budget;
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  if (!data) return null;
  const now = todayIso();

  const balances = new Map(data.accounts.map((a) => [a.id, accountBalance(a, data.transactions, data.valuations, now)]));
  const active = data.accounts.filter((a) => !a.archived);
  const archived = data.accounts.filter((a) => a.archived);
  const total = active.reduce((s, a) => s + balances.get(a.id)!.cents, 0);
  const groups = ACCOUNT_GROUPS.map((g) => {
    const accounts = active.filter((a) => g.types.includes(a.type));
    return { ...g, accounts, cents: accounts.reduce((s, a) => s + balances.get(a.id)!.cents, 0) };
  }).filter((g) => g.accounts.length > 0);
  const openAccount = open ? data.accounts.find((a) => a.id === open) : undefined;

  const card = (a: Account) => {
    const b = balances.get(a.id)!;
    return (
      <button
        key={a.id}
        onClick={() => setOpen(a.id)}
        className="group flex flex-col rounded-xl border border-line bg-surface p-4 text-left shadow-card transition hover:border-line-strong"
      >
        <div className="flex items-start gap-3">
          <div className="grid size-9 place-items-center rounded-lg bg-subtle text-ink-muted">
            <Icon name={TYPE_ICON[a.type]} className="size-[18px]" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium">{a.name}</div>
            <div className="truncate text-xs text-ink-muted">{ACCOUNT_TYPE_LABELS[a.type]}</div>
          </div>
          <Icon name="chevronRight" className="size-4 text-ink-faint opacity-0 transition group-hover:opacity-100" />
        </div>
        <div className="amount mt-4 text-xl font-semibold tracking-tight">
          {b.estimated && (
            <span className="mr-1 text-ink-faint" title="Estimat a partir de l'última valoració i les aportacions posteriors">
              ≈
            </span>
          )}
          {formatCents(b.cents, a.currency)}
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {a.interest && <Badge tone="pos">{formatPct(effectiveTae(a.interest))} TAE</Badge>}
          {a.balanceMode === 'valuations' && <Badge>valoració manual</Badge>}
          {a.closedAt && <Badge tone="warn">tancat pel banc</Badge>}
        </div>
      </button>
    );
  };

  return (
    <section>
      <PageHeader
        title="Comptes"
        subtitle="Els comptes que no surten als extractes (efectiu, broker, fons...) els pots crear aquí i actualitzar-ne el valor a mà."
        actions={
          <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>
            Compte manual
          </Button>
        }
      />

      {active.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line-strong bg-surface">
          <EmptyState icon="wallet" title="Encara no tens comptes">
            Es creen sols en importar un extracte, o en pots afegir un de manual.
          </EmptyState>
        </div>
      ) : (
        <Card className="mb-8 p-5 sm:p-6">
          <div className="text-[13px] font-medium text-ink-muted">Patrimoni total</div>
          <div className="amount mt-1 text-4xl font-semibold tracking-tight">{formatCents(total)}</div>
          {total > 0 && (
            <div className="mt-5 flex h-2.5 overflow-hidden rounded-full bg-subtle">
              {groups.map((g) => (
                <div key={g.label} style={{ width: `${(Math.max(g.cents, 0) / total) * 100}%`, backgroundColor: g.color }} />
              ))}
            </div>
          )}
          <div className="mt-4 flex flex-wrap gap-x-8 gap-y-2">
            {groups.map((g) => (
              <div key={g.label} className="flex items-center gap-2 text-sm">
                <CategoryDot color={g.color} />
                <span className="text-ink-muted">{g.label}</span>
                <span className="amount font-medium">{formatCents(g.cents)}</span>
                {total > 0 && <span className="text-xs text-ink-faint">{Math.round((g.cents / total) * 100)}%</span>}
              </div>
            ))}
          </div>
        </Card>
      )}

      {groups.map((g) => (
        <div key={g.label} className="mb-8">
          <h2 className="mb-3 text-[13px] font-semibold text-ink-muted">{g.label}</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{g.accounts.map(card)}</div>
        </div>
      ))}

      {archived.length > 0 && (
        <div>
          <button className="mb-3 inline-flex items-center gap-1 text-[13px] font-semibold text-ink-muted hover:text-ink" onClick={() => setShowArchived((s) => !s)}>
            <Icon name={showArchived ? 'chevronDown' : 'chevronRight'} className="size-4" />
            Arxivats ({archived.length})
          </button>
          {showArchived && <div className="grid gap-3 opacity-70 sm:grid-cols-2 lg:grid-cols-3">{archived.map(card)}</div>}
        </div>
      )}

      <Drawer open={creating} onClose={() => setCreating(false)} title="Nou compte manual">
        <NewAccountForm budget={budget} onDone={() => setCreating(false)} />
      </Drawer>
      {openAccount && (
        <Drawer open onClose={() => setOpen(null)} title={openAccount.name} subtitle={ACCOUNT_TYPE_LABELS[openAccount.type]}>
          <AccountDetail key={openAccount.id} budget={budget} account={openAccount} />
        </Drawer>
      )}
    </section>
  );
}

function NewAccountForm({ budget, onDone }: { budget: BudgetState; onDone: () => void }) {
  const [name, setName] = useState('');
  const [type, setType] = useState<AccountType>('cash');
  const [initial, setInitial] = useState('');
  const [date, setDate] = useState(todayIso().slice(0, 10));
  const [rate, setRate] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      const balanceMode: BalanceMode = type === 'investment' || type === 'savings' ? 'valuations' : 'transactions';
      const interest: InterestTerms | undefined = rate ? { rate: Number(rate.replace(',', '.')) / 100, rateType: 'TAE', compounding: 'daily' } : undefined;
      const initialCents = initial ? parseUserAmount(initial) : 0;
      const account = createAccount(
        {
          name,
          type,
          balanceMode,
          interest,
          initialBalanceCents: balanceMode === 'transactions' ? initialCents : undefined,
          initialDate: normalizeDate(date),
        },
        newId('acc'),
      );
      await budget.run(async (repo) => {
        await repo.upsertAccounts([account]);
        if (balanceMode === 'valuations' && initial) {
          await repo.upsertValuations([{ id: newId('val'), accountId: account.id, date: normalizeDate(date), valueCents: initialCents, note: 'Valor inicial' }]);
        }
      });
      onDone();
    } catch (err) {
      budget.setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <form className="space-y-5" onSubmit={submit}>
      <label className="label">
        Nom
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Efectiu, Broker, Compte remunerat..." required autoFocus />
      </label>
      <label className="label">
        Tipus
        <select className="input" value={type} onChange={(e) => setType(e.target.value as AccountType)}>
          {(Object.keys(ACCOUNT_TYPE_LABELS) as AccountType[]).map((t) => (
            <option key={t} value={t}>
              {ACCOUNT_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
      </label>
      <div className="grid grid-cols-2 gap-4">
        <label className="label">
          {type === 'investment' || type === 'savings' ? 'Valor actual (€)' : 'Saldo inicial (€)'}
          <input className="input" inputMode="decimal" value={initial} onChange={(e) => setInitial(e.target.value)} placeholder="0" />
        </label>
        <label className="label">
          Data
          <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
      </div>
      {type === 'savings' && (
        <label className="label">
          TAE (%)
          <input className="input" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="2,5" />
        </label>
      )}
      <div className="flex gap-2 pt-2">
        <Button variant="primary" type="submit" className="flex-1">
          Crear compte
        </Button>
        <Button onClick={onDone}>Cancel·lar</Button>
      </div>
    </form>
  );
}

function AccountDetail({ budget, account }: { budget: BudgetState; account: Account }) {
  const { data, run } = budget;
  const [name, setName] = useState(account.name);
  const [rate, setRate] = useState(account.interest ? String(+(account.interest.rate * 100).toFixed(4)).replace('.', ',') : '');
  const [rateType, setRateType] = useState<InterestTerms['rateType']>(account.interest?.rateType ?? 'TAE');
  const [compounding, setCompounding] = useState<Compounding>(account.interest?.compounding ?? 'daily');
  const [valDate, setValDate] = useState(todayIso().slice(0, 10));
  const [valAmount, setValAmount] = useState('');
  const [years, setYears] = useState('5');
  const [monthly, setMonthly] = useState('0');
  if (!data) return null;

  const now = todayIso();
  const perf = accountPerformance(account, data.transactions, data.valuations, now);
  const vals = data.valuations.filter((v) => v.accountId === account.id).sort((a, b) => b.date.localeCompare(a.date));
  const interest: InterestTerms | undefined = rate ? { rate: Number(rate.replace(',', '.')) / 100, rateType, compounding } : undefined;

  const saveAccount = () => run((repo) => repo.upsertAccounts([{ ...account, name: name.trim() || account.name, interest }]));

  const addValuation = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const valueCents = parseUserAmount(valAmount);
      await run((repo) => repo.upsertValuations([{ id: newId('val'), accountId: account.id, date: normalizeDate(valDate), valueCents }]));
      setValAmount('');
    } catch (err) {
      budget.setError(err instanceof Error ? err.message : String(err));
    }
  };

  // Previsió any a any; si els camps del formulari encara no són vàlids, no se'n mostra cap.
  const projection = ((): ReturnType<typeof project> => {
    if (!interest) return [];
    try {
      const months = Math.min(600, Math.max(1, Math.round(Number(years) * 12)));
      return project({ initialCents: perf.valueCents, monthlyContributionCents: parseUserAmount(monthly || '0'), tae: effectiveTae(interest), months }).filter(
        (p) => p.month % 12 === 0 && p.month > 0,
      );
    } catch {
      return [];
    }
  })();

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-3 gap-4 rounded-xl bg-subtle p-4">
        <Stat label={`Valor ${perf.estimated ? 'estimat' : 'actual'}`} value={formatCents(perf.valueCents, account.currency)} size="md" />
        <Stat label="Aportat" value={formatCents(perf.contributedCents, account.currency)} size="md" />
        <Stat
          label="Guany"
          value={formatCents(perf.gainCents, account.currency)}
          tone={perf.gainCents < 0 ? 'neg' : 'pos'}
          hint={formatPct(perf.gainRatio)}
          size="md"
        />
      </div>

      <section className="space-y-4">
        <h3 className="text-sm font-semibold">Dades del compte</h3>
        <label className="label">
          Nom
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <div className="grid grid-cols-2 gap-4">
          <label className="label">
            Interès (%)
            <input className="input" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="sense interès" />
          </label>
          <label className="label">
            Tipus d'interès
            <select className="input" value={rateType} onChange={(e) => setRateType(e.target.value as InterestTerms['rateType'])}>
              <option value="TAE">TAE</option>
              <option value="TIN">TIN</option>
            </select>
          </label>
          {rateType === 'TIN' && (
            <label className="label">
              Liquidació
              <select className="input" value={compounding} onChange={(e) => setCompounding(e.target.value as Compounding)}>
                <option value="daily">Diària</option>
                <option value="monthly">Mensual</option>
                <option value="quarterly">Trimestral</option>
                <option value="annual">Anual</option>
              </select>
            </label>
          )}
        </div>
        {interest && rateType === 'TIN' && <p className="hint">Equival a {formatPct(effectiveTae(interest))} TAE.</p>}
        <div className="flex gap-2">
          <Button variant="primary" onClick={saveAccount}>
            Desar
          </Button>
          <Button onClick={() => run((repo) => repo.upsertAccounts([{ ...account, archived: !account.archived }]))}>
            {account.archived ? 'Desarxivar' : 'Arxivar'}
          </Button>
        </div>
      </section>

      {account.balanceMode === 'valuations' && (
        <section className="space-y-3">
          <div>
            <h3 className="text-sm font-semibold">Valoracions</h3>
            <p className="hint mt-1">
              Apunta el valor que et mostra l'app del banc o broker. Entre valoracions, el valor s'estima amb les aportacions
              {account.interest ? ' i la TAE' : ''}.
            </p>
          </div>
          <form className="flex gap-2" onSubmit={addValuation}>
            <input className="input w-auto" type="date" value={valDate} onChange={(e) => setValDate(e.target.value)} required />
            <input className="input" inputMode="decimal" placeholder="Valor (€)" value={valAmount} onChange={(e) => setValAmount(e.target.value)} required />
            <Button type="submit" icon="plus" aria-label="Afegir valoració" title="Afegir valoració" />
          </form>
          {vals.length > 0 && (
            <ul className="divide-y divide-line rounded-lg border border-line">
              {vals.map((v) => (
                <li key={v.id} className="group flex items-center gap-3 px-3 py-2 text-sm">
                  <span className="text-ink-muted">{formatDate(v.date)}</span>
                  <span className="flex-1 truncate text-xs text-ink-faint">{v.note}</span>
                  <span className="amount font-medium">{formatCents(v.valueCents, account.currency)}</span>
                  <button className="text-ink-faint opacity-0 group-hover:opacity-100 hover:text-neg" onClick={() => run((repo) => repo.deleteValuations([v.id]))} aria-label="Eliminar">
                    <Icon name="trash" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {interest && (
        <section className="space-y-3">
          <h3 className="text-sm font-semibold">Previsió</h3>
          <div className="grid grid-cols-2 gap-4">
            <label className="label">
              Anys
              <input className="input" inputMode="numeric" value={years} onChange={(e) => setYears(e.target.value)} />
            </label>
            <label className="label">
              Aportació mensual (€)
              <input className="input" inputMode="decimal" value={monthly} onChange={(e) => setMonthly(e.target.value)} />
            </label>
          </div>
          {projection.length > 0 && (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-ink-muted">
                  <th className="py-2 font-medium">Any</th>
                  <th className="py-2 text-right font-medium">Aportat</th>
                  <th className="py-2 text-right font-medium">Interessos</th>
                  <th className="py-2 text-right font-medium">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line border-t border-line">
                {projection.map((p) => (
                  <tr key={p.month}>
                    <td className="py-2 text-ink-muted">{p.month / 12}</td>
                    <td className="amount py-2 text-right">{formatCents(p.contributedCents)}</td>
                    <td className="amount py-2 text-right text-pos">{formatCents(p.interestCents)}</td>
                    <td className="amount py-2 text-right font-semibold">{formatCents(p.balanceCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}
    </div>
  );
}
