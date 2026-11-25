import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  BellOff,
  CheckCheck,
  Moon,
  ShieldAlert,
  Sparkles,
  Store,
  TrendingDown,
  TriangleAlert,
} from 'lucide-react';
import { api } from '@/lib/api';
import { relative } from '@/lib/format';
import type { NotificationRow } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { EmptyState, ErrorState, PageSpinner } from '@/components/States';
import { cn } from '@/lib/utils';

type Filter = 'all' | 'deal' | 'fake' | 'store' | 'advice';
const ICON = {
  deal: TrendingDown,
  fake: ShieldAlert,
  store: Store,
  advice: Sparkles,
  warning: TriangleAlert,
  digest: TrendingDown,
  login: TriangleAlert,
} as const;

export default function NotificationsPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['notifications'], queryFn: api.notifications });
  const [filter, setFilter] = useState<Filter>('all');
  const read = useMutation({
    mutationFn: (ids?: number[]) => api.markRead(ids),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const groups = useMemo(() => {
    const items = (q.data ?? []).filter((n) => filter === 'all' || n.kind === filter);
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    return {
      today: items.filter((n) => new Date(n.createdAt) >= startOfDay),
      earlier: items.filter((n) => new Date(n.createdAt) < startOfDay),
    };
  }, [q.data, filter]);

  if (q.isPending) return <PageSpinner />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;

  const row = (n: NotificationRow) => {
    const Icon = ICON[n.kind] ?? TrendingDown;
    const body = (
      <>
        <span
          className={cn(
            'grid size-9 shrink-0 place-items-center rounded-full',
            n.kind === 'fake' || n.kind === 'warning'
              ? 'bg-rise text-rise-foreground'
              : n.kind === 'deal'
                ? 'bg-prey text-prey-foreground'
                : 'bg-secondary',
          )}
        >
          <Icon className="size-4" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-2">
            <span className={cn('truncate', !n.readAt && 'font-semibold')}>{n.title}</span>
            <span className="shrink-0 text-xs text-muted-foreground">{relative(n.createdAt)}</span>
          </span>
          <span className="line-clamp-2 text-sm wrap-anywhere text-muted-foreground">{n.body}</span>
          {n.deliveredVia?.length ? (
            <span className="mt-1 block text-[11px] text-muted-foreground">
              via {n.deliveredVia.join(', ')}
            </span>
          ) : null}
        </span>
        {!n.readAt && (
          <span
            className="mt-2 size-2 shrink-0 rounded-full bg-foreground"
            aria-label={t('common.unread')}
          />
        )}
      </>
    );
    const cls = 'flex gap-3 rounded-xl p-3 transition hover:bg-card';
    return (
      <li key={n.id}>
        {n.productId ? (
          <Link
            to={`/p/${n.productId}`}
            className={cls}
            onClick={() => !n.readAt && read.mutate([n.id])}
          >
            {body}
          </Link>
        ) : (
          <div className={cls}>{body}</div>
        )}
      </li>
    );
  };

  return (
    <div className="mx-auto grid max-w-2xl grid-cols-1 gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="font-display text-3xl font-extrabold tracking-tight">
          {t('notifications.title')}
        </h1>
        <Button
          variant="outline"
          size="sm"
          onClick={() => read.mutate(undefined)}
          disabled={!q.data.some((n) => !n.readAt)}
        >
          <CheckCheck /> {t('notifications.markRead')}
        </Button>
      </header>
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Moon className="size-4" aria-hidden /> {t('notifications.quiet')}
      </p>
      <div role="group" aria-label="Filter" className="flex flex-wrap gap-2">
        {(['all', 'deal', 'fake', 'store', 'advice'] as Filter[]).map((f) => (
          <button
            key={f}
            type="button"
            aria-pressed={filter === f}
            onClick={() => setFilter(f)}
            className={cn(
              'rounded-full border px-3.5 py-1.5 text-sm font-medium',
              filter === f ? 'border-foreground bg-foreground text-background' : 'bg-card',
            )}
          >
            {t(`notifications.kinds.${f}`)}
          </button>
        ))}
      </div>
      {q.data.length === 0 ? (
        <EmptyState
          title={t('notifications.empty')}
          action={<BellOff className="size-5 text-muted-foreground" aria-hidden />}
        />
      ) : (
        (['today', 'earlier'] as const).map(
          (g) =>
            groups[g].length > 0 && (
              <section key={g} aria-labelledby={`h-${g}`}>
                <h2 id={`h-${g}`} className="mb-1 text-sm font-medium text-muted-foreground">
                  {t(`notifications.${g}`)}
                </h2>
                <ul className="grid grid-cols-1">{groups[g].map(row)}</ul>
              </section>
            ),
        )
      )}
    </div>
  );
}
