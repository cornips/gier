import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useOutletContext } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Plus } from 'lucide-react';
import { api } from '@/lib/api';
import { relative } from '@/lib/format';
import { locale } from '@/i18n';
import type { ProductSummary } from '@/lib/types';
import type { ShellContext } from '@/components/AppShell';
import { ProductCard } from '@/components/ProductCard';
import { EmptyState, ErrorState } from '@/components/States';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

type Filter = 'all' | 'dropped' | 'allTimeLow' | 'fake' | 'rose';
type Sort = 'drop' | 'name' | 'recent';

const FILTERS: Record<Filter, (p: ProductSummary) => boolean> = {
  all: () => true,
  dropped: (p) => (p.deltaPct ?? 0) < 0,
  allTimeLow: (p) => p.lowestCents != null && p.allTimeLow != null && p.lowestCents <= p.allTimeLow,
  fake: (p) => p.fakeDiscounts > 0,
  rose: (p) => (p.deltaPct ?? 0) > 0,
};

export function OverviewPage() {
  const { t } = useTranslation();
  const { openSearch } = useOutletContext<ShellContext>();
  const [filter, setFilter] = useState<Filter>('all');
  const [sort, setSort] = useState<Sort>('drop');
  const products = useQuery({
    queryKey: ['products'],
    queryFn: api.products,
    refetchInterval: 120_000,
  });
  const navigate = useNavigate();
  useEffect(() => {
    // First run without products: show the onboarding once.
    let welcomed = true;
    try {
      welcomed = localStorage.getItem('gier.welcomed') === '1';
    } catch {
      /* ignore */
    }
    if (products.data?.length === 0 && !welcomed) void navigate('/welcome', { replace: true });
  }, [products.data, navigate]);

  const list = useMemo(() => {
    const items = (products.data ?? []).filter(FILTERS[filter]);
    const by: Record<Sort, (a: ProductSummary, b: ProductSummary) => number> = {
      drop: (a, b) => (a.deltaPct ?? 0) - (b.deltaPct ?? 0),
      name: (a, b) => a.name.localeCompare(b.name, locale()),
      recent: (a, b) => b.id - a.id,
    };
    return items.sort(by[sort]);
  }, [products.data, filter, sort]);

  if (products.isError)
    return <ErrorState error={products.error} onRetry={() => void products.refetch()} />;

  const all = products.data ?? [];
  const lastCheck = all.reduce((m, p) => Math.max(m, p.lastCheckedAt ?? 0), 0);

  return (
    <div className="grid grid-cols-1 gap-6">
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-extrabold tracking-tight md:text-4xl">
            {products.isPending ? (
              <Skeleton className="h-10 w-72" />
            ) : (
              t('overview.title', { count: all.length })
            )}
          </h1>
          <p className="mt-1 text-muted-foreground">
            {t('overview.subtitle', {
              when: lastCheck ? relative(lastCheck) : t('overview.never'),
            })}
          </p>
        </div>
        <Button onClick={openSearch} className="hidden md:inline-flex">
          <Plus /> {t('search.new')}
        </Button>
      </section>

      {all.length > 0 && (
        <div className="flex min-w-0 flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div
            role="group"
            aria-label="Filter"
            className="-mx-4 flex min-w-0 gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] md:mx-0 md:flex-wrap md:px-0"
          >
            {(Object.keys(FILTERS) as Filter[]).map((f) => {
              const count = all.filter(FILTERS[f]).length;
              return (
                <button
                  key={f}
                  type="button"
                  aria-pressed={filter === f}
                  onClick={() => setFilter(f)}
                  className={cn(
                    'flex shrink-0 items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm font-medium transition',
                    filter === f
                      ? 'border-foreground bg-foreground text-background'
                      : 'bg-card hover:border-foreground/30',
                  )}
                >
                  {t(`overview.${f}`)}
                  <span
                    className={cn(
                      'tabular text-xs',
                      filter === f ? 'opacity-80' : 'text-muted-foreground',
                    )}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
          <Select value={sort} onValueChange={(v) => setSort(v as Sort)}>
            <SelectTrigger className="w-full md:w-44" aria-label={t('overview.sort')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="drop">{t('overview.sortDrop')}</SelectItem>
              <SelectItem value="name">{t('overview.sortName')}</SelectItem>
              <SelectItem value="recent">{t('overview.sortRecent')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      {products.isPending ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-52 rounded-2xl" />
          ))}
        </div>
      ) : all.length === 0 ? (
        <EmptyState
          title={t('overview.empty')}
          action={
            <Button onClick={openSearch}>
              <Plus /> {t('overview.emptyCta')}
            </Button>
          }
        />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((p) => (
            <li key={p.id} className="grid">
              <ProductCard p={p} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
