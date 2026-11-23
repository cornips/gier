import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
  BellRing,
  Check,
  ImageOff,
  Loader2,
  Lock,
  LockOpen,
  Plus,
  Sparkles,
  X,
} from 'lucide-react';
import {
  AUTO_ADVICE_MAX_EUR,
  TIER_CAP_EUR,
  estimateMonthlyUsd,
  describeQuantity,
} from '@gier/core/browser';
import { api, imageSrc, type CreateProductInput } from '@/lib/api';
import { euro, euroPrecise, parseEuroInput } from '@/lib/format';
import type {
  AlertKind,
  BudgetTier,
  DiscoveryCandidate,
  Fingerprint,
  FingerprintProposal,
} from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Progress } from '@/components/ui/progress';
import { Switch } from '@/components/ui/switch';
import { ErrorState, PageSpinner } from '@/components/States';
import { cn } from '@/lib/utils';

type Step = 'product' | 'stores' | 'budget';
type Attr = Fingerprint['locked'][number];
const ATTRS: Attr[] = ['brand', 'line', 'form', 'quantity', 'model'];
const TIERS: BudgetTier[] = ['none', 'frugal', 'normal', 'generous'];
const DEFAULT_ALERTS: AlertKind[] = ['below', 'all_time_low', 'fake_discount', 'new_store'];
const USD_TO_EUR_ROUGH = 0.95; // display estimate only; real costs use the daily ECB rate on the server

function Steps({ step }: { step: Step }) {
  const { t } = useTranslation();
  const order: Step[] = ['product', 'stores', 'budget'];
  const at = order.indexOf(step);
  return (
    <ol className="flex items-center gap-2 text-sm" aria-label={t('wizard.stepsLabel')}>
      {order.map((s, i) => (
        <li
          key={s}
          aria-current={s === step ? 'step' : undefined}
          className="flex items-center gap-2"
        >
          <span
            className={cn(
              'grid size-7 place-items-center rounded-full border text-xs font-bold tabular',
              i < at && 'border-transparent bg-foreground text-background',
              i === at && 'border-transparent bg-prey text-prey-foreground',
            )}
          >
            {i < at ? <Check className="size-3.5" aria-hidden /> : i + 1}
          </span>
          <span className={cn('hidden sm:inline', i !== at && 'text-muted-foreground')}>
            {t(`wizard.steps.${s}`)}
          </span>
          {i < order.length - 1 && <span className="mx-1 h-px w-6 bg-border" aria-hidden />}
        </li>
      ))}
    </ol>
  );
}

export default function WizardPage() {
  const [params] = useSearchParams();
  // Web Share Target (manifest): Android shares a page as text and/or url.
  const sharedText = params.get('text') ?? '';
  const url = params.get('url') ?? sharedText.match(/https?:\/\/\S+/)?.[0] ?? null;
  const q = params.get('q') ?? params.get('title') ?? '';
  const run = Number(params.get('run')) || null;
  const productId = Number(params.get('product')) || null;
  const [state, setState] = useState<{
    step: Step;
    productId: number | null;
    runId: number | null;
  }>({
    step: run ? 'stores' : 'product',
    productId,
    runId: run,
  });

  if (url) return <FromUrl url={url} />;

  return (
    <div className="mx-auto grid max-w-3xl gap-6 pb-10">
      <Steps step={state.step} />
      {state.step === 'product' && (
        <ProductStep
          query={q}
          onCreated={(productId, runId) => setState({ step: 'stores', productId, runId })}
        />
      )}
      {state.step === 'stores' && state.runId && state.productId && (
        <StoresStep
          runId={state.runId}
          productId={state.productId}
          onNext={() => setState((s) => ({ ...s, step: 'budget' }))}
        />
      )}
      {state.step === 'budget' && state.productId && <BudgetStep productId={state.productId} />}
    </div>
  );
}

