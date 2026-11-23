import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
  ArrowLeft,
  CornerDownLeft,
  Delete,
  ExternalLink,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Plus,
  Send,
} from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import type { StoreRow, Trust } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
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
import { STORES_REVIEWED } from './Welcome';

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
/** Tapping the label: trusted ⇄ blocked; a store in doubt becomes trusted. */
const NEXT_TRUST: Record<Trust, Trust> = {
  trusted: 'blocked',
  blocked: 'trusted',
  doubt: 'trusted',
};

export default function StoresPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const stores = useQuery({ queryKey: ['stores'], queryFn: api.stores });
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const [login, setLogin] = useState<StoreRow | null>(null);
  const [adding, setAdding] = useState(false);
  const [params] = useSearchParams();
  const fromWelcome = params.get('from') === 'welcome';

  useEffect(() => {
    if (!fromWelcome) return;
    try {
      localStorage.setItem(STORES_REVIEWED, '1');
    } catch {
      /* ignore */
    }
  }, [fromWelcome]);

  const update = useMutation({
    mutationFn: ({ id, trust }: { id: number; trust: Trust }) => api.updateStore(id, { trust }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['stores'] }),
    onError: (e) => toast.error(String(e)),
  });
  const trustLabel = (s: StoreRow) => (
    <button
      type="button"
      onClick={() => update.mutate({ id: s.id, trust: NEXT_TRUST[s.trust] })}
      aria-label={t('stores.toggleTrust', {
        store: s.name,
        current: t(`stores.trust.${s.trust}`),
        next: t(`stores.trust.${NEXT_TRUST[s.trust]}`),
      })}
      className={cn(
        'rounded-full px-2.5 py-0.5 text-xs font-semibold transition hover:ring-2 hover:ring-ring/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
        TRUST_STYLE[s.trust],
      )}
    >
      {t(`stores.trust.${s.trust}`)}
    </button>
  );
  const loginState = (s: StoreRow) =>
    s.requiresLogin && (
      <span
        className={cn(
          'inline-flex items-center gap-1 text-xs',
          s.hasSession ? 'text-foreground' : 'text-rise-foreground',
        )}
      >
        <KeyRound className="size-3" aria-hidden />{' '}
        {s.hasSession ? t('stores.loggedIn') : t('stores.loginNeeded')}
      </span>
    );
  const loginButton = (s: StoreRow) =>
    s.requiresLogin && (
      <Button size="sm" variant="outline" onClick={() => setLogin(s)}>
        <KeyRound /> {t('stores.login')}
      </Button>
    );

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
      {fromWelcome && (
        <Button asChild variant="secondary" className="justify-self-start">
          <Link to="/welcome">
            <ArrowLeft /> {t('stores.backToWelcome')}
          </Link>
        </Button>
      )}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
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
          className="w-full sm:ml-auto sm:w-48"
        />
      </div>

      {/* Phones get a list; the table needs width. */}
      <ul className="grid gap-2 md:hidden">
        {list.map((s) => (
          <li key={s.id} className="grid gap-2 rounded-2xl border bg-card p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate font-semibold">{s.name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {s.domain ?? '–'} · {t(`stores.origin.${s.origin}`)}
                </p>
              </div>
              {trustLabel(s)}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              <span className="tabular">
                {t('stores.productsCount', { count: s.products })}
                {s.failCount > 0 && (
                  <span className="text-rise-foreground">
                    {' '}
                    · {t('stores.failed', { count: s.failCount })}
                  </span>
                )}
              </span>
              {loginState(s)}
            </div>
            <LoyaltyCard store={s} />
            {s.requiresLogin && <div>{loginButton(s)}</div>}
          </li>
        ))}
      </ul>

      <div className="hidden overflow-x-auto rounded-2xl border bg-card md:block">
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
                  <LoyaltyCard store={s} />
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    {trustLabel(s)}
                    {loginState(s)}
                  </div>
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
                  <div className="flex justify-end">{loginButton(s)}</div>
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

/** Store kinds that usually run a loyalty card with card-only deals. */
const CARD_STORES = ['drugstore', 'perfumery', 'supermarket', 'department', 'health', 'discounter'];

/** "I have this card": card-only multi-buy deals then count in prices and alerts. */
function LoyaltyCard({ store }: { store: StoreRow }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const checked = Boolean(store.rules?.loyaltyCard);
  const save = useMutation({
    mutationFn: (loyaltyCard: boolean) => api.updateStore(store.id, { loyaltyCard }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['stores'] });
      void qc.invalidateQueries({ queryKey: ['product'] });
      void qc.invalidateQueries({ queryKey: ['products'] });
    },
    onError: (e) => toast.error(String(e)),
  });
  if (!checked && !CARD_STORES.includes(store.category)) return null;
  return (
    <label className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
      <Checkbox
        checked={checked}
        onCheckedChange={(v) => save.mutate(v === true)}
        disabled={save.isPending}
      />
      {t('stores.loyaltyCard')}
    </label>
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

const BROWSER_RUN_ERRORS = [
  'browser_run_not_configured',
  'browser_run_rate_limited',
  'browser_run_daily_limit',
  'browser_run_unauthorized',
  'browser_run_failed',
  'login_url_outside_store',
];

/**
 * ADR-014: the user logs in inside a remote browser (Cloudflare Browser Run Live View); Gier keeps only
 * the session. Phones get no keyboard inside Live View, so text can be typed here and is relayed to the
 * field that has focus over there.
 */
function LoginDialog({ store, onClose }: { store: StoreRow; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const initialUrl =
    (store.rules?.loginUrl as string | undefined) ?? `https://www.${store.domain ?? ''}/`;
  const [loginUrl, setLoginUrl] = useState(initialUrl);
  const start = useMutation({
    mutationFn: () => api.startLogin(store.id, loginUrl !== initialUrl ? loginUrl : undefined),
  });
  const handoff = useQuery({
    queryKey: ['handoff', start.data?.id],
    queryFn: () => api.handoff(start.data!.id),
    enabled: Boolean(start.data?.id),
    refetchInterval: (q) => (q.state.data?.status === 'waiting' || !q.state.data ? 2000 : false),
  });
  const h = handoff.data ?? start.data;
  const handoffId = useRef<string | null>(null);
  handoffId.current = h?.status === 'waiting' ? h.id : null;

  useEffect(() => {
    if (h?.status === 'done') void qc.invalidateQueries({ queryKey: ['stores'] });
  }, [h?.status, qc]);
  // Closing the dialog closes the remote browser, so it stops using Browser Run time.
  useEffect(
    () => () => {
      if (handoffId.current) void api.cancelHandoff(handoffId.current);
    },
    [],
  );

  const errorCode = start.error instanceof ApiError ? start.error.code : null;
  const waiting = h?.status === 'waiting' && h.liveViewUrl;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92dvh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {t('stores.login')} · {store.name}
          </DialogTitle>
          <DialogDescription>{t('stores.loginHelp')}</DialogDescription>
        </DialogHeader>
        {!start.data && !start.isPending && (
          <form
            className="grid gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              start.mutate();
            }}
          >
            <Button type="submit" className="justify-self-start">
              <KeyRound /> {start.isError ? t('common.retry') : t('stores.login')}
            </Button>
            <details className="text-sm">
              <summary className="cursor-pointer text-muted-foreground">
                {t('stores.loginPage')}: {loginUrl.replace(/^https?:\/\//, '')}
              </summary>
              <div className="mt-2 grid gap-1.5">
                <Label htmlFor="login-url">{t('stores.loginPageEdit')}</Label>
                <Input
                  id="login-url"
                  type="url"
                  inputMode="url"
                  value={loginUrl}
                  onChange={(e) => setLoginUrl(e.target.value)}
                />
              </div>
            </details>
          </form>
        )}
        {start.isPending && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
            <Loader2 className="size-4 animate-spin" aria-hidden /> {t('stores.startingBrowser')}
          </p>
        )}
        {start.isError && (
          <p className="text-sm text-rise-foreground" role="alert">
            {errorCode && BROWSER_RUN_ERRORS.includes(errorCode)
              ? t(`stores.errors.${errorCode}`)
              : String(start.error)}
          </p>
        )}
        {waiting && (
          <div className="grid gap-3">
            <iframe
              src={h.liveViewUrl}
              title={`${store.name} login`}
              className="h-[55dvh] w-full rounded-lg border bg-white"
            />
            <RemoteKeyboard handoffId={h.id} />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p
                className="flex items-center gap-2 text-xs text-muted-foreground"
                aria-live="polite"
              >
                <Loader2 className="size-3.5 animate-spin" aria-hidden /> {t('stores.waitingLogin')}
              </p>
              <a
                href={h.liveViewUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-sm underline-offset-4 hover:underline"
              >
                {t('stores.openWindow')} <ExternalLink className="size-3.5" aria-hidden />
              </a>
            </div>
          </div>
        )}
        {h?.status === 'done' && (
          <p className="rounded-lg bg-prey/40 p-3 text-sm">{t('stores.loginDone')}</p>
        )}
        {(h?.status === 'failed' || h?.status === 'expired') && (
          <p className="text-sm text-rise-foreground" role="alert">
            {h.status === 'expired' ? t('stores.loginExpired') : (h.error ?? h.status)}
          </p>
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

/** Types into the remote browser for phones, where Live View shows no keyboard. */
function RemoteKeyboard({ handoffId }: { handoffId: string }) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const [masked, setMasked] = useState(true);
  const send = useMutation({
    mutationFn: (input: { text?: string; key?: 'Enter' | 'Tab' | 'Backspace' }) =>
      api.handoffInput(handoffId, input),
    onError: (e) => toast.error(String(e)),
  });
  const submit = (key?: 'Enter' | 'Tab') => {
    if (!text && !key) return;
    send.mutate({ text: text || undefined, key });
    setText('');
  };
  return (
    <form
      className="grid gap-2 rounded-xl border bg-secondary/40 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <Label htmlFor="remote-text" className="text-sm">
        {t('stores.remoteType')}
      </Label>
      <p className="text-xs text-muted-foreground">{t('stores.remoteTypeHint')}</p>
      <div className="flex gap-2">
        <Input
          id="remote-text"
          type={masked ? 'password' : 'text'}
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="min-w-0 flex-1"
        />
        <Button
          type="button"
          size="icon"
          variant="ghost"
          aria-pressed={!masked}
          aria-label={t('stores.remoteShow')}
          onClick={() => setMasked((m) => !m)}
        >
          {masked ? <Eye /> : <EyeOff />}
        </Button>
        <Button type="submit" size="icon" aria-label={t('stores.remoteSend')} disabled={!text}>
          <Send />
        </Button>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="outline" onClick={() => submit('Tab')}>
          {t('stores.remoteNext')}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={() => submit('Enter')}>
          <CornerDownLeft /> {t('stores.remoteEnter')}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => send.mutate({ key: 'Backspace' })}
          aria-label={t('stores.remoteBackspace')}
        >
          <Delete />
        </Button>
      </div>
    </form>
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
