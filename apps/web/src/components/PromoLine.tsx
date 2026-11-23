import { useTranslation } from 'react-i18next';
import { CreditCard, Tag } from 'lucide-react';
import type { Promotion } from '@/lib/types';
import { euro } from '@/lib/format';

/**
 * A multi-buy deal and what one item costs with it. A card-only deal the user cannot use yet is
 * shown as a hint, so they can tick "I have this card" under Stores.
 */
export function PromoLine({
  promotion,
  unitCents,
  card,
  cardUnitCents,
}: {
  promotion?: Promotion | null;
  unitCents?: number | null;
  card?: Promotion | null;
  cardUnitCents?: number | null;
}) {
  const { t } = useTranslation();
  if (!promotion && !card) return null;
  return (
    <div className="grid gap-1 text-xs">
      {promotion && (
        <p className="flex gap-1.5 font-medium">
          <Tag className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>
            <span className="rounded bg-prey px-1.5 py-0.5 text-prey-foreground">
              {promotion.text}
            </span>{' '}
            {unitCents != null &&
              t('promo.each', { price: euro(unitCents), count: promotion.quantity })}
          </span>
        </p>
      )}
      {card && (
        <p className="flex gap-1.5 text-muted-foreground">
          <CreditCard className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>
            {t('promo.withCard', {
              deal: card.text,
              price: cardUnitCents != null ? euro(cardUnitCents) : '',
            })}
          </span>
        </p>
      )}
    </div>
  );
}