function FromUrl({ url }: { url: string }) {
  const navigate = useNavigate();
  const m = useMutation({
    mutationFn: () => api.productFromUrl(url),
    onSuccess: (r) => void navigate(`/p/${r.product.id}`, { replace: true }),
  });
  useEffect(() => {
    m.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);
  if (m.isError) return <ErrorState error={m.error} onRetry={() => m.mutate()} />;
  return <PageSpinner />;
}

/* Step 1: does Gier understand exactly which product you mean? (ADR-007) */
function ProductStep({
  query,
  onCreated,
}: {
  query: string;
  onCreated: (productId: number, runId: number) => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [search, setSearch] = useState(query);
  const proposal = useQuery({
    queryKey: ['fingerprint', search],
    queryFn: () => api.proposeFingerprint(search),
    enabled: search.length >= 2,
    staleTime: Infinity,
    retry: false,
  });
  const [draft, setDraft] = useState<{
    name: string;
    fp: Fingerprint;
    variant: string | null;
  } | null>(null);
  const [newTerm, setNewTerm] = useState('');

  useEffect(() => {
    if (proposal.data)
      setDraft({
        name: proposal.data.name,
        fp: structuredClone(proposal.data.fingerprint),
        variant: proposal.data.variants[0] ?? null,
      });
  }, [proposal.data]);

  const create = useMutation({
    mutationFn: (input: CreateProductInput) => api.createProduct(input),
    onSuccess: (r) =>
      r.runId ? onCreated(r.product.id, r.runId) : void navigate(`/p/${r.product.id}`),
    onError: (e) => toast.error(String(e)),
  });

  if (!search) {
    return <RetryQuery initial="" onSubmit={setSearch} />;
  }
  if (proposal.isPending || !draft)
    return (
      <div
        className="grid place-items-center gap-3 rounded-2xl border bg-card p-10 text-muted-foreground"
        role="status"
      >
        <Loader2 className="size-6 animate-spin" aria-hidden />
        <span className="font-medium text-foreground">{t('wizard.searching')}</span>
        <span className="max-w-xs text-center text-sm">{t('wizard.searchingHint')}</span>
      </div>
    );
  if (proposal.isError)
    return <ErrorState error={proposal.error} onRetry={() => void proposal.refetch()} />;

  const p: FingerprintProposal = proposal.data;
  const fp = draft.fp;
  const value = (a: Attr): string | null =>
    a === 'quantity'
      ? fp.quantity
        ? describeQuantity(fp.quantity)
        : null
      : ((fp[a] as string | null | undefined) ?? null);
  const toggleLock = (a: Attr) =>
    setDraft({
      ...draft,
      fp: {
        ...fp,
        locked: fp.locked.includes(a) ? fp.locked.filter((x) => x !== a) : [...fp.locked, a],
      },
    });
  const removeTerm = (term: string) =>
    setDraft({ ...draft, fp: { ...fp, exclude: fp.exclude.filter((x) => x !== term) } });
  const addTerm = () => {
    const term = newTerm.trim().toLowerCase();
    if (term.length >= 2 && !fp.exclude.includes(term))
      setDraft({ ...draft, fp: { ...fp, exclude: [...fp.exclude, term] } });
    setNewTerm('');
  };

  const submit = () => {
    const name =
      draft.variant && !draft.name.includes(draft.variant)
        ? `${draft.name} ${draft.variant}`
        : draft.name;
    create.mutate({
      name,
      query: search,
      category: p.category,
      fingerprint: { ...fp, title: name },
      aiBudgetTier: p.source === 'ai' ? 'frugal' : 'none',
      adviceMode: 'auto',
      discover: true,
      alerts: DEFAULT_ALERTS,
    });
  };

  return (
    <section className="grid gap-5" aria-labelledby="h-confirm">
      <div>
        <p className="text-sm text-muted-foreground">{t('wizard.youSearched', { q: search })}</p>
        <h1 id="h-confirm" className="font-display text-3xl font-extrabold tracking-tight">
          {t('wizard.confirmTitle')}
        </h1>
      </div>

      {p.reference && <ReferenceImage reference={p.reference} name={draft.name} />}

      <div className="grid gap-5 rounded-2xl border bg-card p-5">
        <div className="grid gap-1.5">
          <Label htmlFor="fp-name">{t('wizard.name')}</Label>
          <Input
            id="fp-name"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            className="font-display text-lg font-bold"
          />
        </div>

        {ATTRS.some((a) => value(a)) && (
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm text-muted-foreground">{t('wizard.attrsHint')}</legend>
            <div className="flex flex-wrap gap-2">
              {ATTRS.filter((a) => value(a)).map((a) => {
                const locked = fp.locked.includes(a);
                return (
                  <button
                    key={a}
                    type="button"
                    aria-pressed={locked}
                    onClick={() => toggleLock(a)}
                    className={cn(
                      'flex items-center gap-2 rounded-xl border px-3 py-2 text-left text-sm transition',
                      locked
                        ? 'border-foreground bg-foreground text-background'
                        : 'border-dashed bg-card',
                    )}
                  >
                    {locked ? (
                      <Lock className="size-3.5" aria-hidden />
                    ) : (
                      <LockOpen className="size-3.5" aria-hidden />
                    )}
                    <span className="grid leading-tight">
                      <span className="text-[11px] opacity-70">{t(`wizard.${a}`)}</span>
                      <span className="font-semibold">{value(a)}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </fieldset>
        )}

        {p.variants.length > 1 && (
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-medium">{t('wizard.variant')}</legend>
            <RadioGroup
              value={draft.variant ?? ''}
              onValueChange={(v) => setDraft({ ...draft, variant: v })}
              className="flex flex-wrap gap-2"
            >
              {p.variants.map((v) => (
                <Label
                  key={v}
                  className="flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 has-[[data-state=checked]]:border-foreground"
                >
                  <RadioGroupItem value={v} /> {v}
                </Label>
              ))}
            </RadioGroup>
          </fieldset>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <Label className="flex items-start gap-3 rounded-lg border p-3 font-normal">
            <Checkbox
              checked={fp.allowMultipack}
              onCheckedChange={(v) =>
                setDraft({ ...draft, fp: { ...fp, allowMultipack: v === true } })
              }
              className="mt-0.5"
            />
            {t('wizard.multipack')}
          </Label>
          <div className="grid gap-1.5 rounded-lg border p-3">
            <span className="text-sm">{t('wizard.compareBy')}</span>
            <RadioGroup
              value={fp.compareUnit}
              onValueChange={(v) =>
                setDraft({ ...draft, fp: { ...fp, compareUnit: v as Fingerprint['compareUnit'] } })
              }
              className="flex gap-4"
            >
              {(['piece', 'per100'] as const).map((u) => (
                <Label key={u} className="flex items-center gap-2 font-normal">
                  <RadioGroupItem value={u} /> {t(`detail.unit.${u}`)}
                </Label>
              ))}
            </RadioGroup>
          </div>
        </div>

        <div className="grid gap-2">
          <p className="text-sm text-muted-foreground">{t('wizard.learned')}</p>
          <ul className="flex flex-wrap gap-2">
            {p.alwaysExcluded.map((term) => (
              <li
                key={term}
                className="rounded-full bg-secondary px-2.5 py-1 text-xs text-muted-foreground"
              >
                {term}
              </li>
            ))}
            {fp.exclude.map((term) => (
              <li
                key={term}
                className="flex items-center gap-1 rounded-full border bg-rise py-1 pr-1 pl-2.5 text-xs text-rise-foreground"
              >
                {term}
                <button
                  type="button"
                  onClick={() => removeTerm(term)}
                  aria-label={t('common.remove', { name: term })}
                  className="rounded-full p-0.5 hover:bg-background/50"
                >
                  <X className="size-3" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              addTerm();
            }}
          >
            <Input
              value={newTerm}
              onChange={(e) => setNewTerm(e.target.value)}
              placeholder={t('wizard.exclusionPlaceholder')}
              aria-label={t('wizard.addExclusion')}
              className="h-9"
            />
            <Button type="submit" variant="outline" size="sm" className="h-9">
              <Plus /> {t('wizard.addExclusion')}
            </Button>
          </form>
        </div>

        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Sparkles className="size-3.5" aria-hidden />
          {p.source === 'ai'
            ? t('wizard.recognisedAi', { cost: euroPrecise(p.costEur) })
            : t('wizard.recognisedRules', { reason: t(`reason.${p.aiUnavailable ?? 'error'}`) })}
        </p>
      </div>

      <div className="flex flex-wrap justify-between gap-3">
        <RetryQuery initial={search} onSubmit={setSearch} compact />
        <Button size="lg" onClick={submit} disabled={create.isPending || !draft.name.trim()}>
          {create.isPending && <Loader2 className="animate-spin" />}
          {t('wizard.right')}
        </Button>
      </div>
    </section>
  );
}

function RetryQuery({
  initial,
  onSubmit,
  compact,
}: {
  initial: string;
  onSubmit: (q: string) => void;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const [v, setV] = useState(initial);
  const [open, setOpen] = useState(!compact);
  if (!open)
    return (
      <Button variant="ghost" size="lg" onClick={() => setOpen(true)}>
        {t('wizard.wrong')}
      </Button>
    );
  return (
    <form
      className="flex flex-1 gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (v.trim().length >= 2) onSubmit(v.trim());
      }}
    >
      <Input
        autoFocus
        value={v}
        onChange={(e) => setV(e.target.value)}
        placeholder={t('search.placeholder')}
        aria-label={t('search.placeholder')}
        className="h-10"
      />
      <Button type="submit" variant="outline" className="h-10">
        {t('wizard.next')}
      </Button>
    </form>
  );
}

/* Step 2: discovery runs on the server; trusted matches are followed automatically (ADR-008). */
function StoresStep({
  runId,
  productId,
  onNext,
}: {
  runId: number;
  productId: number;
  onNext: () => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const run = useQuery({
    queryKey: ['discovery', runId],
    queryFn: () => api.discovery(runId),
    refetchInterval: (q) => (q.state.data?.status === 'running' ? 1500 : false),
  });
  const [extra, setExtra] = useState<Set<string>>(new Set());
  const follow = useMutation({
    mutationFn: (c: DiscoveryCandidate) => api.addListing(productId, c.url),
    onSuccess: (_, c) => {
      setExtra((s) => new Set(s).add(c.url));
      void qc.invalidateQueries({ queryKey: ['product', productId] });
    },
    onError: (e) => toast.error(String(e)),
  });

  const groups = useMemo(() => {
    const cs = run.data?.candidates ?? [];
    return {
      trusted: cs.filter((c) => c.followed),
      doubt: cs.filter((c) => !c.followed && c.match !== 'reject' && c.trust !== 'excluded'),
      excluded: cs.filter((c) => !c.followed && (c.match === 'reject' || c.trust === 'excluded')),
    };
  }, [run.data]);

  if (run.isPending) return <PageSpinner />;
  if (run.isError) return <ErrorState error={run.error} onRetry={() => void run.refetch()} />;
  const r = run.data;
  const stages = ['search', 'extract', 'match', 'trust', 'done'] as const;
  const progress =
    ((stages.indexOf(r.stage) + (r.status === 'done' ? 1 : 0.5)) / stages.length) * 100;
  const followedCount = groups.trusted.length + extra.size;

  return (
    <section className="grid gap-5" aria-labelledby="h-stores" aria-busy={r.status === 'running'}>
      <div>
        <h1 id="h-stores" className="font-display text-3xl font-extrabold tracking-tight">
          {t('wizard.storesTitle', { count: followedCount })}
        </h1>
        <div className="mt-3 grid gap-2">
          <Progress value={progress} aria-label={t(`wizard.progress.${r.stage}`)} />
          <p className="flex flex-wrap gap-x-4 text-xs text-muted-foreground" aria-live="polite">
            {stages.map((s) => (
              <span key={s} className={cn(s === r.stage && 'font-semibold text-foreground')}>
                {t(`wizard.progress.${s}`)}
                {s === 'search' && r.stats?.results != null ? ` · ${r.stats.results}` : ''}
                {s === 'extract' && r.stats?.read != null ? ` · ${r.stats.read}` : ''}
              </span>
            ))}
          </p>
          {r.status === 'failed' && <p className="text-sm text-rise-foreground">{r.error}</p>}
        </div>
        {r.status === 'running' && (
          <div className="mt-4 flex items-start gap-3 rounded-xl border bg-secondary/40 p-3 text-sm">
            <BellRing className="mt-0.5 size-4 shrink-0" aria-hidden />
            <div className="grid gap-2">
              <p>{t('wizard.backgroundHint')}</p>
              <Button
                size="sm"
                variant="outline"
                className="justify-self-start"
                onClick={() => void navigate(`/p/${productId}`)}
              >
                {t('wizard.continueInBackground')}
              </Button>
            </div>
          </div>
        )}
      </div>

      {r.status === 'done' && (r.candidates?.length ?? 0) === 0 && (
        <p className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">
          {t('wizard.noneFound')}
        </p>
      )}

      <CandidateGroup title={t('wizard.trusted')} items={groups.trusted} tone="trusted" />
      <CandidateGroup
        title={t('wizard.doubt')}
        items={groups.doubt}
        tone="doubt"
        action={(c) =>
          extra.has(c.url) ? (
            <span className="flex items-center gap-1 text-xs font-medium">
              <Check className="size-3.5" aria-hidden /> {t('common.on')}
            </span>
          ) : (
            <Button
              size="sm"
              variant="outline"
              onClick={() => follow.mutate(c)}
              disabled={follow.isPending}
            >
              {t('wizard.followAnyway')}
            </Button>
          )
        }
      />
      <CandidateGroup
        title={t('wizard.excluded')}
        items={groups.excluded}
        tone="excluded"
        collapsed
      />

      <div className="flex justify-end">
        <Button size="lg" onClick={onNext} disabled={r.status === 'running'}>
          {r.status === 'running' && <Loader2 className="animate-spin" />}
          {t('wizard.next')}
        </Button>
      </div>
    </section>
  );
}

function CandidateGroup({
  title,
  items,
  tone,
  action,
  collapsed,
}: {
  title: string;
  items: DiscoveryCandidate[];
  tone: 'trusted' | 'doubt' | 'excluded';
  action?: (c: DiscoveryCandidate) => React.ReactNode;
  collapsed?: boolean;
}) {
  const { t } = useTranslation();
  if (!items.length) return null;
  const list = (
    <ul className="grid gap-2">
      {items.map((c) => (
        <li
          key={c.url}
          className={cn(
            'flex items-center gap-3 rounded-xl border bg-card p-3',
            tone === 'excluded' && 'opacity-70',
          )}
        >
          <span className="relative shrink-0">
            <Thumb url={c.imageUrl} className="size-12" />
            <span
              className={cn(
                'absolute -right-0.5 -bottom-0.5 size-3 rounded-full ring-2 ring-card',
                tone === 'trusted'
                  ? 'bg-prey'
                  : tone === 'doubt'
                    ? 'bg-amber-400'
                    : 'bg-destructive',
              )}
              aria-hidden
            />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-semibold">{c.storeName}</p>
            <p className="truncate text-xs text-muted-foreground" title={c.title ?? c.url}>
              {c.title ?? c.url}
            </p>
            {tone !== 'trusted' && (
              <p className="text-xs text-muted-foreground">
                {[...c.matchReasons, ...c.trustReasons].slice(0, 2).join(' · ')}
              </p>
            )}
          </div>
          <div className="text-right">
            <p className="font-display text-lg font-extrabold tabular">{euro(c.priceCents)}</p>
            {c.packCount > 1 && (
              <p className="text-xs text-muted-foreground tabular">
                {euro(c.unitPriceCents)} {t('wizard.each')}
              </p>
            )}
          </div>
          {action?.(c)}
        </li>
      ))}
    </ul>
  );
  return (
    <section className="grid gap-2">
      {collapsed ? (
        <details>
          <summary className="cursor-pointer text-sm font-medium text-muted-foreground">
            {title} ({items.length})
          </summary>
          <div className="mt-2">{list}</div>
        </details>
      ) : (
        <>
          <h2 className="text-sm font-medium">
            {title} <span className="text-muted-foreground tabular">({items.length})</span>
          </h2>
          {list}
        </>
      )}
    </section>
  );
}

/** Product picture from a shop, through Gier's image proxy. */
function Thumb({ url, className }: { url?: string | null; className?: string }) {
  const [failed, setFailed] = useState(false);
  if (!url || failed)
    return (
      <span
        className={cn('grid place-items-center rounded-lg bg-secondary', className)}
        aria-hidden
      >
        <ImageOff className="size-4 text-muted-foreground" />
      </span>
    );
  return (
    <img
      src={imageSrc(url)}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
      className={cn('rounded-lg bg-white object-contain', className)}
    />
  );
}

/** "Is this the product?": a picture from the search results, so the user can check the match. */
function ReferenceImage({
  reference,
  name,
}: {
  reference: { imageUrl: string; source: string };
  name: string;
}) {
  const { t } = useTranslation();
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  const host = (() => {
    try {
      return new URL(reference.source).hostname.replace(/^www\./, '');
    } catch {
      return reference.source;
    }
  })();
  return (
    <figure className="flex items-center gap-4 rounded-2xl border bg-card p-4">
      <img
        src={imageSrc(reference.imageUrl)}
        alt={t('wizard.referenceAlt', { name })}
        onError={() => setFailed(true)}
        className="size-28 shrink-0 rounded-xl bg-white object-contain"
      />
      <figcaption className="grid gap-1 text-sm">
        <span className="font-medium">{t('wizard.referenceTitle')}</span>
        <span className="text-muted-foreground">{t('wizard.referenceHint', { source: host })}</span>
      </figcaption>
    </figure>
  );
}

/* Step 3: AI budget per product (ADR-009) and alerts. */
function BudgetStep({ productId }: { productId: number }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const health = useQuery({ queryKey: ['health'], queryFn: api.health });
  const product = useQuery({
    queryKey: ['product', productId],
    queryFn: () => api.product(productId),
  });
  const aiAvailable = health.data?.features.ai ?? false;
  const [tier, setTier] = useState<BudgetTier>('frugal');
  const [onRequest, setOnRequest] = useState(false);
  const [target, setTarget] = useState('');
  const [alerts, setAlerts] = useState<Set<AlertKind>>(new Set(DEFAULT_ALERTS));
  useEffect(() => {
    if (health.data && !aiAvailable) setTier('none');
  }, [health.data, aiAvailable]);

  const estimateEur = Math.min(TIER_CAP_EUR[tier], estimateMonthlyUsd(tier) * USD_TO_EUR_ROUGH);
  const save = useMutation({
    mutationFn: async () => {
      const targetCents = parseEuroInput(target);
      await api.updateProduct(productId, {
        aiBudgetTier: tier,
        adviceMode: tier === 'none' ? 'off' : onRequest ? 'on_request' : 'auto',
        targetPriceCents: targetCents,
      });
      await api.setAlerts(
        productId,
        [...alerts]
          .filter((k) => k !== 'below' || targetCents)
          .map((k) => ({
            kind: k,
            active: true,
            thresholdCents: k === 'below' ? targetCents : null,
            percent: null,
          })),
      );
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['products'] });
      void navigate(`/p/${productId}`, { replace: true });
    },
    onError: (e) => toast.error(String(e)),
  });

  const toggleAlert = (k: AlertKind, on: boolean) =>
    setAlerts((s) => {
      const n = new Set(s);
      if (on) n.add(k);
      else n.delete(k);
      return n;
    });

  return (
    <section className="grid gap-5" aria-labelledby="h-budget">
      <h1 id="h-budget" className="font-display text-3xl font-extrabold tracking-tight">
        {t('wizard.budgetTitle')}
      </h1>

      <fieldset className="grid gap-3 rounded-2xl border bg-card p-5">
        <legend className="sr-only">{t('wizard.aiBudget')}</legend>
        <div>
          <p className="font-semibold">{t('wizard.aiBudget')}</p>
          <p className="text-sm text-muted-foreground">{t('wizard.aiBudgetHint')}</p>
          {!aiAvailable && health.data && (
            <p className="mt-1 text-sm text-rise-foreground">{t('reason.no_key')}</p>
          )}
        </div>
        <RadioGroup
          value={tier}
          onValueChange={(v) => setTier(v as BudgetTier)}
          className="grid grid-cols-2 gap-2 md:grid-cols-4"
        >
          {TIERS.map((tr) => (
            <Label
              key={tr}
              className={cn(
                'flex cursor-pointer flex-col items-start gap-1 rounded-xl border p-3 has-[[data-state=checked]]:border-foreground has-[[data-state=checked]]:bg-prey/30',
                !aiAvailable && tr !== 'none' && 'pointer-events-none opacity-50',
              )}
            >
              <span className="flex items-center gap-2 font-semibold">
                <RadioGroupItem value={tr} disabled={!aiAvailable && tr !== 'none'} />{' '}
                {t(`wizard.tier.${tr}`)}
              </span>
              <span className="text-xs font-normal text-muted-foreground">
                {tr === 'none'
                  ? '€ 0'
                  : t('wizard.tierCap', { cap: euroPrecise(TIER_CAP_EUR[tr]) })}
              </span>
            </Label>
          ))}
        </RadioGroup>
        <p className="rounded-lg bg-secondary p-3 text-sm">
          {tier === 'none'
            ? t('wizard.estimateNone')
            : t('wizard.estimate', { cost: euroPrecise(estimateEur) })}
        </p>
        {tier !== 'none' && (
          <Label className="flex items-center justify-between gap-3 font-normal">
            <span className="text-sm">
              {t('wizard.adviceAuto', { max: euroPrecise(AUTO_ADVICE_MAX_EUR) })}
            </span>
            <span className="flex items-center gap-2 text-sm whitespace-nowrap">
              {t('wizard.adviceRequest')}
              <Switch checked={onRequest} onCheckedChange={setOnRequest} />
            </span>
          </Label>
        )}
      </fieldset>

      <fieldset className="grid gap-3 rounded-2xl border bg-card p-5">
        <legend className="sr-only">{t('wizard.alerts')}</legend>
        <p className="font-semibold">{t('wizard.alerts')}</p>
        <div className="grid gap-1.5">
          <Label htmlFor="target">{t('wizard.target')}</Label>
          <Input
            id="target"
            inputMode="decimal"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            placeholder={
              product.data?.lowestCents ? euro(Math.round(product.data.lowestCents * 0.9)) : '€'
            }
            className="w-40 tabular"
          />
        </div>
        {(
          [
            'below',
            'all_time_low',
            'fake_discount',
            'back_in_stock',
            'new_store',
            'any_change',
          ] as AlertKind[]
        ).map((k) => (
          <Label
            key={k}
            className="flex min-h-10 items-center justify-between gap-3 border-b font-normal last:border-0"
          >
            {t(`alertKind.${k}`, { percent: 10 })}
            <Switch checked={alerts.has(k)} onCheckedChange={(v) => toggleAlert(k, v)} />
          </Label>
        ))}
      </fieldset>

      <div className="flex justify-end">
        <Button size="lg" onClick={() => save.mutate()} disabled={save.isPending}>
          {save.isPending && <Loader2 className="animate-spin" />}
          {t('wizard.start')}
        </Button>
      </div>
    </section>
  );
}
