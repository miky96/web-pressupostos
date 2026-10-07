import type { ReactNode } from 'react';
import { cx } from './cx';

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx('rounded-xl border border-line bg-surface shadow-card', className)}>{children}</div>;
}

export function CardHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
      <div className="min-w-0">
        <h3 className="text-[15px] font-semibold">{title}</h3>
        {subtitle && <p className="mt-0.5 text-sm text-ink-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold">{title}</h1>
        {subtitle && <p className="mt-1 max-w-2xl text-sm text-ink-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Xifra destacada (KPI). */
export function Stat({
  label,
  value,
  hint,
  tone,
  size = 'lg',
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  tone?: 'pos' | 'neg';
  size?: 'md' | 'lg';
  className?: string;
}) {
  return (
    <div className={cx('min-w-0', className)}>
      <div className="text-[13px] font-medium text-ink-muted">{label}</div>
      <div className={cx('amount mt-1 font-semibold tracking-tight', size === 'lg' ? 'text-2xl' : 'text-lg', tone === 'pos' && 'text-pos', tone === 'neg' && 'text-neg')}>{value}</div>
      {hint && <div className="mt-1 text-xs text-ink-muted">{hint}</div>}
    </div>
  );
}
