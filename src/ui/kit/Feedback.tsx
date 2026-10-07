import type { ReactNode } from 'react';
import { cx } from './cx';
import { Icon, type IconName } from './Icon';

type Tone = 'neutral' | 'accent' | 'pos' | 'neg' | 'warn';

const BADGE: Record<Tone, string> = {
  neutral: 'bg-subtle text-ink-muted',
  accent: 'bg-accent-soft text-accent-ink',
  pos: 'bg-pos-soft text-pos',
  neg: 'bg-neg-soft text-neg',
  warn: 'bg-warn-soft text-warn',
};

export function Badge({ tone = 'neutral', children, title, className }: { tone?: Tone; children: ReactNode; title?: string; className?: string }) {
  return (
    <span title={title} className={cx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap', BADGE[tone], className)}>
      {children}
    </span>
  );
}

const ALERT: Record<Exclude<Tone, 'neutral' | 'accent'> | 'info', { box: string; icon: IconName }> = {
  info: { box: 'border-accent/20 bg-accent-soft text-accent-ink', icon: 'sparkle' },
  pos: { box: 'border-pos/20 bg-pos-soft text-pos', icon: 'check' },
  neg: { box: 'border-neg/20 bg-neg-soft text-neg', icon: 'alert' },
  warn: { box: 'border-warn/20 bg-warn-soft text-warn', icon: 'alert' },
};

export function Alert({
  tone = 'info',
  title,
  children,
  action,
  onClose,
  className,
}: {
  tone?: keyof typeof ALERT;
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  onClose?: () => void;
  className?: string;
}) {
  const s = ALERT[tone];
  return (
    <div role={tone === 'neg' ? 'alert' : 'status'} className={cx('flex items-start gap-3 rounded-xl border px-4 py-3 text-sm', s.box, className)}>
      <Icon name={s.icon} className="mt-0.5 size-4" />
      <div className="min-w-0 flex-1">
        {title && <div className="font-semibold">{title}</div>}
        {children && <div className={cx(!!title && 'mt-0.5', 'text-ink')}>{children}</div>}
      </div>
      {action}
      {onClose && (
        <button className="-mr-1 rounded p-0.5 opacity-70 hover:opacity-100" onClick={onClose} aria-label="Tancar">
          <Icon name="x" />
        </button>
      )}
    </div>
  );
}

export function EmptyState({ icon, title, children, action }: { icon: IconName; title: ReactNode; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      <div className="mb-4 grid size-12 place-items-center rounded-full bg-subtle text-ink-muted">
        <Icon name={icon} className="size-5" />
      </div>
      <div className="font-semibold">{title}</div>
      {children && <p className="mt-1 max-w-sm text-sm text-ink-muted">{children}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/** Control segmentat (p.ex. Mes / Any / Tot). */
export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex rounded-lg bg-subtle p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cx(
            'h-8 rounded-md px-3 text-[13px] font-medium transition',
            o.value === value ? 'bg-surface text-ink shadow-xs' : 'text-ink-muted hover:text-ink',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Interruptor accessible (checkbox amb aspecte de switch). */
export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cx('relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition', checked ? 'bg-accent' : 'bg-line-strong')}
    >
      <span className={cx('inline-block size-4 rounded-full bg-white shadow transition', checked ? 'translate-x-4.5' : 'translate-x-0.5')} />
    </button>
  );
}
