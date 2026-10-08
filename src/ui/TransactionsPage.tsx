import { useMemo, useState } from 'react';
import { reclassify } from '../application/importService';
import type { Rule } from '../domain/classification';
import { todayIso } from '../domain/dates';
import { summarizeDebts } from '../domain/debts';
import { latestMonth, periodRange, shiftPeriod, type Period } from '../domain/periods';
import { attributeForView, cleanupLinks, pendingRecoveries, recoveriesAttributedElsewhere, recoveriesByExpense, recoveryStatus } from '../domain/recoveries';
import { filterTransactions, netExpenseByCategory, summarize, UNCATEGORIZED, type TransactionFilter } from '../domain/summary';
import { bulkEditTransactions, editTransaction, type BulkPatch } from '../domain/transactions';
import { TRANSACTION_KINDS, type Transaction, type TransactionKind } from '../domain/types';
import { BulkEditBar } from './BulkEditBar';
import { Button } from './kit/Button';
import { PageHeader } from './kit/Card';
import { cx } from './kit/cx';
import { Drawer } from './kit/Drawer';
import { Alert, EmptyState, Segmented, Switch } from './kit/Feedback';
import { Icon } from './kit/Icon';
import { KIND_LABELS, previousLabel } from './labels';
import { TransactionForm } from './TransactionForm';
import { PeriodPicker } from './transactions/PeriodPicker';
import { SummaryPanel } from './transactions/SummaryPanel';
import { TransactionDrawer } from './transactions/TransactionDrawer';
import { TransactionList } from './transactions/TransactionList';
import { newId, type BudgetState } from './useBudget';
import { useReportingView, VIEW_HINT, VIEW_OPTIONS } from './useReportingView';

const PAGE = 150;

/** Filtres de la vista; les dates les posa el període. */
type ViewFilter = Omit<TransactionFilter, 'from' | 'to'>;

/** Entrades de diners on la categoria sol venir de la despesa que recuperen. */
const isIncoming = (t: Transaction) => t.amountCents > 0 && (t.kind === 'refund' || t.kind === 'reimbursement');

const byDateDesc = (a: Transaction, b: Transaction) => b.date.localeCompare(a.date);

