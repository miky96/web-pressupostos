import { isNeutralKind, type Category, type Transaction } from '../domain/types';
import { cx } from './kit/cx';
import { Icon } from './kit/Icon';

/** Cercle amb el color i la inicial de la categoria (o una icona per a traspassos / sense categoria). */
export function CategoryAvatar({ tx, category, className }: { tx?: Pick<Transaction, 'kind' | 'needsReview'>; category?: Category; className?: string }) {
  const base = cx('grid size-9 shrink-0 place-items-center rounded-full text-[13px] font-semibold', className);
  if (tx && isNeutralKind(tx.kind)) {
    return (
      <div className={cx(base, 'bg-subtle text-ink-muted')}>
        <Icon name="arrows" />
      </div>
    );
  }
  if (!category) {
    return <div className={cx(base, tx?.needsReview ? 'bg-warn-soft text-warn' : 'bg-subtle text-ink-faint')}>?</div>;
  }
  const color = category.color ?? '#8a93a6';
  return (
    <div className={base} style={{ backgroundColor: `color-mix(in srgb, ${color} 16%, transparent)`, color }}>
      {category.name.charAt(0).toUpperCase()}
    </div>
  );
}

export function CategoryDot({ color, className }: { color?: string; className?: string }) {
  return <span className={cx('inline-block size-2.5 shrink-0 rounded-full', className)} style={{ backgroundColor: color ?? '#8a93a6' }} />;
}
