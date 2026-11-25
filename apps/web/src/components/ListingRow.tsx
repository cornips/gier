import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { AlertTriangle, ExternalLink, Info, Truck } from 'lucide-react';
import type { ListingView } from '@/lib/types';
import { euro, relative } from '@/lib/format';
import { findingText, isWarning } from '@/lib/findings';
import { PromoLine } from './PromoLine';
import { Switch } from './ui/switch';
import { cn } from '@/lib/utils';

/** Readable reason for a failed check; the server stores codes such as `blocked` or `http_503`. */
function errorText(t: TFunction, code: string): string {
  if (code.startsWith('seller:')) return t('detail.seller', { name: code.slice('seller:'.length) });
  const http = /^http_(\d+)$/.exec(code);
  if (http) return t('wizard.unreadReason.http', { code: http[1] });
  const key = `wizard.unreadReason.${code}`;
  return t(key, { defaultValue: code });
}

const TRUST_DOT = { trusted: 'bg-prey', doubt: 'bg-amber-400', blocked: 'bg-destructive' } as const;

export function ListingRow({
  l,
  lowest,
  compareUnit,
  onToggle,
}: {
  l: ListingView;
  lowest: boolean;
  compareUnit: 'piece' | 'per100';
  onToggle?: (active: boolean) => void;
}) {
  const { t } = useTranslation();
  const warnings = l.findings.filter(isWarning);
  const info = l.findings.filter((f) => !isWarning(f));
  // Without any observation, stock and shipping are unknown: do not show defaults.
  const observed = l.priceCents != null;
  return (
    <li
      className={cn(
        'grid min-w-0 gap-2 rounded-xl border bg-card p-3 [&>*]:min-w-0',
        lowest && 'border-foreground/40 ring-2 ring-prey',
      )}
    >
      <div className="flex items-start gap-3">
        <span
          className={cn('mt-1.5 size-2.5 shrink-0 rounded-full', TRUST_DOT[l.storeTrust])}
          aria-label={t(`stores.trust.${l.storeTrust}`)}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2">
            <span className="font-semibold">{l.storeName}</span>
            {l.packCount > 1 && (
              <span className="rounded bg-secondary px-1.5 text-xs">
                {t('detail.pack', { count: l.packCount })}
              </span>
            )}
          </div>
          <p className="truncate text-xs text-muted-foreground" title={l.title ?? l.url}>
            {l.title ?? l.url}
          </p>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {observed && (
              <>
                <span className={l.inStock === false ? 'font-medium text-rise-foreground' : ''}>
                  {l.inStock === false ? t('detail.outOfStock') : t('detail.inStock')}
                </span>
                <span className="inline-flex items-center gap-1">
                  <Truck className="size-3" aria-hidden />
                  {l.shippingCents ? euro(l.shippingCents) : t('detail.free')}
                </span>
              </>
            )}
            <span>{t('detail.checked', { when: relative(l.lastCheckedAt) })}</span>
            {l.lastError && (
              <span className="text-rise-foreground">{errorText(t, l.lastError)}</span>
            )}
          </p>
          {l.lastError === 'blocked' && !observed && (
            <p className="mt-1 text-xs text-muted-foreground">{t('detail.blockedHint')}</p>
          )}
        </div>
        <div className="text-right">
          {observed ? (
            <p className="font-display text-xl leading-tight font-extrabold tabular">
              {euro(l.priceCents)}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">{t('detail.noPriceYet')}</p>
          )}
          {(l.packCount > 1 || compareUnit === 'per100' || l.promotion) &&
            l.unitPriceCents != null && (
              <p className="text-xs text-muted-foreground tabular">
                {euro(l.unitPriceCents)} {t(`detail.unit.${compareUnit}`)}
              </p>
            )}
          {l.referenceCents && (
            <p className="text-xs text-muted-foreground line-through tabular">
              {euro(l.referenceCents)}
            </p>
          )}
        </div>
      </div>
      <PromoLine
        promotion={l.promotion}
        unitCents={l.unitPriceCents}
        card={l.cardPromotion?.promotion}
        cardUnitCents={l.cardPromotion?.unitCents}
        source={{ listingId: l.id, url: l.url, storeName: l.storeName }}
      />
      {(warnings.length > 0 || info.length > 0) && (
        <ul className="grid gap-1">
          {warnings.map((f) => (
            <li
              key={f.code}
              className="flex gap-2 rounded-lg bg-rise px-2.5 py-1.5 text-xs text-rise-foreground"
            >
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              {findingText(t, f)}
            </li>
          ))}
          {info.map((f) => (
            <li key={f.code} className="flex gap-2 px-2.5 text-xs text-muted-foreground">
              <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              {findingText(t, f)}
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-center justify-between gap-2">
        <a
          href={l.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-sm font-medium underline-offset-4 hover:underline"
        >
          {t('detail.open')} <ExternalLink className="size-3.5" aria-hidden />
        </a>
        {onToggle && (
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            {t('common.on')}
            <Switch
              defaultChecked
              onCheckedChange={onToggle}
              aria-label={t('detail.followStore', { store: l.storeName })}
            />
          </label>
        )}
      </div>
    </li>
  );
}
