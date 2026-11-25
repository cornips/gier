import { Link, useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Package } from 'lucide-react';
import type { ProductSummary } from '@/lib/types';
import { euro } from '@/lib/format';
import { Delta, FakeBadge, LabelBadge, Sparkline } from './Price';

export function ProductCard({ p }: { p: ProductSummary }) {
  const { t } = useTranslation();
  const location = useLocation();
  return (
    <Link
      to={`/p/${p.id}`}
      state={{ background: location }}
      className="group flex flex-col gap-4 rounded-2xl border bg-card p-4 shadow-[0_1px_0_rgba(22,22,26,0.04)] transition hover:-translate-y-0.5 hover:border-foreground/25 hover:shadow-md focus-visible:-translate-y-0.5"
    >
      <div className="flex items-start gap-3">
        <div className="grid size-14 shrink-0 place-items-center overflow-hidden rounded-xl bg-secondary">
          {p.imageUrl ? (
            <img
              src={p.imageUrl}
              alt=""
              loading="lazy"
              className="size-full object-contain mix-blend-multiply dark:mix-blend-normal"
            />
          ) : (
            <Package className="size-6 text-muted-foreground" aria-hidden />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="line-clamp-2 leading-snug font-semibold wrap-break-word">{p.name}</h3>
          <p className="mt-0.5 text-xs wrap-break-word text-muted-foreground">
            {[p.brand, t('overview.stores', { count: p.storesCount })].filter(Boolean).join(' · ')}
          </p>
        </div>
      </div>
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">{t('overview.lowestNow')}</p>
          <p className="font-display text-3xl leading-none font-extrabold tabular">
            {euro(p.lowestCents)}
          </p>
          {p.lowestStore && (
            <p className="mt-1 text-xs wrap-break-word text-muted-foreground">
              {t('overview.at', { store: p.lowestStore })}
            </p>
          )}
        </div>
        <Sparkline values={p.sparkline} className="max-w-32 min-w-12 shrink" />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <LabelBadge label={p.label} />
        <Delta value={p.deltaPct} />
        <FakeBadge count={p.fakeDiscounts} />
      </div>
    </Link>
  );
}
