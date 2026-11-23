import { lazy, Suspense, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
  ArrowLeft,
  Download,
  Expand,
  MoreHorizontal,
  Package,
  Radar,
  RefreshCw,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { date, euro, euroPrecise, isUrl, relative } from '@/lib/format';
import type { ProductDetail } from '@/lib/types';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ListingRow } from '@/components/ListingRow';
import { AlertsEditor } from '@/components/AlertsEditor';
import { Delta, LabelBadge } from '@/components/Price';
import { ErrorState, PageSpinner } from '@/components/States';
import { cn } from '@/lib/utils';

const PriceChart = lazy(() =>
  import('@/components/PriceChart').then((m) => ({ default: m.PriceChart })),
);
const chartFallback = <div className="h-72 animate-pulse rounded-xl bg-secondary/60" />;

function useProduct(id: number) {
  return useQuery({
    queryKey: ['product', id],
    queryFn: () => api.product(id),
    enabled: Number.isInteger(id) && id > 0,
  });
}

/** Dialog variant: opened from the overview, keeps the list behind it. */
export function ProductDialog() {
  const { id } = useParams();
  const navigate = useNavigate();
  const q = useProduct(Number(id));
  return (
    <Dialog open onOpenChange={(o) => !o && void navigate(-1)}>
      <DialogContent className="max-h-[92dvh] w-[calc(100vw-1rem)] max-w-4xl gap-0 overflow-y-auto p-0 sm:max-w-4xl">
        <DialogTitle className="sr-only">{q.data?.name ?? 'Product'}</DialogTitle>
        <DialogDescription className="sr-only">
          {q.data ? `${euro(q.data.lowestCents)}` : ''}
        </DialogDescription>
        {q.isPending ? (
          <PageSpinner />
        ) : q.isError ? (
          <ErrorState error={q.error} />
        ) : (
          <ProductView product={q.data} variant="dialog" />
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Full-page variant: direct links, notifications and the fullscreen button. */
export function ProductPage() {
  const { id } = useParams();
  const q = useProduct(Number(id));
  if (q.isPending) return <PageSpinner />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  return <ProductView product={q.data} variant="page" />;
}

function Stat({
  label,
  value,
  sub,
  highlight,
}: {
  label: string;
  value: string;
  sub?: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={cn(
        'rounded-xl border bg-card p-3',
        highlight && 'border-transparent bg-prey text-prey-foreground',
      )}
    >
      <p className={cn('text-xs', highlight ? 'opacity-75' : 'text-muted-foreground')}>{label}</p>
      <p className="font-display text-2xl font-extrabold tabular">{value}</p>
      {sub && (
        <p className={cn('truncate text-xs', highlight ? 'opacity-75' : 'text-muted-foreground')}>
          {sub}
        </p>
      )}
    </div>
  );
}

function ProductView({
  product: p,
  variant,
}: {
  product: ProductDetail;
  variant: 'dialog' | 'page';
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [storeUrl, setStoreUrl] = useState('');
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['product', p.id] });
    void qc.invalidateQueries({ queryKey: ['products'] });
  };

  const check = useMutation({
    mutationFn: () => api.checkProduct(p.id),
    onSuccess: refresh,
    onError: (e) => toast.error(String(e)),
  });
  const advice = useMutation({
    mutationFn: () => api.advice(p.id),
    onSuccess: (r) => {
      if (r.status === 'skipped') toast.info(t(`reason.${r.reason}`, { defaultValue: r.reason }));
      refresh();
    },
  });
  const rediscover = useMutation({
    mutationFn: () => api.rediscover(p.id),
    onSuccess: (r) => void navigate(`/track?run=${r.runId}&product=${p.id}`),
  });
  const addStore = useMutation({
    mutationFn: () => api.addListing(p.id, storeUrl.trim()),
    onSuccess: () => {
      setStoreUrl('');
      refresh();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.code : String(e)),
  });
  const archive = useMutation({
    mutationFn: () => api.updateProduct(p.id, { archived: true }),
    onSuccess: () => {
      toast(t('detail.stopConfirm'));
      void qc.invalidateQueries({ queryKey: ['products'] });
      void navigate('/', { replace: true });
    },
  });
  const toggle = useMutation({
    mutationFn: ({ id, active }: { id: number; active: boolean }) =>
      api.setListingActive(id, active),
    onSuccess: refresh,
  });

  const lowestListing = p.listings.find(
    (l) => l.inStock !== false && l.storeName === p.lowestStore,
  );
  const v = p.verdict;

  return (
    <article className={cn('grid grid-cols-1 gap-6', variant === 'dialog' ? 'p-5 sm:p-6' : 'pb-8')}>
      {variant === 'page' && (
        <Link
          to="/"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden /> {t('detail.back')}
        </Link>
      )}

      <header className={cn('flex items-start gap-3 sm:gap-4', variant === 'dialog' && 'pr-8')}>
        <div className="hidden size-20 shrink-0 place-items-center overflow-hidden rounded-2xl bg-secondary sm:grid">
          {p.imageUrl ? (
            <img
              src={p.imageUrl}
              alt=""
              className="size-full object-contain mix-blend-multiply dark:mix-blend-normal"
            />
          ) : (
            <Package className="size-8 text-muted-foreground" aria-hidden />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <LabelBadge label={p.label} />
            <Delta value={p.deltaPct} />
          </div>
          <h1 className="mt-1 font-display text-xl leading-tight font-extrabold tracking-tight text-balance sm:text-2xl md:text-3xl">
            {p.name}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {[
              p.brand,
              t('detail.trackedSince', { date: date(p.trackedSince) }),
              t('overview.stores', { count: p.storesCount }),
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {variant === 'dialog' && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" asChild>
                  <Link to={`/p/${p.id}`} replace aria-label={t('detail.fullscreen')}>
                    <Expand />
                  </Link>
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('detail.fullscreen')}</TooltipContent>
            </Tooltip>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label={t('common.moreActions')}>
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => check.mutate()}>
                <RefreshCw /> {t('detail.checkNow')}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => rediscover.mutate()}>
                <Radar /> {t('detail.discover')}
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <a href={api.exportUrl(p.id)} download>
                  <Download /> {t('detail.export')}
                </a>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => archive.mutate()}>
                <Trash2 /> {t('detail.stop')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4" aria-label={t('detail.verdict')}>
        <Stat
          highlight
          label={t('detail.lowestNow')}
          value={euro(v.currentLowest)}
          sub={v.currentStore ? t('overview.at', { store: v.currentStore }) : undefined}
        />
        <Stat label={t('detail.allTimeLow')} value={euro(v.allTimeLow)} />
        <Stat label={t('detail.low30')} value={euro(v.low30)} />
        <Stat label={t('detail.median90')} value={euro(v.median90)} />
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="grid min-w-0 grid-cols-1 content-start gap-6">
          <section aria-labelledby="h-history" className="rounded-2xl border bg-card p-4">
            <Tabs defaultValue="lowest">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 id="h-history" className="font-semibold">
                  {t('detail.history')}
                </h2>
                <TabsList>
                  <TabsTrigger value="lowest">{t('overview.lowestNow')}</TabsTrigger>
                  <TabsTrigger value="stores">{t('detail.perStore')}</TabsTrigger>
                </TabsList>
              </div>
              <TabsContent value="lowest" className="mt-3">
                <Suspense fallback={chartFallback}>
                  <PriceChart product={p} mode="lowest" />
                </Suspense>
              </TabsContent>
              <TabsContent value="stores" className="mt-3">
                <Suspense fallback={chartFallback}>
                  <PriceChart product={p} mode="stores" />
                </Suspense>
              </TabsContent>
            </Tabs>
          </section>

          <section aria-labelledby="h-stores" className="grid grid-cols-1 gap-3">
            <h2 id="h-stores" className="font-semibold">
              {t('detail.stores')}{' '}
              <span className="text-muted-foreground tabular">({p.listings.length})</span>
            </h2>
            <ul className="grid grid-cols-1 gap-2">
              {p.listings.map((l) => (
                <ListingRow
                  key={l.id}
                  l={l}
                  lowest={l.id === lowestListing?.id}
                  compareUnit={p.compareUnit}
                  onToggle={(active) => toggle.mutate({ id: l.id, active })}
                />
              ))}
            </ul>
            <form
              className="flex flex-col gap-2 sm:flex-row"
              onSubmit={(e) => {
                e.preventDefault();
                if (isUrl(storeUrl)) addStore.mutate();
              }}
            >
              <Input
                type="url"
                value={storeUrl}
                onChange={(e) => setStoreUrl(e.target.value)}
                placeholder={t('detail.addStoreUrl')}
                aria-label={t('detail.addStoreUrl')}
              />
              <Button
                type="submit"
                variant="outline"
                disabled={!isUrl(storeUrl) || addStore.isPending}
              >
                {t('detail.addStore')}
              </Button>
            </form>
          </section>
        </div>

        <aside className="grid content-start gap-6">
          <section aria-labelledby="h-advice" className="rounded-2xl border bg-card p-4">
            <div className="flex items-center justify-between gap-2">
              <h2 id="h-advice" className="flex items-center gap-2 font-semibold">
                <Sparkles className="size-4" aria-hidden /> {t('detail.advice')}
              </h2>
              {p.aiBudgetTier !== 'none' && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => advice.mutate()}
                  disabled={advice.isPending}
                >
                  <RefreshCw className={cn(advice.isPending && 'animate-spin')} />{' '}
                  <span className="sr-only">{t('detail.refreshAdvice')}</span>
                </Button>
              )}
            </div>
            {p.advice ? (
              <>
                <p className="mt-2 text-sm leading-relaxed whitespace-pre-line">{p.advice.text}</p>
                <p className="mt-3 text-xs text-muted-foreground">
                  {relative(p.advice.createdAt)} ·{' '}
                  {t('detail.adviceCost', { cost: euroPrecise(p.aiCost.eur) })}
                </p>
              </>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">{t('detail.noAdvice')}</p>
            )}
            <p className="mt-3 border-t pt-3 text-sm">
              <span className="text-muted-foreground">{t('detail.verdict')}: </span>
              <LabelBadge label={p.label} />
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              {t('detail.adviceMode.' + p.adviceMode)} · {t(`wizard.tier.${p.aiBudgetTier}`)}
            </p>
          </section>

          <section aria-labelledby="h-alerts" className="rounded-2xl border bg-card p-4">
            <h2 id="h-alerts" className="mb-1 font-semibold">
              {t('detail.alerts')}
            </h2>
            <AlertsEditor product={p} />
          </section>

          {p.changes.length > 0 && (
            <section aria-labelledby="h-changes" className="rounded-2xl border bg-card p-4">
              <h2 id="h-changes" className="mb-2 font-semibold">
                {t('detail.recent')}
              </h2>
              <ol className="grid gap-2 text-sm">
                {p.changes.slice(0, 8).map((c, i) => {
                  const down = c.toCents < c.fromCents;
                  return (
                    <li key={i} className="flex items-baseline justify-between gap-2">
                      <span className="min-w-0 truncate">
                        <span className="font-medium">{c.storeName}</span>{' '}
                        <span className="text-xs text-muted-foreground">{relative(c.at)}</span>
                      </span>
                      <span
                        className={cn(
                          'shrink-0 tabular',
                          down ? 'font-semibold' : 'text-rise-foreground',
                        )}
                      >
                        {down ? '↓' : '↑'} {euro(c.fromCents)} → {euro(c.toCents)}
                      </span>
                    </li>
                  );
                })}
              </ol>
            </section>
          )}
        </aside>
      </div>
    </article>
  );
}
