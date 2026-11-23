import { useTranslation } from 'react-i18next';
import { ArrowDownRight, ArrowUpRight, ShieldAlert } from 'lucide-react';
import type { DealLabel } from '@/lib/types';
import { pct } from '@/lib/format';
import { cn } from '@/lib/utils';

const LABEL_STYLE: Record<DealLabel, string> = {
  topdeal: 'bg-prey text-prey-foreground border-transparent',
  good: 'bg-prey/35 text-foreground border-transparent',
  normal: 'bg-secondary text-secondary-foreground border-transparent',
  expensive: 'bg-rise text-rise-foreground border-transparent',
  insufficient_history: 'border-dashed text-muted-foreground',
};

export function LabelBadge({ label, className }: { label: DealLabel; className?: string }) {
  const { t } = useTranslation();
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap',
        LABEL_STYLE[label],
        className,
      )}
    >
      {t(`label.${label}`)}
    </span>
  );
}

/** Drops and rises differ by arrow, colour and wording, never colour alone. */
export function Delta({ value, className }: { value: number | null; className?: string }) {
  const { t } = useTranslation();
  if (value == null || value === 0)
    return (
      <span className={cn('text-sm text-muted-foreground', className)}>{t('overview.flat')}</span>
    );
  const down = value < 0;
  const Icon = down ? ArrowDownRight : ArrowUpRight;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-sm font-semibold tabular',
        down ? 'bg-prey/60 text-prey-foreground' : 'bg-rise text-rise-foreground',
        className,
      )}
    >
      <Icon className="size-3.5" aria-hidden />
      {t('overview.sinceTracking', { pct: pct(value) })}
    </span>
  );
}

export function FakeBadge({ count }: { count: number }) {
  const { t } = useTranslation();
  if (!count) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-rise px-2.5 py-0.5 text-xs font-semibold text-rise-foreground">
      <ShieldAlert className="size-3.5" aria-hidden />
      {t('overview.fake')} · {count}
    </span>
  );
}

export function Sparkline({ values, className }: { values: number[]; className?: string }) {
  if (values.length < 2) return <div className={cn('h-10', className)} aria-hidden />;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const w = 120;
  const h = 40;
  const pts = values.map(
    (v, i) => [(i / (values.length - 1)) * w, h - 4 - ((v - min) / span) * (h - 8)] as const,
  );
  const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  const last = pts[pts.length - 1]!;
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      className={cn('h-10 w-full overflow-visible', className)}
      aria-hidden
    >
      <path d={`${d} L${w} ${h} L0 ${h} Z`} className="fill-prey/25" />
      <path
        d={d}
        fill="none"
        className="stroke-foreground"
        strokeWidth="1.75"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
      <circle cx={last[0]} cy={last[1]} r="3" className="fill-foreground" />
    </svg>
  );
}
