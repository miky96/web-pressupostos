import { useEffect, type ReactNode } from 'react';
import { Icon } from './Icon';

/** Panell lateral (a mòbil ocupa tota l'amplada). Es tanca amb Esc o clicant fora. */
export function Drawer({
  open,
  onClose,
  title,
  subtitle,
  headerActions,
  footer,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  headerActions?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-[1px]" onClick={onClose} />
      <aside role="dialog" aria-modal="true" className="relative flex h-full w-full max-w-md flex-col border-l border-line bg-surface shadow-pop">
        <header className="flex items-start gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-base font-semibold">{title}</h2>
            {subtitle && <div className="mt-0.5 text-sm text-ink-muted">{subtitle}</div>}
          </div>
          {headerActions}
          <button className="-mr-1 rounded-lg p-1.5 text-ink-muted hover:bg-subtle hover:text-ink" onClick={onClose} aria-label="Tancar">
            <Icon name="x" />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-5 py-5">{children}</div>
        {footer && <footer className="flex flex-wrap items-center gap-2 border-t border-line px-5 py-3">{footer}</footer>}
      </aside>
    </div>
  );
}
