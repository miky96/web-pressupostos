import { cx } from '../kit/cx';

export const centsToInput = (c: number) => (c / 100).toFixed(2).replace('.', ',');
export const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Barra de progrés amb una marca opcional (p.ex. on hauries de ser segons el ritme). */
export function ProgressBar({ ratio, marker, tone = 'accent', color, className }: { ratio: number; marker?: number; tone?: 'accent' | 'pos' | 'warn' | 'neg'; color?: string; className?: string }) {
  const fill = { accent: 'bg-accent', pos: 'bg-pos', warn: 'bg-warn', neg: 'bg-neg' }[tone];
  return (
    <div className={cx('relative h-2 rounded-full bg-subtle', className)}>
      <div className={cx('h-full rounded-full transition-[width]', !color && fill)} style={{ width: `${Math.min(Math.max(ratio, 0), 1) * 100}%`, backgroundColor: color }} />
      {marker !== undefined && marker > 0 && marker < 1 && (
        <div className="absolute -top-1 -bottom-1 w-0.5 rounded-full bg-ink/60" style={{ left: `calc(${marker * 100}% - 1px)` }} title="On hauries de ser avui" />
      )}
    </div>
  );
}
