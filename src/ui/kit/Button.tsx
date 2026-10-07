import type { ButtonHTMLAttributes } from 'react';
import { cx } from './cx';
import { Icon, type IconName } from './Icon';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent text-white shadow-xs hover:bg-accent-hover',
  secondary: 'border border-line bg-surface text-ink shadow-xs hover:bg-subtle',
  ghost: 'text-ink-muted hover:bg-subtle hover:text-ink',
  danger: 'text-neg hover:bg-neg-soft',
};

const SIZES: Record<Size, string> = {
  sm: 'h-8 gap-1.5 px-2.5 text-[13px]',
  md: 'h-9 gap-2 px-3.5 text-sm',
};

/** Classes de botó, per fer servir també en <label> (inputs de fitxer). */
export function buttonClass(variant: Variant = 'secondary', size: Size = 'md', className?: string) {
  return cx(
    'inline-flex shrink-0 cursor-pointer items-center justify-center rounded-lg font-medium whitespace-nowrap transition select-none',
    'focus-visible:ring-3 focus-visible:ring-accent/25 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50',
    VARIANTS[variant],
    SIZES[size],
    className,
  );
}

export function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  className,
  children,
  type = 'button',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size; icon?: IconName }) {
  return (
    <button type={type} className={buttonClass(variant, size, cx(!children && (size === 'sm' ? 'w-8 px-0' : 'w-9 px-0'), className))} {...rest}>
      {icon && <Icon name={icon} />}
      {children}
    </button>
  );
}