export function TransactionsPage({ budget, onNavigate }: { budget: BudgetState; onNavigate?: (tab: 'importar' | 'comptes' | 'deutes') => void }) {
  const { data, run, lookups } = budget;
  const [chosenPeriod, setPeriod] = useState<Period | null>(null);
  const [filter, setFilter] = useState<ViewFilter>({});
  const [showFilters, setShowFilters] = useState(false);
  const [limit, setLimit] = useState(PAGE);
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  // "Aplicar als moviments iguals": activat per defecte en despeses, però no en entrades de diners
  // (devolucions, Bizums rebuts...), on la descripció és genèrica ("Money added via BIZUM") i una
  // regla canviaria la categoria de tots els Bizums. Cada cas recorda la seva tria.
  const [learnExpense, setLearnExpense] = useState(true);
  const [learnIncoming, setLearnIncoming] = useState(false);
  const learnFor = (tx: Transaction) => (isIncoming(tx) ? learnIncoming : learnExpense);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [reportingView, setReportingView] = useReportingView();

  const defaultMonth = useMemo(() => latestMonth(data?.transactions ?? [], todayIso()), [data]);
  const period = useMemo<Period>(() => chosenPeriod ?? { kind: 'month', month: defaultMonth }, [chosenPeriod, defaultMonth]);

  const view = useMemo(() => {
    const txs = data?.transactions ?? [];
    // Els llistats mostren els moviments reals; els totals, la vista triada (consum o caixa).
    const effective = attributeForView(txs, reportingView);
    const inPeriod = (p: Period, f: ViewFilter, from = txs) => filterTransactions(from, { ...f, ...periodRange(p) });
    const rows = inPeriod(period, filter).sort(byDateDesc);
    // "Per revisar" és un filtre de la llista: els totals sempre mostren tot el període.
    const totalsFilter = { ...filter, onlyNeedsReview: undefined };
    // El desglossament per categories ignora el filtre de categoria (perquè es vegi el context).
    const withoutCategory = inPeriod(period, { ...filter, categoryIds: undefined, onlyNeedsReview: undefined });
    const prev = shiftPeriod(period, -1);
    const index = recoveriesByExpense(txs);
    const recoveryInfo = new Map(
      txs.filter((t) => t.expectedBackCents || index.has(t.id)).map((t) => [t.id, recoveryStatus(t, index.get(t.id))]),
    );
    return {
      rows,
      totals: summarize(inPeriod(period, totalsFilter, effective)),
      previous: prev ? summarize(inPeriod(prev, totalsFilter, effective)) : undefined,
      previousLabel: prev ? previousLabel(prev) : '',
      byCategory: netExpenseByCategory(inPeriod(period, { ...filter, categoryIds: undefined, onlyNeedsReview: undefined }, effective)),
      reviewCount: withoutCategory.filter((t) => t.needsReview && !t.hidden).length,
      elsewhereCents: reportingView === 'consumption' ? recoveriesAttributedElsewhere(txs, periodRange(period)) : 0,
      pending: pendingRecoveries(txs),
      recoveryInfo,
    };
  }, [data, period, filter, reportingView]);

  if (!data) return null;
  const { rows } = view;

  const set = (patch: Partial<ViewFilter>) => {
    setFilter((f) => ({ ...f, ...patch }));
    setLimit(PAGE);
    setSelected(new Set()); // no deixar seleccionats moviments que ja no es veuen
  };
  const changePeriod = (p: Period) => {
    setPeriod(p);
    setLimit(PAGE);
    setSelected(new Set());
  };

  const visible = rows.slice(0, limit);
  const openTx = openId ? data.transactions.find((t) => t.id === openId) : undefined;
  const openIndex = openTx ? visible.findIndex((t) => t.id === openTx.id) : -1;

  /**
   * Executa un canvi sobre el moviment obert. En mode "per revisar" el moviment desapareix de la
   * llista en revisar-lo, així que passem directament al següent.
   */
  async function onOpenTx(action: () => Promise<void>) {
    const nextId = visible[openIndex + 1]?.id ?? visible[openIndex - 1]?.id ?? null;
    await action();
    if (filter.onlyNeedsReview) setOpenId(nextId);
  }

  const save = (tx: Transaction, patch: Partial<Transaction>) => run((repo) => repo.upsertTransactions([editTransaction(tx, patch)]));

  /** Canviar la categoria pot crear una regla perquè els moviments iguals (i els futurs) també canviïn. */
  async function changeCategory(tx: Transaction, categoryId: string | undefined) {
    await run(async (repo) => {
      await repo.upsertTransactions([editTransaction(tx, { categoryId })]);
      if (!learnFor(tx) || !categoryId || tx.source !== 'import') return;
      const rule: Rule = {
        id: newId('rule'),
        name: `"${tx.description}" → ${lookups.categories.get(categoryId)?.name ?? categoryId}`,
        priority: 90,
        when: { descriptionContains: tx.description },
        then: { categoryId },
      };
      await repo.upsertRules([rule]);
      const keyById = Object.fromEntries(data!.accounts.map((a) => [a.id, a.importKey ?? '']));
      const others = data!.transactions.filter((t) => t.id !== tx.id);
      const updated = reclassify(others, [rule, ...data!.rules], keyById).filter(
        (t, i) => t.categoryId !== others[i].categoryId || t.kind !== others[i].kind || t.hidden !== others[i].hidden,
      );
      await repo.upsertTransactions(updated);
    });
  }

  async function remove(tx: Transaction) {
    const group = tx.transferGroupId ? data!.transactions.filter((t) => t.transferGroupId === tx.transferGroupId) : [tx];
    const msg = group.length > 1 ? `Eliminar aquest moviment i la seva parella (${group.length})?` : 'Eliminar aquest moviment?';
    if (!window.confirm(msg)) return;
    setOpenId(null);
    const ids = group.map((t) => t.id);
    // Les devolucions i els deutes que hi apuntaven es mantenen, però sense l'enllaç.
    const links = cleanupLinks(new Set(ids), data!.transactions, data!.debts);
    await run(async (repo) => {
      await repo.deleteTransactions(ids);
      if (links.txs.length) await repo.upsertTransactions(links.txs);
      if (links.debts.length) await repo.upsertDebts(links.debts);
    });
  }

  const allVisibleSelected = visible.length > 0 && visible.every((t) => selected.has(t.id));
  function toggleIds(ids: string[]) {
    setSelected((s) => {
      const next = new Set(s);
      const allIn = ids.every((id) => next.has(id));
      for (const id of ids) {
        if (allIn) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  }

  async function applyBulk(patch: BulkPatch) {
    const txs = data!.transactions.filter((t) => selected.has(t.id));
    await run((repo) => repo.upsertTransactions(bulkEditTransactions(txs, patch)));
    setSelected(new Set());
  }

  // Filtre de categoria: "" vol dir sense categoria (així ho entén filterTransactions).
  const activeCategory = filter.categoryIds?.[0] === '' ? UNCATEGORIZED : filter.categoryIds?.[0];
  const pickCategory = (id: string | undefined) => set({ categoryIds: id === undefined ? undefined : [id === UNCATEGORIZED ? '' : id] });

  const chips: { key: string; label: string; clear: () => void }[] = [];
  if (filter.accountIds?.length) chips.push({ key: 'acc', label: lookups.accounts.get(filter.accountIds[0])?.name ?? '?', clear: () => set({ accountIds: undefined }) });
  if (filter.kinds?.length) chips.push({ key: 'kind', label: KIND_LABELS[filter.kinds[0]], clear: () => set({ kinds: undefined }) });
  if (activeCategory)
    chips.push({
      key: 'cat',
      label: activeCategory === UNCATEGORIZED ? 'Sense categoria' : (lookups.categories.get(activeCategory)?.name ?? '?'),
      clear: () => set({ categoryIds: undefined }),
    });
  if (filter.onlyNeedsReview) chips.push({ key: 'rev', label: 'Per revisar', clear: () => set({ onlyNeedsReview: undefined }) });
  if (filter.includeHidden) chips.push({ key: 'hid', label: 'Amb amagats', clear: () => set({ includeHidden: undefined }) });
  const advancedCount = chips.filter((c) => c.key !== 'cat' && c.key !== 'rev').length;

  if (data.transactions.length === 0) {
    return (
      <section>
        <PageHeader title="Moviments" />
        <div className="rounded-xl border border-dashed border-line-strong bg-surface">
          <EmptyState
            icon="upload"
            title="Encara no hi ha moviments"
            action={
              <div className="flex gap-2">
                {onNavigate && (
                  <Button variant="primary" icon="upload" onClick={() => onNavigate('importar')}>
                    Importar extracte
                  </Button>
                )}
                <Button icon="plus" onClick={() => setCreating(true)}>
                  Afegir a mà
                </Button>
              </div>
            }
          >
            Importa un extracte del banc o afegeix moviments a mà per començar.
          </EmptyState>
        </div>
        <NewTransactionDrawer open={creating} budget={budget} onClose={() => setCreating(false)} />
      </section>
    );
  }

  return (
    <section>
      <PageHeader
        title="Moviments"
        actions={
          <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>
            Afegir moviment
          </Button>
        }
      />

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <PeriodPicker period={period} onChange={changePeriod} defaultMonth={defaultMonth} />
        <div title={VIEW_HINT[reportingView]}>
          <Segmented value={reportingView} onChange={setReportingView} options={VIEW_OPTIONS} />
        </div>
      </div>

      <SummaryPanel
        totals={view.totals}
        previous={view.previous}
        previousLabel={view.previousLabel}
        byCategory={view.byCategory}
        categories={lookups.categories}
        activeCategoryId={activeCategory}
        onPickCategory={pickCategory}
        reportingView={reportingView}
        elsewhereCents={view.elsewhereCents}
        pendingRecoveryCents={view.pending.reduce((s, p) => s + p.pendingCents, 0)}
        pendingDebtCents={summarizeDebts(data.debts).pendingCents}
        onOpenPending={onNavigate ? () => onNavigate('deutes') : undefined}
      />

      {view.reviewCount > 0 && !filter.onlyNeedsReview && (
        <Alert
          tone="warn"
          className="mt-4"
          action={
            <Button
              size="sm"
              onClick={() => {
                set({ onlyNeedsReview: true });
                const first = filterTransactions(data.transactions, { ...filter, ...periodRange(period), onlyNeedsReview: true }).sort(byDateDesc)[0];
                if (first) setOpenId(first.id);
              }}
            >
              Revisar ara
            </Button>
          }
        >
          <span className="font-medium">{view.reviewCount} moviments per revisar</span> en aquest període: cap regla els ha pogut classificar.
        </Alert>
      )}

      {/* Barra d'eines */}
      <div className="mt-8 mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-48 flex-1 sm:max-w-sm">
          <Icon name="search" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-faint" />
          <input className="input pl-9" placeholder="Cerca per descripció o notes" value={filter.text ?? ''} onChange={(e) => set({ text: e.target.value })} />
        </div>
        <Button icon="filter" onClick={() => setShowFilters((s) => !s)} className={cx(showFilters && 'bg-subtle')}>
          Filtres
          {advancedCount > 0 && <span className="rounded-full bg-accent px-1.5 text-[11px] text-white">{advancedCount}</span>}
        </Button>
        <div className="flex-1" />
        <label className="flex items-center gap-2 text-[13px] text-ink-muted max-sm:hidden">
          <input type="checkbox" className="checkbox" checked={allVisibleSelected} onChange={() => setSelected(allVisibleSelected ? new Set() : new Set(visible.map((t) => t.id)))} />
          {rows.length} moviments
        </label>
      </div>

      {showFilters && (
        <div className="mb-4 grid gap-4 rounded-xl border border-line bg-surface p-4 shadow-card sm:grid-cols-2 lg:grid-cols-4">
          <label className="label">
            Compte
            <select className="input" value={filter.accountIds?.[0] ?? ''} onChange={(e) => set({ accountIds: e.target.value ? [e.target.value] : undefined })}>
              <option value="">Tots</option>
              {data.accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <label className="label">
            Tipus
            <select className="input" value={filter.kinds?.[0] ?? ''} onChange={(e) => set({ kinds: e.target.value ? [e.target.value as TransactionKind] : undefined })}>
              <option value="">Tots</option>
              {TRANSACTION_KINDS.map((k) => (
                <option key={k} value={k}>
                  {KIND_LABELS[k]}
                </option>
              ))}
            </select>
          </label>
          <label className="label">
            Categoria
            <select className="input" value={filter.categoryIds?.[0] ?? '__all__'} onChange={(e) => set({ categoryIds: e.target.value === '__all__' ? undefined : [e.target.value] })}>
              <option value="__all__">Totes</option>
              <option value="">Sense categoria</option>
              {data.categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <div className="flex flex-col justify-end gap-2.5 text-sm">
            <label className="flex cursor-pointer items-center justify-between gap-3">
              Només per revisar <Switch checked={!!filter.onlyNeedsReview} onChange={(v) => set({ onlyNeedsReview: v || undefined })} />
            </label>
            <label className="flex cursor-pointer items-center justify-between gap-3">
              Mostrar amagats <Switch checked={!!filter.includeHidden} onChange={(v) => set({ includeHidden: v || undefined })} />
            </label>
          </div>
        </div>
      )}

      {chips.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-1.5">
          {chips.map((c) => (
            <button key={c.key} onClick={c.clear} className="inline-flex h-7 items-center gap-1 rounded-full bg-accent-soft pr-2 pl-3 text-xs font-medium text-accent-ink">
              {c.label} <Icon name="x" className="size-3.5" />
            </button>
          ))}
          <button className="ml-1 text-xs font-medium text-ink-muted hover:text-ink" onClick={() => set({ accountIds: undefined, kinds: undefined, categoryIds: undefined, onlyNeedsReview: undefined, includeHidden: undefined })}>
            Netejar filtres
          </button>
        </div>
      )}

      {rows.length === 0 ? (
        <div className="rounded-xl border border-line bg-surface">
          <EmptyState icon="search" title="Cap moviment">
            {filter.onlyNeedsReview ? 'Ja ho tens tot revisat en aquest període.' : 'No hi ha moviments amb aquests filtres en aquest període.'}
          </EmptyState>
        </div>
      ) : (
        <TransactionList
          rows={visible}
          lookups={lookups}
          selected={selected}
          activeId={openId ?? undefined}
          onToggle={(id) => toggleIds([id])}
          onToggleDay={toggleIds}
          onOpen={(t) => setOpenId(t.id)}
          recoveryInfo={view.recoveryInfo}
        />
      )}
      {rows.length > limit && (
        <div className="mt-6 flex justify-center">
          <Button onClick={() => setLimit((l) => l + PAGE)}>Mostrar més ({rows.length - limit} restants)</Button>
        </div>
      )}

      {selected.size > 0 && <BulkEditBar count={selected.size} categories={data.categories} onApply={applyBulk} onClear={() => setSelected(new Set())} />}

      {openTx && (
        <TransactionDrawer
          tx={openTx}
          budget={budget}
          learn={learnFor(openTx)}
          onLearnChange={isIncoming(openTx) ? setLearnIncoming : setLearnExpense}
          onSave={(patch) => onOpenTx(() => save(openTx, patch))}
          onChangeCategory={(id) => onOpenTx(() => changeCategory(openTx, id))}
          onDelete={() => remove(openTx)}
          onPrev={openIndex > 0 ? () => setOpenId(visible[openIndex - 1].id) : undefined}
          onNext={openIndex >= 0 && openIndex < visible.length - 1 ? () => setOpenId(visible[openIndex + 1].id) : undefined}
          onClose={() => setOpenId(null)}
          onOpenTx={setOpenId}
        />
      )}
      <NewTransactionDrawer open={creating} budget={budget} onClose={() => setCreating(false)} />
    </section>
  );
}

function NewTransactionDrawer({ open, budget, onClose }: { open: boolean; budget: BudgetState; onClose: () => void }) {
  return (
    <Drawer open={open} onClose={onClose} title="Nou moviment" subtitle="Efectiu, cobraments que no passen pel banc, aportacions...">
      <TransactionForm budget={budget} onDone={onClose} />
    </Drawer>
  );
}
