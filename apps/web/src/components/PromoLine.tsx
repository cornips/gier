import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { CreditCard, ExternalLink, Tag, ThumbsDown } from 'lucide-react';
import { promotionKey } from '@gier/core/browser';
import type { Promotion } from '@/lib/types';
import { api } from '@/lib/api';
import { euro } from '@/lib/format';
import { Button } from './ui/button';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';

/** The listing a promotion was read from: lets the user see where it came from and dismiss it. */
export interface PromoSource {
  listingId: number;
  url: string;
  storeName: string;
}

/**
 * A multi-buy deal and what one item costs with it. A card-only deal the user cannot use yet is
 * shown as a hint, so they can tick "I have this card" under Stores. With a source, the deal opens
 * where Gier read it, and the user can mark it as wrong.
 */
export function PromoLine({
  promotion,
  unitCents,
  card,
  cardUnitCents,
  source,
}: {
  promotion?: Promotion | null;
  unitCents?: number | null;
  card?: Promotion | null;
  cardUnitCents?: number | null;
  source?: PromoSource;
}) {
  const { t } = useTranslation();
  if (!promotion && !card) return null;
  return (
    <div className="grid gap-1 text-xs">
      {promotion && (
        <p className="flex gap-1.5 font-medium">
          <Tag className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>
            <Deal promotion={promotion} source={source} className="bg-prey text-prey-foreground" />{' '}
            {unitCents != null &&
              t('promo.each', { price: euro(unitCents), count: promotion.quantity })}
          </span>
        </p>
      )}
      {card && (
        <p className="flex gap-1.5 text-muted-foreground">
          <CreditCard className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>
            {t('promo.withCardPrefix')}{' '}
            <Deal promotion={card} source={source} className="bg-secondary text-foreground" />{' '}
            {cardUnitCents != null &&
              t('promo.each', { price: euro(cardUnitCents), count: card.quantity })}
          </span>
        </p>
      )}
    </div>
  );
}

function Deal({
  promotion,
  source,
  className,
}: {
  promotion: Promotion;
  source?: PromoSource;
  className: string;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const key = promotionKey(promotion);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['product'] });
    void qc.invalidateQueries({ queryKey: ['products'] });
  };
  const dismiss = useMutation({
    mutationFn: (dismissed: boolean) => api.dismissPromotion(source!.listingId, key, dismissed),
    onSuccess: (_, dismissed) => {
      refresh();
      if (dismissed)
        toast(t('promo.dismissed', { deal: promotion.text }), {
          action: { label: t('promo.undo'), onClick: () => dismiss.mutate(false) },
        });
    },
    onError: (e) => toast.error(String(e)),
  });

  const label = <span className={`rounded px-1.5 py-0.5 ${className}`}>{promotion.text}</span>;
  if (!source) return label;
  return (
    <Popover>
      <PopoverTrigger
        className="cursor-pointer rounded underline decoration-dotted underline-offset-4"
        aria-label={t('promo.where', { deal: promotion.text })}
      >
        {label}
      </PopoverTrigger>
      <PopoverContent className="grid w-80 max-w-[calc(100vw-2rem)] gap-3 text-sm">
        <p className="font-medium">{t('promo.whereTitle')}</p>
        <p className="text-muted-foreground">
          {promotion.source === 'selector'
            ? t('promo.fromSelector', { store: source.storeName })
            : t('promo.fromPage', { store: source.storeName })}
        </p>
        {promotion.context && (
          <blockquote className="border-l-2 pl-3 text-xs wrap-anywhere text-muted-foreground">
            {promotion.context}
          </blockquote>
        )}
        <a
          href={source.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-sm underline-offset-4 hover:underline"
        >
          {t('promo.check', { store: source.storeName })}{' '}
          <ExternalLink className="size-3.5" aria-hidden />
        </a>
        <div className="grid gap-1.5 border-t pt-3">
          <Button
            variant="outline"
            size="sm"
            className="justify-self-start"
            disabled={dismiss.isPending}
            onClick={() => dismiss.mutate(true)}
          >
            <ThumbsDown /> {t('promo.wrong')}
          </Button>
          <p className="text-xs text-muted-foreground">{t('promo.wrongHint')}</p>
        </div>
      </PopoverContent>
    </Popover>
  );
}
