import { useState, type FormEvent } from 'react';
import { ACCOUNT_TYPE_LABELS, createAccount } from '../domain/accounts';
import { accountBalance } from '../domain/balances';
import { normalizeDate, todayIso } from '../domain/dates';
import { effectiveTae, project } from '../domain/interest';
import { accountPerformance } from '../domain/investments';
import { formatCents, parseUserAmount } from '../domain/money';
import type { Account, AccountType, BalanceMode, Compounding, InterestTerms } from '../domain/types';
import { formatDate, formatPct } from './labels';
import { newId, type BudgetState } from './useBudget';

export function AccountsPage({ budget }: { budget: BudgetState }) {
  const { data } = budget;
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  if (!data) return null;
  const now = todayIso();

  const total = data.accounts
    .filter((a) => !a.archived)
    .reduce((s, a) => s + accountBalance(a, data.transactions, data.valuations, now).cents, 0);

  return (
    <section>
      <div className="row-between">
        <h2>Comptes</h2>
        <button className="primary" onClick={() => setCreating((c) => !c)}>
          + Compte manual
        </button>
      </div>
      <p className="muted">
        Els comptes que no surten als extractes (efectiu, broker, fons...) els pots crear aquí i actualitzar-ne el valor a mà.
      </p>
      {creating && <NewAccountForm budget={budget} onDone={() => setCreating(false)} />}

      <table>
        <thead>
          <tr>
            <th>Compte</th>
            <th>Tipus</th>
            <th className="num">Saldo / valor</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {data.accounts.map((a) => {
            const b = accountBalance(a, data.transactions, data.valuations, now);
            return (
              <tr key={a.id} className={a.archived ? 'hidden-row' : ''}>
                <td>
                  {a.name}
                  {a.interest && <span className="badge">{formatPct(effectiveTae(a.interest))} TAE</span>}
                </td>
                <td>{ACCOUNT_TYPE_LABELS[a.type]}</td>
                <td className="num">
                  {b.estimated && <span title="Estimat a partir de l'última valoració i les aportacions posteriors">≈ </span>}
                  {formatCents(b.cents, a.currency)}
                </td>
                <td>
                  <button className="link" onClick={() => setOpen(open === a.id ? null : a.id)}>
                    {open === a.id ? 'Tancar' : 'Detalls'}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <th colSpan={2}>Patrimoni total</th>
            <th className="num">{formatCents(total)}</th>
            <th></th>
          </tr>
        </tfoot>
      </table>

      {open && data.accounts.some((a) => a.id === open) && (
        <AccountDetail key={open} budget={budget} account={data.accounts.find((a) => a.id === open)!} />
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
    <form className="card form-grid" onSubmit={submit}>
      <label className="wide">
        Nom
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Efectiu, Broker, Compte remunerat..." required />
      </label>
      <label>
        Tipus
        <select value={type} onChange={(e) => setType(e.target.value as AccountType)}>
          {(Object.keys(ACCOUNT_TYPE_LABELS) as AccountType[]).map((t) => (
            <option key={t} value={t}>
              {ACCOUNT_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
      </label>
      <label>
        {type === 'investment' || type === 'savings' ? 'Valor actual (€)' : 'Saldo inicial (€)'}
        <input inputMode="decimal" value={initial} onChange={(e) => setInitial(e.target.value)} placeholder="0" />
      </label>
      <label>
        Data
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </label>
      {type === 'savings' && (
        <label>
          TAE (%)
          <input inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="2,5" />
        </label>
      )}
      <div className="wide">
        <button className="primary" type="submit">
          Crear
        </button>{' '}
        <button type="button" onClick={onDone}>
          Cancel·lar
        </button>
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

  let projection: ReturnType<typeof project> = [];
  try {
    const months = Math.min(600, Math.max(1, Math.round(Number(years) * 12)));
    projection = interest
      ? project({ initialCents: perf.valueCents, monthlyContributionCents: parseUserAmount(monthly || '0'), tae: effectiveTae(interest), months }).filter(
          (p) => p.month % 12 === 0 && p.month > 0,
        )
      : [];
  } catch {
    projection = [];
  }

  return (
    <div className="card">
      <h3>{account.name}</h3>
      <div className="form-grid">
        <label className="wide">
          Nom
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          Interès (%)
          <input inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="sense interès" />
        </label>
        <label>
          Tipus d'interès
          <select value={rateType} onChange={(e) => setRateType(e.target.value as InterestTerms['rateType'])}>
            <option value="TAE">TAE</option>
            <option value="TIN">TIN</option>
          </select>
        </label>
        {rateType === 'TIN' && (
          <label>
            Liquidació
            <select value={compounding} onChange={(e) => setCompounding(e.target.value as Compounding)}>
              <option value="daily">Diària</option>
              <option value="monthly">Mensual</option>
              <option value="quarterly">Trimestral</option>
              <option value="annual">Anual</option>
            </select>
          </label>
        )}
        <div className="wide">
          {interest && rateType === 'TIN' && <span className="muted">Equival a {formatPct(effectiveTae(interest))} TAE. </span>}
          <button onClick={saveAccount}>Desar</button>{' '}
          <button onClick={() => run((repo) => repo.upsertAccounts([{ ...account, archived: !account.archived }]))}>
            {account.archived ? 'Desarxivar' : 'Arxivar'}
          </button>
        </div>
      </div>

      <ul className="stats">
        <li>
          Valor {perf.estimated ? 'estimat' : 'actual'} <strong>{formatCents(perf.valueCents, account.currency)}</strong>
        </li>
        <li>
          Aportat <strong>{formatCents(perf.contributedCents, account.currency)}</strong>
        </li>
        <li>
          Guany{' '}
          <strong className={perf.gainCents < 0 ? 'neg' : 'pos'}>
            {formatCents(perf.gainCents, account.currency)} ({formatPct(perf.gainRatio)})
          </strong>
        </li>
      </ul>

      {account.balanceMode === 'valuations' && (
        <>
          <h4>Valoracions</h4>
          <p className="muted">
            Apunta el valor que et mostra l'app del banc o broker. Entre valoracions, el valor s'estima amb les aportacions
            {account.interest ? ' i la TAE' : ''}.
          </p>
          <form className="inline-form" onSubmit={addValuation}>
            <input type="date" value={valDate} onChange={(e) => setValDate(e.target.value)} required />
            <input inputMode="decimal" placeholder="Valor (€)" value={valAmount} onChange={(e) => setValAmount(e.target.value)} required />
            <button type="submit">Afegir valoració</button>
          </form>
          <table>
            <tbody>
              {vals.map((v) => (
                <tr key={v.id}>
                  <td>{formatDate(v.date)}</td>
                  <td className="num">{formatCents(v.valueCents, account.currency)}</td>
                  <td>{v.note}</td>
                  <td>
                    <button className="link" onClick={() => run((repo) => repo.deleteValuations([v.id]))}>
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {interest && (
        <>
          <h4>Previsió</h4>
          <div className="inline-form">
            <label>
              Anys <input inputMode="numeric" value={years} onChange={(e) => setYears(e.target.value)} size={3} />
            </label>
            <label>
              Aportació mensual (€) <input inputMode="decimal" value={monthly} onChange={(e) => setMonthly(e.target.value)} size={6} />
            </label>
          </div>
          <table>
            <thead>
              <tr>
                <th>Any</th>
                <th className="num">Aportat</th>
                <th className="num">Interessos</th>
                <th className="num">Total</th>
              </tr>
            </thead>
            <tbody>
              {projection.map((p) => (
                <tr key={p.month}>
                  <td>{p.month / 12}</td>
                  <td className="num">{formatCents(p.contributedCents)}</td>
                  <td className="num">{formatCents(p.interestCents)}</td>
                  <td className="num">
                    <strong>{formatCents(p.balanceCents)}</strong>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
