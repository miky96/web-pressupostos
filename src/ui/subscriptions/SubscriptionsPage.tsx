import { useMemo, useState, type FormEvent } from 'react';
import { addDays, todayIso } from '../../domain/dates';
import { formatCents, parseUserAmount } from '../../domain/money';
import {
  isActive,
  isPlaceholder,
  monthlyEquivalent,
  nextOccurrence,
  PERIOD_LABELS,
  planSubscriptionRun,
  saveSubscription,
  signedAmount,
  SUBSCRIPTION_PERIODS,
  suggestSubscriptions,
  unlinkSubscription,
  type SubscriptionPeriod,
  type SubscriptionSuggestion,
} from '../../domain/subscriptions';
import type { Subscription } from '../../domain/types';
import { CategoryAvatar } from '../CategoryAvatar';
import { centsToInput, errorText } from '../goals/shared';
import { Button } from '../kit/Button';
import { Card, CardHeader, PageHeader, Stat } from '../kit/Card';
import { cx } from '../kit/cx';
import { Drawer } from '../kit/Drawer';
import { Alert, Badge, EmptyState, Segmented } from '../kit/Feedback';
import { Icon } from '../kit/Icon';
import { formatDate, formatLongDate } from '../labels';
import { newId, type BudgetState } from '../useBudget';
import { applySubscriptionRun } from './useSubscriptionAutoRun';

type Open = { mode: 'new'; from?: SubscriptionSuggestion } | { mode: 'edit'; sub: Subscription } | null;

const perLabel = (s: Subscription) => PERIOD_LABELS[s.everyMonths as SubscriptionPeriod]?.per ?? `${s.everyMonths} mesos`;

