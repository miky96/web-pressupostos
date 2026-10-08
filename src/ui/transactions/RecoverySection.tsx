import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { debtFromTransaction, debtLinksByTx, knownPeople, type DebtLink, linkRepaymentTx, pendingCents, releaseDebtTxs } from '../../domain/debts';
import { formatCents, parseUserAmount } from '../../domain/money';
import {
  descriptionTokens,
  isRecoverableExpense,
  isRecovery,
  linkRecovery,
  recoveriesByExpense,
  recoveryStatus,
  setExpectedBack,
  setRecoveryClosed,
  suggestLinks,
  unlinkRecovery,
  type LinkSuggestion,
} from '../../domain/recoveries';
import { editTransaction } from '../../domain/transactions';
import type { Debt, Transaction } from '../../domain/types';
import { Button } from '../kit/Button';
import { Alert, Switch } from '../kit/Feedback';
import { Icon } from '../kit/Icon';
import { formatDate } from '../labels';
import { newId, type BudgetState } from '../useBudget';

const centsToInput = (c: number) => (c ? (c / 100).toFixed(2).replace('.', ',') : '');
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

function TxLine({ tx, action, onOpen }: { tx: Transaction; action?: ReactNode; onOpen?: () => void }) {
  return (
    <li className="flex items-center gap-3 px-3 py-2 text-sm">
      <button className="min-w-0 flex-1 text-left" onClick={onOpen} disabled={!onOpen}>
        <div className="truncate font-medium">{tx.description}</div>
        <div className="text-xs text-ink-muted">{formatDate(tx.date.slice(0, 10))}</div>
      </button>
      <span className="amount font-medium">{formatCents(Math.abs(tx.amountCents), tx.currency)}</span>
      {action}
    </li>
  );
}

/**
 * Secció del detall d'un moviment per enllaçar devolucions, Bizums i deutes:
 *  - en una despesa: quant esperes recuperar, què ja t'han tornat, o convertir-la en préstec;
 *  - en una entrada: a quina despesa o deute correspon (amb suggeriments);
 *  - en un préstec: a quin deute està lligat.
 */
