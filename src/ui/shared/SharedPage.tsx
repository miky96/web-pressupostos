import { useMemo, useState, type ReactNode } from 'react';
import { formatCents } from '../../domain/money';
import { peopleOverview, splitLabel, summarizeShared, type PersonPosition, type SharedSummary } from '../../domain/shared';
import { ME } from '../../domain/types';
import { Button } from '../kit/Button';
import { Card, PageHeader, Stat } from '../kit/Card';
import { cx } from '../kit/cx';
import { Drawer } from '../kit/Drawer';
import { Badge, EmptyState, Segmented } from '../kit/Feedback';
import { Icon } from '../kit/Icon';
import type { BudgetState } from '../useBudget';
import { SharedDrawer } from './SharedDrawer';
import { SharedForm } from './SharedForm';

type Section = 'persones' | 'coses';
const SECTIONS: { value: Section; label: string }[] = [
  { value: 'persones', label: 'Per persona' },
  { value: 'coses', label: 'Coses compartides' },
];

type Open = { mode: 'new' } | { mode: 'view'; id: string } | null;

export function PersonAvatar({ name, className }: { name: string; className?: string }) {
  return <div className={cx('grid size-9 shrink-0 place-items-center rounded-full bg-accent-soft text-[13px] font-semibold text-accent-ink uppercase', className)}>{name.charAt(0)}</div>;
}

/** "Et deu 20 €", "Li deus 20 €", "En paus". */
export function BalanceText({ cents, className }: { cents: number; className?: string }) {
  if (cents === 0) return <span className={cx('text-ink-muted', className)}>En paus</span>;
  return (
    <span className={cx('amount font-semibold', cents > 0 ? 'text-pos' : 'text-neg', className)}>
      {cents > 0 ? 'Et deu ' : 'Li deus '}
      {formatCents(Math.abs(cents))}
    </span>
  );
}

export function SharedPage({ budget, onNavigate }: { budget: BudgetState; onNavigate: (tab: 'deutes') => void }) {
  const { data } = budget;
  const [section, setSection] = useState<Section>('persones');
  const [open, setOpen] = useState<Open>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [showSettled, setShowSettled] = useState(false);

  const summaries = useMemo(() => (data ? data.shared.map((i) => summarizeShared(i, data.transactions)) : []), [data]);
  const people = useMemo(() => (data ? peopleOverview(data.shared, data.debts, data.transactions) : []), [data]);
  if (!data) return null;

  const owedToMe = people.reduce((s, p) => s + Math.max(p.netCents, 0), 0);
  const iOwe = people.reduce((s, p) => s + Math.max(-p.netCents, 0), 0);
  const byName = (a: SharedSummary, b: SharedSummary) => a.item.name.localeCompare(b.item.name, 'ca');
  const live = summaries.filter((s) => !s.item.archived);
  // Un sopar o un viatge en paus ja no cal veure'l; una cosa física continua sent de tots.
  const isDone = (s: SharedSummary) => !s.item.physical && s.item.kind === 'oneoff' && s.settled && s.expenses.length > 0;
  const active = live.filter((s) => !s.item.physical && !isDone(s)).sort((a, b) => Number(a.settled) - Number(b.settled) || byName(a, b));
  const physical = live.filter((s) => s.item.physical).sort(byName);
  const settled = live.filter(isDone).sort(byName);
  const archived = summaries.filter((s) => s.item.archived);
  const row = (s: SharedSummary) => <SharedRow key={s.item.id} s={s} onOpen={() => setOpen({ mode: 'view', id: s.item.id })} />;
  const openItem = open?.mode === 'view' ? data.shared.find((i) => i.id === open.id) : undefined;
  const newButton = (
    <Button variant="primary" icon="plus" onClick={() => setOpen({ mode: 'new' })}>
      Nova cosa compartida
    </Button>
  );

  return (
    <section className="max-w-4xl">
      <PageHeader
        title="Compartit"
        subtitle="Què tens amb cada persona: coses que pagueu entre diversos (un viatge, el pis, el cotxe, una subscripció a mitges) i els deutes. Al consum real només hi compta la teva part."
        actions={newButton}
      />

      <Card className="mb-6 grid grid-cols-2 gap-5 p-5 sm:p-6">
        <Stat label="Et deuen" value={formatCents(owedToMe)} tone={owedToMe ? 'pos' : undefined} />
        <Stat label="Deus" value={formatCents(iOwe)} tone={iOwe ? 'neg' : undefined} />
      </Card>

      <div className="mb-6">
        <Segmented value={section} options={SECTIONS} onChange={setSection} />
      </div>

      {section === 'persones' ? (
        <PeopleList people={people} onOpenItem={(id) => setOpen({ mode: 'view', id })} onOpenDebts={() => onNavigate('deutes')} />
      ) : summaries.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line-strong bg-surface">
          <EmptyState icon="split" title="Encara no comparteixes res" action={newButton}>
            Apunta una compra amb amics, el pis o una subscripció a mitges: qui ha pagat què i quant li toca a cadascú.
          </EmptyState>
        </div>
      ) : (
        <>
          {active.length > 0 ? (
            <div className="space-y-3">{active.map(row)}</div>
          ) : (
            <p className="text-sm text-ink-muted">Res pendent: esteu en paus amb tot.</p>
          )}
          {physical.length > 0 && (
            <div className="mt-8">
              <h3 className="mb-1 text-[13px] font-semibold text-ink-muted">Coses físiques ({physical.length})</h3>
              <p className="hint mb-3">Mobles, electrodomèstics… que són de tots. La teva part és el que et toca si un dia es reparteix.</p>
              <div className="space-y-3">{physical.map(row)}</div>
            </div>
          )}
          <Collapsible label="En paus" items={settled} open={showSettled} onToggle={() => setShowSettled((v) => !v)} row={row} />
          <Collapsible label="Arxivades" items={archived} open={showArchived} onToggle={() => setShowArchived((v) => !v)} row={row} />
        </>
      )}

      {open?.mode === 'new' && (
        <Drawer open onClose={() => setOpen(null)} title="Nova cosa compartida" subtitle="Amb qui la comparteixes i com us la repartiu">
          <SharedForm budget={budget} onDone={(id) => setOpen({ mode: 'view', id })} onCancel={() => setOpen(null)} />
        </Drawer>
      )}
      {openItem && <SharedDrawer key={openItem.id} budget={budget} item={openItem} onClose={() => setOpen(null)} />}
    </section>
  );
}

