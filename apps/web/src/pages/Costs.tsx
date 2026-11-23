import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '@/lib/api';
import { date, euroPrecise } from '@/lib/format';
import { locale } from '@/i18n';
import { Progress } from '@/components/ui/progress';
import { ErrorState, PageSpinner } from '@/components/States';

const num = (n: number) => new Intl.NumberFormat(locale()).format(n);

export default function CostsPage() {
  const { t } = useTranslation();
  const q = useQuery({ queryKey: ['costs'], queryFn: api.costs });
  if (q.isPending) return <PageSpinner />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const c = q.data;
  const month = date(`${c.month}-01`, { month: 'long', year: 'numeric' });
  const share = Math.min(100, (c.aiEur / c.rules.globalCapEur) * 100);
  const braveShare = c.rules.braveCapUsd
    ? Math.min(100, (c.braveUsd / c.rules.braveCapUsd) * 100)
    : 0;

  return (
    <div className="grid grid-cols-1 gap-6">
      <header>
        <h1 className="font-display text-3xl font-extrabold tracking-tight">
          {t('costs.title', { month })}
        </h1>
        <p className="mt-1 max-w-2xl text-muted-foreground">{t('costs.intro')}</p>
      </header>

      <section className="grid gap-4 md:grid-cols-3">
        <div className="rounded-2xl border-transparent bg-prey p-5 text-prey-foreground">
          <p className="text-sm opacity-75">{t('costs.total')}</p>
          <p className="font-display text-4xl font-extrabold tabular">{euroPrecise(c.aiEur)}</p>
          <Progress
            value={share}
            className="mt-3 bg-prey-foreground/15 [&>*]:bg-prey-foreground"
            aria-label={`${share.toFixed(0)}%`}
          />
          <p className="mt-1 text-xs opacity-75">
            {t('costs.cap')} {euroPrecise(c.rules.globalCapEur)}
          </p>
        </div>
        <div className="rounded-2xl border bg-card p-5">
          <p className="text-sm text-muted-foreground">{t('costs.brave')}</p>
          <p className="font-display text-4xl font-extrabold tabular">$ {c.braveUsd.toFixed(2)}</p>
          <Progress value={braveShare} className="mt-3" aria-label={`${braveShare.toFixed(0)}%`} />
          <p className="mt-1 text-xs text-muted-foreground">
            {t('costs.cap')} $ {c.rules.braveCapUsd.toFixed(2)} ·{' '}
            {c.searches.map((s) => `${s.provider} ${s.n}×`).join(' · ') || 'SearXNG'}
          </p>
        </div>
        <div className="rounded-2xl border bg-card p-5">
          <p className="mb-2 text-sm font-semibold">{t('costs.rules')}</p>
          <ul className="grid gap-1.5 text-sm text-muted-foreground">
            <li>{t('costs.ruleAdvice', { max: euroPrecise(c.rules.autoAdviceMaxEur) })}</li>
            <li>{t('costs.ruleProduct')}</li>
            <li>{t('costs.ruleTotal', { cap: euroPrecise(c.rules.globalCapEur) })}</li>
          </ul>
        </div>
      </section>

      <section className="overflow-x-auto rounded-2xl border bg-card">
        {c.perProduct.length === 0 ? (
          <p className="p-6 text-sm text-muted-foreground">{t('costs.none')}</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">{t('costs.product')}</th>
                <th className="px-4 py-3 font-medium">{t('costs.mode')}</th>
                <th className="px-4 py-3 text-right font-medium">{t('costs.calls')}</th>
                <th className="hidden px-4 py-3 text-right font-medium md:table-cell">
                  {t('costs.tokens')}
                </th>
                <th className="px-4 py-3 text-right font-medium">{t('costs.month')}</th>
              </tr>
            </thead>
            <tbody>
              {c.perProduct.map((r) => {
                const cap = r.tier ? c.rules.tierCapsEur[r.tier] : null;
                return (
                  <tr key={r.productId ?? 'none'} className="border-b last:border-0">
                    <td className="px-4 py-3">
                      {r.productId ? (
                        <Link
                          to={`/p/${r.productId}`}
                          className="font-medium underline-offset-4 hover:underline"
                        >
                          {r.name}
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">{t('costs.general')}</span>
                      )}
                      {r.tier && (
                        <p className="text-xs text-muted-foreground">
                          {t(`wizard.tier.${r.tier}`)}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {r.adviceMode ? t(`detail.adviceMode.${r.adviceMode}`) : '–'}
                    </td>
                    <td className="px-4 py-3 text-right tabular">{r.calls}</td>
                    <td className="hidden px-4 py-3 text-right text-muted-foreground tabular md:table-cell">
                      {num(r.inputTokens)} / {num(r.outputTokens)}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold tabular">
                      {euroPrecise(r.eur)}
                      {cap ? (
                        <span className="block text-xs font-normal text-muted-foreground">
                          / {euroPrecise(cap)}
                        </span>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