export function SubscriptionsPage({ budget }: { budget: BudgetState }) {
  const data = budget.data;
  const [open, setOpen] = useState<Open>(null);
  const [showEnded, setShowEnded] = useState(false);
  const today = todayIso();

  const suggestions = useMemo(() => (data ? suggestSubscriptions(data.transactions, data.subscriptions, today) : []), [data, today]);
  if (!data) return null;

  const active = data.subscriptions.filter((s) => isActive(s, today));
  const ended = data.subscriptions.filter((s) => !isActive(s, today));
  const expenses = active.filter((s) => s.kind === 'expense');
  const monthly = expenses.reduce((sum, s) => sum + monthlyEquivalent(s), 0);
  const in30 = addDays(today, 30).slice(0, 10);
  const upcoming = active
    .map((s) => ({ s, next: nextOccurrence(s, today) }))
    .filter((x): x is { s: Subscription; next: string } => !!x.next)
    .sort((a, b) => a.next.localeCompare(b.next));
  const next30 = upcoming.filter((x) => x.next <= in30 && x.s.kind === 'expense').reduce((sum, x) => sum + x.s.amountCents, 0);
  const nextOf = new Map(upcoming.map((x) => [x.s.id, x.next]));

  const newButton = (
    <Button variant="primary" icon="plus" onClick={() => setOpen({ mode: 'new' })}>
      Nova subscripció
    </Button>
  );

  return (
    <section className="max-w-5xl">
      <PageHeader
        title="Subscripcions"
        subtitle="Cobraments que es repeteixen (gimnàs, plataformes, assegurances...). L'app n'apunta el moviment quan toca i, si el compte s'importa, el substitueix pel real del banc."
        actions={data.subscriptions.length > 0 ? newButton : undefined}
      />

      {suggestions.length > 0 && (
        <Card className="mb-6">
          <CardHeader title="Possibles subscripcions" subtitle="Despeses importades que es repeteixen cada mes amb un import semblant." />
          <ul className="divide-y divide-line">
            {suggestions.slice(0, 5).map((s) => (
              <li key={`${s.accountId}|${s.bankDescription}`} className="flex items-center gap-3 px-5 py-3">
                <CategoryAvatar category={s.categoryId ? budget.lookups.categories.get(s.categoryId) : undefined} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{s.name}</div>
                  <div className="text-xs text-ink-muted">
                    {s.months} mesos seguits · últim el {formatDate(s.lastDate)}
                  </div>
                </div>
                <span className="amount text-sm font-semibold">{formatCents(s.amountCents)}/mes</span>
                <Button size="sm" icon="plus" onClick={() => setOpen({ mode: 'new', from: s })}>
                  Afegir
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {data.subscriptions.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line-strong bg-surface">
          <EmptyState icon="repeat" title="Encara no tens cap subscripció" action={newButton}>
            Afegeix el gimnàs, Netflix o la quota que sigui un sol cop i oblida't d'apuntar-la cada mes.
          </EmptyState>
        </div>
      ) : (
        <>
          <Card className="mb-6 p-5 sm:p-6">
            <div className="grid grid-cols-2 gap-5 sm:grid-cols-3">
              <Stat label="Cost mensual" value={formatCents(monthly)} hint={`${expenses.length} ${expenses.length === 1 ? 'subscripció activa' : 'subscripcions actives'}`} className="col-span-2 sm:col-span-1" />
              <Stat label="Cost anual" value={formatCents(monthly * 12)} size="md" />
              <Stat label="Pròxims 30 dies" value={formatCents(next30)} size="md" hint={upcoming[0] ? `Proper: ${upcoming[0].s.name}, ${formatDate(upcoming[0].next)}` : undefined} />
            </div>
          </Card>

          {active.length > 0 && (
            <Card>
              <ul className="divide-y divide-line">
                {[...active]
                  .sort((a, b) => (nextOf.get(a.id) ?? '9').localeCompare(nextOf.get(b.id) ?? '9'))
                  .map((s) => (
                    <SubscriptionRow key={s.id} sub={s} budget={budget} next={nextOf.get(s.id)} onClick={() => setOpen({ mode: 'edit', sub: s })} />
                  ))}
              </ul>
            </Card>
          )}

          {ended.length > 0 && (
            <div className="mt-6">
              <button className="flex items-center gap-1.5 px-1 text-sm font-medium text-ink-muted hover:text-ink" onClick={() => setShowEnded((v) => !v)}>
                <Icon name={showEnded ? 'chevronDown' : 'chevronRight'} />
                Donades de baixa ({ended.length})
              </button>
              {showEnded && (
                <Card className="mt-3 opacity-80">
                  <ul className="divide-y divide-line">
                    {ended.map((s) => (
                      <SubscriptionRow key={s.id} sub={s} budget={budget} onClick={() => setOpen({ mode: 'edit', sub: s })} />
                    ))}
                  </ul>
                </Card>
              )}
            </div>
          )}
        </>
      )}

      {open && (
        <Drawer
          open
          onClose={() => setOpen(null)}
          title={open.mode === 'edit' ? open.sub.name : 'Nova subscripció'}
          subtitle={open.mode === 'edit' ? `${formatCents(open.sub.amountCents)} / ${perLabel(open.sub)}` : 'Es crearà el moviment cada cop que toqui'}
        >
          <SubscriptionForm key={open.mode === 'edit' ? open.sub.id : 'new'} budget={budget} open={open} onDone={() => setOpen(null)} />
        </Drawer>
      )}
    </section>
  );
}

function SubscriptionRow({ sub, budget, next, onClick }: { sub: Subscription; budget: BudgetState; next?: string; onClick: () => void }) {
  const account = budget.lookups.accounts.get(sub.accountId);
  const category = sub.categoryId ? budget.lookups.categories.get(sub.categoryId) : undefined;
  return (
    <li>
      <button className="group flex w-full items-center gap-4 px-4 py-3.5 text-left hover:bg-subtle/60" onClick={onClick}>
        <CategoryAvatar category={category} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium">{sub.name}</span>
            {sub.kind === 'income' && <Badge tone="pos">ingrés</Badge>}
          </div>
          <div className="mt-0.5 truncate text-xs text-ink-muted">
            {[account?.name ?? 'Compte eliminat', next ? `proper el ${formatDate(next)}` : sub.endDate ? `de baixa des del ${formatDate(sub.endDate)}` : undefined]
              .filter(Boolean)
              .join(' · ')}
          </div>
        </div>
        <div className="text-right">
          <div className={cx('amount text-sm font-semibold', sub.kind === 'income' && 'text-pos')}>{formatCents(sub.amountCents)}</div>
          <div className="text-xs text-ink-faint">/ {perLabel(sub)}</div>
        </div>
        <Icon name="chevronRight" className="size-4 text-ink-faint opacity-0 transition group-hover:opacity-100" />
      </button>
    </li>
  );
}

function SubscriptionForm({ budget, open, onDone }: { budget: BudgetState; open: NonNullable<Open>; onDone: () => void }) {
  const data = budget.data!;
  const sub = open.mode === 'edit' ? open.sub : undefined;
  const from = open.mode === 'new' ? open.from : undefined;
  const today = todayIso();
  const accounts = data.accounts.filter((a) => (!a.archived || a.id === sub?.accountId) && a.type !== 'investment');

  const [name, setName] = useState(sub?.name ?? from?.name ?? '');
  const [amount, setAmount] = useState(sub ? centsToInput(sub.amountCents) : from ? centsToInput(from.amountCents) : '');
  const [kind, setKind] = useState<Subscription['kind']>(sub?.kind ?? from?.kind ?? 'expense');
  const [everyMonths, setEveryMonths] = useState<number>(sub?.everyMonths ?? 1);
  const [startDate, setStartDate] = useState((sub?.startDate ?? from?.firstDate ?? today).slice(0, 10));
  const [accountId, setAccountId] = useState(sub?.accountId ?? from?.accountId ?? accounts[0]?.id ?? '');
  const [categoryId, setCategoryId] = useState(sub?.categoryId ?? from?.categoryId ?? '');
  const [endDate, setEndDate] = useState(sub?.endDate?.slice(0, 10) ?? '');
  const [notes, setNotes] = useState(sub?.notes ?? '');
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const categories = data.categories.filter((c) => c.kind === kind).sort((a, b) => a.name.localeCompare(b.name, 'ca'));
  const account = data.accounts.find((a) => a.id === accountId);

  function build(): Subscription {
    let amountCents: number;
    try {
      amountCents = parseUserAmount(amount);
    } catch {
      throw new Error('Import no vàlid');
    }
    const saved = saveSubscription(
      { name, amountCents, kind, everyMonths, startDate, accountId, categoryId: categories.some((c) => c.id === categoryId) ? categoryId : undefined, endDate: endDate || undefined, notes },
      sub?.id ?? newId('sub'),
      sub,
    );
    return from && !saved.bankDescription ? { ...saved, bankDescription: from.bankDescription } : saved;
  }

  // Què passarà en desar (només per informar).
  const preview = useMemo(() => {
    try {
      const run = planSubscriptionRun([build()], data.transactions, today);
      return { created: run.created.length, linked: run.linked };
    } catch {
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, amount, kind, everyMonths, startDate, accountId, endDate, data.transactions]);

  const history = useMemo(
    () => (sub ? data.transactions.filter((t) => t.subscriptionId === sub.id).sort((a, b) => b.date.localeCompare(a.date)) : []),
    [sub, data.transactions],
  );

  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      const saved = build();
      const currency = data.accounts.find((a) => a.id === saved.accountId)?.currency ?? 'EUR';
      const run = planSubscriptionRun([saved], data.transactions, today, () => currency);
      await budget.run(async (repo) => {
        await repo.upsertSubscriptions([saved]);
        await applySubscriptionRun(repo, run);
      });
      onDone();
    } catch (err) {
      setError(errorText(err));
    }
  }

  async function cancelSubscription() {
    if (!sub) return;
    await budget.run((repo) => repo.upsertSubscriptions([{ ...sub, endDate: `${today.slice(0, 10)}T00:00:00` }]));
    onDone();
  }

  async function remove() {
    if (!sub) return;
    await budget.run(async (repo) => {
      await repo.upsertTransactions(unlinkSubscription(sub.id, data.transactions));
      await repo.deleteSubscriptions([sub.id]);
    });
    onDone();
  }

  if (accounts.length === 0) return <Alert tone="info">Primer crea un compte (a Comptes) on es facin els cobraments.</Alert>;

  return (
    <form className="space-y-5" onSubmit={submit}>
      {error && (
        <Alert tone="neg" onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      <Segmented
        value={kind}
        options={[
          { value: 'expense', label: 'Despesa' },
          { value: 'income', label: 'Ingrés' },
        ]}
        onChange={setKind}
      />
      <label className="label">
        Nom
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Gimnàs" required autoFocus={!sub} />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="label">
          Import (€)
          <input className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0,00" required />
        </label>
        <label className="label">
          Periodicitat
          <select className="input" value={everyMonths} onChange={(e) => setEveryMonths(Number(e.target.value))}>
            {SUBSCRIPTION_PERIODS.map((p) => (
              <option key={p} value={p}>
                {PERIOD_LABELS[p].every}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="label">
        {sub ? 'Primer cobrament' : 'Primer cobrament (o el proper)'}
        <input className="input" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required />
        <span className="hint">Els següents cauen el mateix dia del mes (si no existeix, l'últim dia).</span>
      </label>
      <label className="label">
        Compte
        <select className="input" value={accountId} onChange={(e) => setAccountId(e.target.value)} required>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <span className="hint">
          {account?.importKey
            ? "Aquest compte s'importa: l'app apunta un cobrament provisional i, quan importis l'extracte, el substitueix pel real."
            : "L'app apuntarà el cobrament automàticament cada cop que toqui."}
        </span>
      </label>
      <label className="label">
        Categoria
        <select className="input" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
          <option value="">Sense categoria</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      {sub && (
        <label className="label">
          Data de baixa
          <input className="input" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          <span className="hint">Opcional. No es crearan cobraments després d'aquesta data.</span>
        </label>
      )}
      <label className="label">
        Notes
        <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>

      {preview && (preview.created > 0 || preview.linked > 0) && (
        <Alert tone="info">
          En desar{' '}
          {[
            preview.created > 0 && (preview.created === 1 ? "s'apuntarà 1 cobrament fins avui" : `s'apuntaran ${preview.created} cobraments fins avui`),
            preview.linked > 0 && (preview.linked === 1 ? 'es vincularà 1 moviment que ja tens' : `es vincularan ${preview.linked} moviments que ja tens`),
          ]
            .filter(Boolean)
            .join(' i ')}
          .
        </Alert>
      )}

      <div className="flex flex-wrap gap-2">
        <Button variant="primary" type="submit">
          Desar
        </Button>
        {sub && (
          <>
            <div className="flex-1" />
            {isActive(sub, today) && (
              <Button onClick={cancelSubscription} icon="x">
                Donar de baixa
              </Button>
            )}
            {confirmDelete ? (
              <Button variant="danger" icon="trash" onClick={remove}>
                Segur?
              </Button>
            ) : (
              <Button variant="danger" icon="trash" onClick={() => setConfirmDelete(true)} aria-label="Eliminar" title="Eliminar (els moviments es queden)" />
            )}
          </>
        )}
      </div>

      {history.length > 0 && (
        <div>
          <h4 className="mb-2 text-sm font-semibold">Cobraments</h4>
          <ul className="divide-y divide-line rounded-lg border border-line">
            {history.slice(0, 24).map((t) => (
              <li key={t.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                <span className="flex-1 text-ink-muted">{formatLongDate(t.date)}</span>
                {isPlaceholder(t) && budget.lookups.accounts.get(t.accountId)?.importKey && (
                  <Badge tone="warn" title="Encara no ha arribat amb cap importació">
                    provisional
                  </Badge>
                )}
                <span className={cx('amount font-medium', t.amountCents > 0 && 'text-pos')}>{formatCents(t.amountCents, t.currency)}</span>
              </li>
            ))}
          </ul>
          {sub && signedAmount(sub) !== history[0].amountCents && !isPlaceholder(history[0]) && (
            <p className="hint mt-2">L'últim cobrament real ({formatCents(Math.abs(history[0].amountCents))}) no coincideix amb l'import: potser ha canviat el preu.</p>
          )}
        </div>
      )}
    </form>
  );
}
