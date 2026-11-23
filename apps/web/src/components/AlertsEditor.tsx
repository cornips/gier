import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { AlertKind, ProductDetail } from '@/lib/types';
import { api } from '@/lib/api';
import { euro, parseEuroInput } from '@/lib/format';
import { locale } from '@/i18n';
import { Switch } from './ui/switch';
import { Input } from './ui/input';
import { Button } from './ui/button';

const KINDS: AlertKind[] = [
  'below',
  'drop_percent',
  'all_time_low',
  'fake_discount',
  'back_in_stock',
  'new_store',
  'any_change',
];

interface Draft {
  active: Record<AlertKind, boolean>;
  target: string;
  percent: string;
}

function draftFrom(p: ProductDetail): Draft {
  const active = Object.fromEntries(
    KINDS.map((k) => [k, p.alertRules.some((r) => r.kind === k && r.active)]),
  ) as Record<AlertKind, boolean>;
  const below = p.alertRules.find((r) => r.kind === 'below');
  const drop = p.alertRules.find((r) => r.kind === 'drop_percent');
  const target = below?.thresholdCents ?? p.targetPriceCents;
  return {
    active,
    target: target
      ? new Intl.NumberFormat(locale(), { minimumFractionDigits: 2, useGrouping: false }).format(
          target / 100,
        )
      : '',
    percent: String(drop?.percent ?? 10),
  };
}

export function AlertsEditor({ product }: { product: ProductDetail }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [draft, setDraft] = useState(() => draftFrom(product));
  useEffect(() => setDraft(draftFrom(product)), [product]);

  const save = useMutation({
    mutationFn: async () => {
      const target = parseEuroInput(draft.target);
      const percent = Number(draft.percent.replace(',', '.'));
      await api.setAlerts(
        product.id,
        KINDS.filter((k) => k !== 'below' || target).map((k) => ({
          kind: k,
          active: draft.active[k],
          thresholdCents: k === 'below' ? target : null,
          percent: k === 'drop_percent' && percent > 0 ? percent : null,
        })),
      );
      if (target !== product.targetPriceCents)
        await api.updateProduct(product.id, { targetPriceCents: target });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['product', product.id] });
      toast.success(t('common.save'));
    },
    onError: (e) => toast.error(String(e)),
  });

  const set = (k: AlertKind, v: boolean) =>
    setDraft((d) => ({ ...d, active: { ...d.active, [k]: v } }));

  return (
    <form
      className="grid gap-1"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      {KINDS.map((k) => (
        <div
          key={k}
          className="flex min-h-11 items-center justify-between gap-3 border-b py-1.5 last:border-0"
        >
          <label htmlFor={`alert-${k}`} className="flex flex-1 items-center gap-2 text-sm">
            {t(`alertKind.${k}`, { percent: draft.percent })}
          </label>
          {k === 'below' && (
            <Input
              aria-label={t('wizard.target')}
              inputMode="decimal"
              placeholder={product.lowestCents ? euro(Math.round(product.lowestCents * 0.9)) : '€'}
              value={draft.target}
              onChange={(e) => setDraft((d) => ({ ...d, target: e.target.value }))}
              className="h-8 w-24 text-right tabular"
            />
          )}
          {k === 'drop_percent' && (
            <Input
              aria-label="%"
              inputMode="decimal"
              value={draft.percent}
              onChange={(e) => setDraft((d) => ({ ...d, percent: e.target.value }))}
              className="h-8 w-16 text-right tabular"
            />
          )}
          <Switch id={`alert-${k}`} checked={draft.active[k]} onCheckedChange={(v) => set(k, v)} />
        </div>
      ))}
      <Button
        type="submit"
        size="sm"
        variant="outline"
        className="mt-2 justify-self-end"
        disabled={save.isPending}
      >
        {t('common.save')}
      </Button>
    </form>
  );
}