function Collapsible({ label, items, open, onToggle, row }: { label: string; items: SharedSummary[]; open: boolean; onToggle: () => void; row: (s: SharedSummary) => ReactNode }) {
  if (items.length === 0) return null;
  return (
    <div className="mt-8">
      <button className="mb-3 inline-flex items-center gap-1 text-[13px] font-semibold text-ink-muted hover:text-ink" onClick={onToggle}>
        <Icon name={open ? 'chevronDown' : 'chevronRight'} className="size-4" />
        {label} ({items.length})
      </button>
      {open && <div className="space-y-3 opacity-80">{items.map(row)}</div>}
    </div>
  );
}

const itemIcon = (item: SharedSummary['item']) => (item.physical ? 'box' : item.subscriptionId ? 'repeat' : item.kind === 'ongoing' ? 'calendar' : 'split');

function SharedRow({ s, onOpen }: { s: SharedSummary; onOpen: () => void }) {
  const others = s.item.participants.filter((p) => p.id !== ME).map((p) => p.name);
  return (
    <Card>
      <button className="group flex w-full items-center gap-4 px-4 py-3.5 text-left hover:bg-subtle/60" onClick={onOpen}>
        <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-subtle text-ink-muted">
          <Icon name={itemIcon(s.item)} className="size-[18px]" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-semibold">{s.item.name}</span>
            {s.settled && s.expenses.length > 0 && <Badge tone="pos">En paus</Badge>}
          </div>
          <div className="mt-0.5 truncate text-xs text-ink-muted">
            Amb {others.join(', ')} · {splitLabel(s.item.participants)}
          </div>
          <div className="mt-0.5 text-xs text-ink-faint">
            Total {formatCents(s.totalCents)} · la teva part {formatCents(s.myShareCents)}
          </div>
        </div>
        <div className="text-right text-sm">
          {s.myNetCents === 0 ? (
            <span className="text-ink-muted">—</span>
          ) : (
            <>
              <div className={cx('amount font-semibold', s.myNetCents > 0 ? 'text-pos' : 'text-neg')}>{formatCents(Math.abs(s.myNetCents))}</div>
              <div className="text-xs text-ink-muted">{s.myNetCents > 0 ? "t'han de tornar" : 'has de pagar'}</div>
            </>
          )}
        </div>
        <Icon name="chevronRight" className="size-4 text-ink-faint opacity-0 transition group-hover:opacity-100" />
      </button>
    </Card>
  );
}

function PeopleList({ people, onOpenItem, onOpenDebts }: { people: PersonPosition[]; onOpenItem: (id: string) => void; onOpenDebts: () => void }) {
  if (people.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-line-strong bg-surface">
        <EmptyState icon="users" title="Esteu en paus amb tothom">
          Aquí veuràs què et deu cada persona (o què li deus) sumant els deutes i les coses compartides.
        </EmptyState>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      {people.map((p) => (
        <Card key={p.key}>
          <div className="flex items-center gap-3 border-b border-line px-4 py-3">
            <PersonAvatar name={p.name} />
            <div className="min-w-0 flex-1 truncate font-semibold">{p.name}</div>
            <BalanceText cents={p.netCents} className="text-right" />
          </div>
          <ul className="divide-y divide-line text-sm">
            {p.debts.length > 0 && (
              <li>
                <button className="group flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-subtle/60" onClick={onOpenDebts}>
                  <Icon name="banknote" className="size-4 text-ink-faint" />
                  <span className="min-w-0 flex-1 truncate">
                    Deutes <span className="text-ink-muted">· {p.debts.length === 1 ? p.debts[0].reason || '1 deute' : `${p.debts.length} deutes`}</span>
                  </span>
                  <BalanceText cents={p.debtCents} className="text-[13px]" />
                  <Icon name="chevronRight" className="size-4 text-ink-faint opacity-0 transition group-hover:opacity-100" />
                </button>
              </li>
            )}
            {p.items.map(({ item, cents }) => (
              <li key={item.id}>
                <button className="group flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-subtle/60" onClick={() => onOpenItem(item.id)}>
                  <Icon name={item.physical ? 'box' : item.subscriptionId ? 'repeat' : 'split'} className="size-4 text-ink-faint" />
                  <span className="min-w-0 flex-1 truncate">{item.name}</span>
                  <BalanceText cents={cents} className="text-[13px]" />
                  <Icon name="chevronRight" className="size-4 text-ink-faint opacity-0 transition group-hover:opacity-100" />
                </button>
              </li>
            ))}
          </ul>
        </Card>
      ))}
    </div>
  );
}
