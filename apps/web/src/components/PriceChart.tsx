import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Area, CartesianGrid, ComposedChart, Line, ReferenceLine, XAxis, YAxis } from 'recharts';
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from './ui/chart';
import { ToggleGroup, ToggleGroupItem } from './ui/toggle-group';
import { date, euro } from '@/lib/format';
import type { ProductDetail } from '@/lib/types';

const DAY = 86_400_000;
const RANGES = { '1m': 30, '3m': 90, '1y': 365, all: Infinity } as const;
type Range = keyof typeof RANGES;
const STORE_COLORS = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
];

/** Step series: a price holds until the next observation, so sample per day with carry-forward. */
function sampleDaily(
  points: { at: string; cents: number }[],
  from: number,
  to: number,
): Map<number, number> {
  const out = new Map<number, number>();
  const sorted = [...points].sort((a, b) => a.at.localeCompare(b.at));
  let i = 0;
  let current: number | null = null;
  for (let t = Math.floor(from / DAY) * DAY; t <= to; t += DAY) {
    while (i < sorted.length && new Date(sorted[i]!.at).getTime() <= t + DAY - 1)
      current = sorted[i++]!.cents;
    if (current != null) out.set(t, current);
  }
  return out;
}

export function PriceChart({
  product,
  mode,
}: {
  product: ProductDetail;
  mode: 'lowest' | 'stores';
}) {
  const { t } = useTranslation();
  const [range, setRange] = useState<Range>('3m');

  const { data, config, keys } = useMemo(() => {
    const now = Date.now();
    const first = Math.min(now, ...product.lowestSeries.map((p) => new Date(p.at).getTime()));
    const from = Math.max(first, now - RANGES[range] * DAY);
    if (mode === 'lowest') {
      const s = sampleDaily(product.lowestSeries, from, now);
      return {
        keys: ['lowest'],
        config: {
          lowest: { label: t('overview.lowestNow'), color: 'var(--chart-1)' },
        } satisfies ChartConfig,
        data: [...s].map(([at, cents]) => ({ at, lowest: cents / 100 })),
      };
    }
    const top = product.storeSeries.slice(0, 5);
    const sampled = top.map((s) => sampleDaily(s.points, from, now));
    const days = [...new Set(sampled.flatMap((m) => [...m.keys()]))].sort((a, b) => a - b);
    const keys = top.map((_, i) => `s${i}`);
    return {
      keys,
      config: Object.fromEntries(
        top.map((s, i) => [`s${i}`, { label: s.storeName, color: STORE_COLORS[i] }]),
      ) as ChartConfig,
      data: days.map((at) => ({
        at,
        ...Object.fromEntries(
          sampled.map((m, i) => [`s${i}`, m.has(at) ? m.get(at)! / 100 : null]),
        ),
      })),
    };
  }, [product, mode, range, t]);

  const values = data.flatMap((d) =>
    keys.map((k) => (d as Record<string, number | null>)[k]).filter((v): v is number => v != null),
  );
  const target = product.targetPriceCents ? product.targetPriceCents / 100 : null;
  const min = Math.min(...values, ...(target ? [target] : []));
  const max = Math.max(...values, ...(target ? [target] : []));
  const pad = (max - min) * 0.15 || max * 0.05 || 1;

  return (
    <div className="grid gap-3">
      <ToggleGroup
        type="single"
        value={range}
        onValueChange={(v) => v && setRange(v as Range)}
        variant="outline"
        size="sm"
        className="justify-self-end"
        aria-label={t('detail.history')}
      >
        {(Object.keys(RANGES) as Range[]).map((r) => (
          <ToggleGroupItem key={r} value={r} className="px-3 text-xs">
            {t(`detail.range.${r}`)}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      {data.length < 2 ? (
        <p className="grid h-56 place-items-center rounded-xl bg-secondary/60 text-sm text-muted-foreground">
          {t('label.insufficient_history')}
        </p>
      ) : (
        <ChartContainer
          config={config}
          className="aspect-auto h-64 w-full"
          role="img"
          aria-label={t('detail.history')}
        >
          <ComposedChart data={data} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
            <CartesianGrid vertical={false} strokeDasharray="3 3" />
            <XAxis
              dataKey="at"
              type="number"
              scale="time"
              domain={['dataMin', 'dataMax']}
              tickFormatter={(v: number) =>
                date(
                  v,
                  range === '1m' || range === '3m'
                    ? { day: 'numeric', month: 'short' }
                    : { month: 'short', year: '2-digit' },
                )
              }
              tickLine={false}
              axisLine={false}
              minTickGap={32}
            />
            <YAxis
              width={56}
              domain={[Math.max(0, Math.floor(min - pad)), Math.ceil(max + pad)]}
              tickFormatter={(v: number) => euro(Math.round(v * 100))}
              tickLine={false}
              axisLine={false}
            />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  labelFormatter={(_, payload) => {
                    const at = (payload?.[0]?.payload as { at?: number } | undefined)?.at;
                    return at
                      ? date(at, {
                          weekday: 'short',
                          day: 'numeric',
                          month: 'long',
                          year: 'numeric',
                        })
                      : '';
                  }}
                  formatter={(value, name) => (
                    <div className="flex w-full justify-between gap-4">
                      <span className="text-muted-foreground">{config[String(name)]?.label}</span>
                      <span className="font-mono font-medium tabular">
                        {euro(Math.round(Number(value) * 100))}
                      </span>
                    </div>
                  )}
                />
              }
            />
            {target && (
              <ReferenceLine
                y={target}
                stroke="var(--rise-foreground)"
                strokeDasharray="4 4"
                label={{
                  value: t('detail.target', { price: euro(product.targetPriceCents) }),
                  position: 'insideTopRight',
                  fontSize: 11,
                  fill: 'var(--muted-foreground)',
                }}
              />
            )}
            {mode === 'lowest' ? (
              <Area
                dataKey="lowest"
                type="stepAfter"
                stroke="var(--color-lowest)"
                strokeWidth={2}
                fill="var(--prey)"
                fillOpacity={0.35}
                isAnimationActive={false}
              />
            ) : (
              keys.map((k) => (
                <Line
                  key={k}
                  dataKey={k}
                  type="stepAfter"
                  stroke={`var(--color-${k})`}
                  strokeWidth={2}
                  dot={false}
                  connectNulls
                  isAnimationActive={false}
                />
              ))
            )}
            {mode === 'stores' && <ChartLegend content={<ChartLegendContent />} />}
          </ComposedChart>
        </ChartContainer>
      )}
    </div>
  );
}