export function RecoverySection({ tx, budget, onOpenTx }: { tx: Transaction; budget: BudgetState; onOpenTx: (id: string) => void }) {
  const { data, run } = budget;
  const [error, setError] = useState<string | null>(null);
  const txs = useMemo(() => data?.transactions ?? [], [data]);
  const debts = useMemo(() => data?.debts ?? [], [data]);
  const debtLink = useMemo(() => debtLinksByTx(debts).get(tx.id), [debts, tx.id]);
  if (!data) return null;

  /** Calcula els canvis (pot llançar errors de validació) i els desa. */
  async function apply(build: () => { txs?: Transaction[]; debts?: Debt[] }) {
    try {
      setError(null);
      const changes = build();
      await run(async (repo) => {
        if (changes.txs?.length) await repo.upsertTransactions(changes.txs);
        if (changes.debts?.length) await repo.upsertDebts(changes.debts);
      });
    } catch (e) {
      setError(errorText(e));
    }
  }

  let body: ReactNode = null;
  if (tx.kind === 'loan') body = <LoanLink tx={tx} link={debtLink} txs={txs} apply={apply} />;
  else if (isRecoverableExpense(tx)) body = <ExpenseRecovery tx={tx} txs={txs} debts={debts} apply={apply} onOpenTx={onOpenTx} />;
  else if (isRecovery(tx)) body = <IncomingLink tx={tx} txs={txs} debts={debts} apply={apply} onOpenTx={onOpenTx} />;
  if (!body) return null;

  return (
    <section className="space-y-3 rounded-xl border border-line p-4">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <Icon name="link" className="size-4 text-ink-muted" />
        {tx.kind === 'loan' ? 'Deute' : isRecoverableExpense(tx) ? 'Recuperació' : "D'on ve aquest retorn?"}
      </h3>
      {error && (
        <Alert tone="neg" onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      {body}
    </section>
  );
}

type Apply = (build: () => { txs?: Transaction[]; debts?: Debt[] }) => Promise<void>;

function ExpenseRecovery({ tx, txs, debts, apply, onOpenTx }: { tx: Transaction; txs: Transaction[]; debts: Debt[]; apply: Apply; onOpenTx: (id: string) => void }) {
  const status = recoveryStatus(tx, recoveriesByExpense(txs).get(tx.id));
  const [loanForm, setLoanForm] = useState(false);
  const saveExpected = (cents: number) => cents !== (tx.expectedBackCents ?? 0) && apply(() => ({ txs: [setExpectedBack(tx, cents)] }));

  return (
    <div className="space-y-3">
      <label className="label">
        Espero recuperar (€)
        <div className="flex gap-2">
          <input
            key={`${tx.id}:${tx.expectedBackCents ?? 0}`}
            className="input"
            inputMode="decimal"
            placeholder="0,00"
            defaultValue={centsToInput(tx.expectedBackCents ?? 0)}
            onBlur={(e) => saveExpected(e.target.value.trim() ? parseUserAmount(e.target.value) : 0)}
          />
          <Button onClick={() => saveExpected(status.grossCents)} title="Esperes recuperar-ho tot (devolució, retorn del festival...)">
            Tot
          </Button>
        </div>
        <span className="hint">La part que pagues per altres o que et tornaran. A la vista de consum, ja no compta com a despesa teva.</span>
      </label>

      {(status.expectedCents > 0 || status.recoveredCents > 0) && (
        <dl className="grid grid-cols-3 gap-2 rounded-lg bg-subtle px-3 py-2 text-xs">
          <div>
            <dt className="text-ink-muted">Recuperat</dt>
            <dd className="amount text-sm font-semibold text-pos">{formatCents(status.recoveredCents)}</dd>
          </div>
          <div>
            <dt className="text-ink-muted">Pendent</dt>
            <dd className="amount text-sm font-semibold">{formatCents(status.pendingCents)}</dd>
          </div>
          <div>
            <dt className="text-ink-muted">Et costa</dt>
            <dd className="amount text-sm font-semibold">{formatCents(status.ownCents)}</dd>
          </div>
        </dl>
      )}

      {status.recoveries.length > 0 && (
        <ul className="divide-y divide-line rounded-lg border border-line">
          {status.recoveries.map((r) => (
            <TxLine
              key={r.id}
              tx={r}
              onOpen={() => onOpenTx(r.id)}
              action={<Button variant="ghost" size="sm" icon="x" aria-label="Desenllaçar" title="Desenllaçar" onClick={() => apply(() => ({ txs: [unlinkRecovery(r)] }))} />}
            />
          ))}
        </ul>
      )}

      {status.expectedCents > status.recoveredCents && (
        <label className="flex cursor-pointer items-center justify-between gap-3 text-sm">
          <span>
            <span className="font-medium">Ja no espero cobrar-ne més</span>
            <span className="hint block">El que falta passa a ser despesa teva.</span>
          </span>
          <Switch checked={!!tx.recoveryClosed} onChange={(v) => apply(() => ({ txs: [setRecoveryClosed(tx, v)] }))} label="Tancar" />
        </label>
      )}

      {status.recoveries.length === 0 && !status.expectedCents && (
        loanForm ? (
          <LoanForm tx={tx} debts={debts} apply={apply} onCancel={() => setLoanForm(false)} />
        ) : (
          <button className="text-xs font-medium text-accent" onClick={() => setLoanForm(true)}>
            Eren diners que has deixat a algú? Convertir en deute
          </button>
        )
      )}
    </div>
  );
}

function LoanForm({ tx, debts, apply, onCancel }: { tx: Transaction; debts: Debt[]; apply: Apply; onCancel: () => void }) {
  const guess = tx.description.match(/to: (.+)$/i)?.[1]?.replace(/\.$/, '') ?? '';
  const [person, setPerson] = useState(guess);
  const [reason, setReason] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void apply(() => {
      const r = debtFromTransaction(tx, { person, reason }, newId('debt'));
      return { txs: [r.tx], debts: [r.debt] };
    });
  };
  return (
    <form className="space-y-2" onSubmit={submit}>
      <div className="grid grid-cols-2 gap-2">
        <input className="input" value={person} onChange={(e) => setPerson(e.target.value)} placeholder="A qui" list="loan-people" required autoFocus />
        <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Motiu (opcional)" />
      </div>
      <datalist id="loan-people">
        {knownPeople(debts).map((p) => (
          <option key={p} value={p} />
        ))}
      </datalist>
      <p className="hint">Es crearà un deute de {formatCents(-tx.amountCents)} i aquest moviment deixarà de comptar com a despesa.</p>
      <div className="flex gap-2">
        <Button size="sm" variant="primary" type="submit">
          Crear deute
        </Button>
        <Button size="sm" onClick={onCancel}>
          Cancel·lar
        </Button>
      </div>
    </form>
  );
}

function IncomingLink({ tx, txs, debts, apply, onOpenTx }: { tx: Transaction; txs: Transaction[]; debts: Debt[]; apply: Apply; onOpenTx: (id: string) => void }) {
  const [query, setQuery] = useState('');
  const target = tx.recoversTxId ? txs.find((t) => t.id === tx.recoversTxId) : undefined;
  const suggestions = useMemo(() => suggestLinks(tx, txs, debts), [tx, txs, debts]);

  const search = useMemo(() => {
    const words = [...descriptionTokens(query)];
    if (!words.length) return [];
    const minDate = new Date(new Date(tx.date.slice(0, 10)).getTime() - 365 * 86400e3).toISOString().slice(0, 10);
    return txs
      .filter((t) => isRecoverableExpense(t) && !t.hidden && t.date >= minDate && t.date.slice(0, 10) <= tx.date.slice(0, 10))
      .filter((t) => {
        const tokens = descriptionTokens(`${t.description} ${t.notes ?? ''}`);
        return words.every((w) => [...tokens].some((x) => x.startsWith(w)));
      })
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 6);
  }, [query, tx.date, txs]);

  const linkTo = (expense: Transaction) => apply(() => ({ txs: [linkRecovery(tx, expense, txs)] }));
  const linkToDebt = (debt: Debt) =>
    apply(() => {
      const r = linkRepaymentTx(debt, tx, newId('rep'));
      return { txs: [r.tx], debts: [r.debt] };
    });

  if (target) {
    return (
      <div className="space-y-2">
        <p className="text-xs text-ink-muted">Recupera aquesta despesa. A la vista de consum compta el dia de la compra.</p>
        <ul className="rounded-lg border border-line">
          <TxLine
            tx={target}
            onOpen={() => onOpenTx(target.id)}
            action={<Button variant="ghost" size="sm" icon="x" aria-label="Desenllaçar" title="Desenllaçar" onClick={() => apply(() => ({ txs: [unlinkRecovery(tx)] }))} />}
          />
        </ul>
      </div>
    );
  }

  const openDebts = debts.filter((d) => pendingCents(d) >= tx.amountCents && !suggestions.some((s) => s.type === 'debt' && s.debt.id === d.id));

  return (
    <div className="space-y-3">
      <p className="text-xs text-ink-muted">
        Enllaça'l a la compra que recupera (comptarà el mes de la compra) o al deute que salda (no comptarà com a ingrés).
      </p>
      {suggestions.length > 0 && (
        <ul className="divide-y divide-line rounded-lg border border-line">
          {suggestions.map((s) => (
            <SuggestionRow key={s.type === 'expense' ? s.expense.id : s.debt.id} s={s} onLink={() => (s.type === 'expense' ? linkTo(s.expense) : linkToDebt(s.debt))} />
          ))}
        </ul>
      )}
      <div>
        <div className="relative">
          <Icon name="search" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-faint" />
          <input className="input pl-9" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Cerca una altra despesa…" />
        </div>
        {search.length > 0 && (
          <ul className="mt-2 divide-y divide-line rounded-lg border border-line">
            {search.map((e) => (
              <TxLine key={e.id} tx={e} action={<Button size="sm" onClick={() => linkTo(e)}>Enllaçar</Button>} />
            ))}
          </ul>
        )}
        {query && search.length === 0 && <p className="mt-2 text-xs text-ink-faint">Cap despesa de l'últim any coincideix.</p>}
      </div>
      {openDebts.length > 0 && (
        <label className="label">
          O és el retorn d'un deute
          <select className="input" value="" onChange={(e) => e.target.value && linkToDebt(openDebts.find((d) => d.id === e.target.value)!)}>
            <option value="">Tria un deute…</option>
            {openDebts.map((d) => (
              <option key={d.id} value={d.id}>
                {d.person} · {d.reason || 'Sense motiu'} · en queden {formatCents(pendingCents(d))}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}

function SuggestionRow({ s, onLink }: { s: LinkSuggestion; onLink: () => void }) {
  const title = s.type === 'expense' ? s.expense.description : `Deute de ${s.debt.person}${s.debt.reason ? ` · ${s.debt.reason}` : ''}`;
  const date = s.type === 'expense' ? s.expense.date : s.debt.date;
  // Per a una despesa compartida interessa el que queda per cobrar, no el total.
  const amount = s.type === 'expense' ? s.status.pendingCents || s.status.grossCents : s.pendingCents;
  return (
    <li className="flex items-center gap-3 px-3 py-2 text-sm">
      <span className="grid size-7 shrink-0 place-items-center rounded-full bg-accent-soft text-accent-ink max-sm:hidden">
        <Icon name={s.type === 'expense' ? 'sparkle' : 'users'} className="size-3.5" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{title}</div>
        <div className="truncate text-xs text-ink-muted">
          {formatDate(date.slice(0, 10))} · {s.reason}
        </div>
      </div>
      <span className="amount text-xs font-medium text-ink-muted">{formatCents(amount)}</span>
      <Button size="sm" variant="primary" onClick={onLink}>
        Enllaçar
      </Button>
    </li>
  );
}

function LoanLink({ tx, link, txs, apply }: { tx: Transaction; link?: DebtLink; txs: Transaction[]; apply: Apply }) {
  if (!link) {
    return <p className="text-sm text-ink-muted">Marcat com a préstec però no està lligat a cap deute. No compta ni com a ingrés ni com a despesa.</p>;
  }
  const { debt, role, repaymentId } = link;
  const undo = () =>
    apply(() => {
      if (role === 'repayment') {
        return {
          txs: releaseDebtTxs(debt, txs, new Set([repaymentId!])),
          debts: [{ ...debt, repayments: debt.repayments.filter((r) => r.id !== repaymentId) }],
        };
      }
      return { txs: [editTransaction(tx, { kind: 'expense' })], debts: [{ ...debt, txId: undefined }] };
    });
  return (
    <div className="space-y-2 text-sm">
      <p>
        {role === 'origin' ? 'Diners deixats a ' : 'Retorn del deute de '}
        <span className="font-medium">{debt.person}</span>
        {debt.reason && <span className="text-ink-muted"> · {debt.reason}</span>}
      </p>
      <p className="text-xs text-ink-muted">
        {pendingCents(debt) > 0 ? `En queden ${formatCents(pendingCents(debt))} per tornar.` : 'Deute saldat.'} No compta ni com a ingrés ni com a despesa.
      </p>
      <button className="text-xs font-medium text-accent" onClick={undo}>
        {role === 'origin' ? 'Desfer: tornar a ser despesa (el deute es manté)' : 'Desfer: treure aquest retorn del deute'}
      </button>
    </div>
  );
}
