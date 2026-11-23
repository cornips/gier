import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { ExternalLink, KeyRound, Loader2, Plus, ShieldCheck, ShieldOff } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import type { StoreRow, Trust } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ErrorState, PageSpinner } from '@/components/States';
import { cn } from '@/lib/utils';

type Filter = 'all' | 'fixed' | 'learned' | 'doubt' | 'blocked';
const FILTERS: Record<Filter, (s: StoreRow) => boolean> = {
  all: () => true,
  fixed: (s) => s.isFixed,
  learned: (s) => s.origin === 'learned' && s.trust === 'trusted',
  doubt: (s) => s.trust === 'doubt',
  blocked: (s) => s.trust === 'blocked',
};
const TRUST_STYLE: Record<Trust, string> = {
  trusted: 'bg-prey/50',
  doubt: 'bg-amber-200 text-amber-950',
  blocked: 'bg-rise text-rise-foreground',
};

export default function StoresPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const stores = useQuery({ queryKey: ['stores'], queryFn: api.stores });
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const [login, setLogin] = useState<StoreRow | null>(null);
  const [adding, setAdding] = useState(false);

  const update = useMutation({
    mutationFn: ({ id, trust }: { id: number; trust: Trust }) => api.updateStore(id, { trust }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['stores'] }),
  });

  const list = useMemo(
    () =>
      (stores.data ?? [])
        .filter(FILTERS[filter])
        .filter((s) => !q || `${s.name} ${s.domain}`.toLowerCase().includes(q.toLowerCase())),
    [stores.data, filter, q],
  );

  if (stores.isPending) return <PageSpinner />;
  if (stores.isError)
    return <ErrorState error={stores.error} onRetry={() => void stores.refetch()} />;

  return (
    <div className="grid grid-cols-1 gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-extrabold tracking-tight">
            {t('stores.title')}
          </h1>
          <p className="mt-1 max-w-2xl text-muted-foreground">{t('stores.intro')}</p>
        </div>
        <Button onClick={() => setAdding(true)}>
          <Plus /> {t('stores.add')}
        </Button>
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <div role="group" aria-label="Filter" className="flex flex-wrap gap-2">
          {(Object.keys(FILTERS) as Filter[]).map((f) => (
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
              {t(`stores.${f}`)}{' '}
              <span className="text-xs tabular opacity-70">
                {stores.data.filter(FILTERS[f]).length}
              </span>
            </button>
          ))}
        </div>
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Filter…"
          aria-label={t('stores.filterLabel')}
          className="ml-auto w-48"
        />
      </div>

      <div className="overflow-x-auto rounded-2xl border bg-card">
        <table className="w-full text-sm">
          <thead className="border-b text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">{t('stores.store')}</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 text-right font-medium">{t('stores.products')}</th>
              <th className="hidden px-4 py-3 font-medium md:table-cell">
                {t('stores.extraction')}
              </th>
              <th className="hidden px-4 py-3 font-medium md:table-cell">{t('stores.health')}</th>
              <th
                className="hidden px-4 py-3 font-medium lg:table-cell"
                title={t('stores.preferenceHint')}
              >
                {t('stores.preference')}
              </th>
              <th className="px-4 py-3">
                <span className="sr-only">{t('common.actions')}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {list.map((s) => (
              <tr key={s.id} className="border-b last:border-0">
                <td className="px-4 py-3">
                  <p className="font-semibold">{s.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {s.domain} · {t(`stores.origin.${s.origin}`)}
                  </p>
                </td>
                <td className="px-4 py-3">
                  <span
                    className={cn(
                      'rounded-full px-2.5 py-0.5 text-xs font-semibold',
                      TRUST_STYLE[s.trust],
                    )}
                  >
                    {t(`stores.trust.${s.trust}`)}
                  </span>
                  {s.requiresLogin && (
                    <span
                      className={cn(
                        'ml-2 inline-flex items-center gap-1 text-xs',
                        s.hasSession ? 'text-foreground' : 'text-rise-foreground',
                      )}
                    >
                      <KeyRound className="size-3" aria-hidden />{' '}
                      {s.hasSession ? t('stores.loggedIn') : t('stores.loginNeeded')}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-right tabular">{s.products}</td>
                <td className="hidden px-4 py-3 text-muted-foreground md:table-cell">
                  {s.extraction}
                </td>
                <td className="hidden px-4 py-3 md:table-cell">
                  {s.failCount > 0 ? (
                    <span className="text-rise-foreground">
                      {t('stores.failed', { count: s.failCount })}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">{t('stores.ok')}</span>
                  )}
                </td>
                <td className="hidden px-4 py-3 lg:table-cell">
                  <PreferenceInput store={s} />
                </td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-1">
                    {s.requiresLogin && (
                      <Button size="sm" variant="outline" onClick={() => setLogin(s)}>
                        <KeyRound /> {t('stores.login')}
                      </Button>
                    )}
                    {s.trust !== 'trusted' && (
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={`${t('stores.trustIt')} ${s.name}`}
                        onClick={() => update.mutate({ id: s.id, trust: 'trusted' })}
                      >
                        <ShieldCheck />
                      </Button>
                    )}
                    {s.trust !== 'blocked' && (
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={`${t('stores.block')} ${s.name}`}
                        onClick={() => update.mutate({ id: s.id, trust: 'blocked' })}
                      >
                        <ShieldOff />
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {login && <LoginDialog store={login} onClose={() => setLogin(null)} />}
      <AddStoreDialog open={adding} onClose={() => setAdding(false)} />
    </div>
  );
}

/**
 * ADR-013: a store can be made "less preferred": it only counts as cheapest when it beats the next store
 * by this percentage. Amazon.nl starts at 5% because of its business practices; anyone can change it.
 */
function PreferenceInput({ store }: { store: StoreRow }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const initial = Number(store.rules?.preferenceThresholdPct ?? 0);
  const [value, setValue] = useState(String(initial));
  const save = useMutation({
    mutationFn: (pct: number) => api.updateStore(store.id, { preferenceThresholdPct: pct }),
    onSuccess: () => {
      toast.success(t('stores.preferenceSaved'));
      void qc.invalidateQueries({ queryKey: ['stores'] });
    },
    onError: (e) => toast.error(String(e)),
  });
  const commit = () => {
    const pct = Math.min(50, Math.max(0, Number(value.replace(',', '.')) || 0));
    setValue(String(pct));
    if (pct !== initial) save.mutate(pct);
  };
  return (
    <label
      className="flex items-center gap-1 text-xs text-muted-foreground"
      title={t('stores.preferenceHint')}
    >
      <Input
        inputMode="decimal"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && commit()}
        aria-label={`${t('stores.preference')} ${store.name}`}
        className="h-8 w-14 text-right tabular"
      />
      %
    </label>
  );
}

/** ADR-014: the user logs in inside a remote browser (Cloudflare Browser Run Live View); Gier keeps only the session. */
function LoginDialog({ store, onClose }: { store: StoreRow; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const start = useMutation({ mutationFn: () => api.startLogin(store.id) });
  const handoff = useQuery({
    queryKey: ['handoff', start.data?.id],
    queryFn: () => api.handoff(start.data!.id),
    enabled: Boolean(start.data?.id),
    refetchInterval: (q) => (q.state.data?.status === 'waiting' || !q.state.data ? 2000 : false),
  });
  const h = handoff.data ?? start.data;
  useEffect(() => {
    if (h?.status === 'done') void qc.invalidateQueries({ queryKey: ['stores'] });
  }, [h?.status, qc]);
  const errorCode = start.error instanceof ApiError ? start.error.code : null;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {t('stores.login')} · {store.name}
          </DialogTitle>
          <DialogDescription>{t('stores.loginHelp')}</DialogDescription>
        </DialogHeader>
        {!start.data && !start.isPending && !start.isError && (
          <Button onClick={() => start.mutate()} className="justify-self-start">
            <KeyRound /> {t('stores.login')}
          </Button>
        )}
        {start.isPending && <PageSpinner />}
        {start.isError && (
          <p className="text-sm text-rise-foreground">
            {errorCode === 'browser_run_not_configured'
              ? t('stores.browserRunMissing')
              : String(start.error)}
          </p>
        )}
        {h?.status === 'waiting' && h.liveViewUrl && (
          <div className="grid gap-2">
            <iframe
              src={h.liveViewUrl}
              title={`${store.name} login`}
              className="h-[60vh] w-full rounded-lg border bg-white"
            />
            <a
              href={h.liveViewUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-sm underline-offset-4 hover:underline"
            >
              {t('stores.openWindow')} <ExternalLink className="size-3.5" aria-hidden />
            </a>
            <p className="flex items-center gap-2 text-xs text-muted-foreground" aria-live="polite">
              <Loader2 className="size-3.5 animate-spin" aria-hidden /> {t('stores.waitingLogin')}
            </p>
          </div>
        )}
        {h?.status === 'done' && (
          <p className="rounded-lg bg-prey/40 p-3 text-sm">{t('stores.loginDone')}</p>
        )}
        {(h?.status === 'failed' || h?.status === 'expired') && (
          <p className="text-sm text-rise-foreground">{h.error ?? h.status}</p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('detail.close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddStoreDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [url, setUrl] = useState('https://');
  const add = useMutation({
    mutationFn: () => api.addStore(name.trim(), url.trim()),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['stores'] });
      toast.success(name);
      setName('');
      setUrl('https://');
      onClose();
    },
    onError: (e) => toast.error(String(e)),
  });
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('stores.add')}</DialogTitle>
          <DialogDescription>{t('stores.intro')}</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            add.mutate();
          }}
        >
          <div className="grid gap-1.5">
            <Label htmlFor="store-name">{t('stores.addName')}</Label>
            <Input
              id="store-name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="store-url">{t('stores.addUrl')}</Label>
            <Input
              id="store-url"
              required
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={add.isPending}>
              {t('common.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
