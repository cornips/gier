import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useOutletContext } from 'react-router';
import { Trans, useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Bell, Check, Minus } from 'lucide-react';
import { api } from '@/lib/api';
import { currentSubscription, enablePush, isIos, isStandalone, pushSupported } from '@/lib/push';
import { useTheme, type Theme } from '@/lib/theme';
import type { Health } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { LogoMark } from '@/components/Logo';
import { TelegramLink } from '@/components/TelegramLink';
import { AppInfo } from '@/components/AppInfo';
import type { ShellContext } from '@/components/AppShell';
import {
  chooseLanguage,
  languageChoice,
  LANGUAGES,
  type Language,
  type LanguageChoice,
} from '@/i18n';

function Feature({ on, label, hint }: { on: boolean; label: string; hint: string }) {
  const { t } = useTranslation();
  return (
    <li className="flex items-center justify-between gap-3 border-b py-3 last:border-0">
      <span>
        <span className="font-medium">{label}</span>
        <span className="block text-xs text-muted-foreground">{hint}</span>
      </span>
      <span
        className={
          on
            ? 'flex items-center gap-1 text-sm font-medium'
            : 'flex items-center gap-1 text-sm text-muted-foreground'
        }
      >
        {on ? <Check className="size-4" aria-hidden /> : <Minus className="size-4" aria-hidden />}
        {on ? t('settings.configured') : t('settings.notConfigured')}
      </span>
    </li>
  );
}

const SERVICES: { key: keyof Health['features']; label: string }[] = [
  { key: 'searxng', label: 'SearXNG' },
  { key: 'brave', label: 'Brave Search API' },
  { key: 'ai', label: 'Claude Haiku' },
  { key: 'browserRun', label: 'Cloudflare Browser Run' },
];

const CHANNELS: { key: keyof Health['features']; label: string }[] = [
  { key: 'push', label: 'Web Push' },
  { key: 'telegram', label: 'Telegram' },
  { key: 'ntfy', label: 'ntfy' },
  { key: 'homeAssistant', label: 'Home Assistant' },
];

export default function SettingsPage() {
  const { openFeedback } = useOutletContext<ShellContext>();
  const { t } = useTranslation();
  const { theme, setTheme } = useTheme();
  const [langChoice, setLangChoice] = useState<LanguageChoice>(languageChoice);
  const health = useQuery({ queryKey: ['health'], queryFn: api.health });
  const [push, setPush] = useState<'on' | 'off' | 'unsupported'>('off');
  useEffect(() => {
    if (!pushSupported()) setPush('unsupported');
    else void currentSubscription().then((s) => setPush(s ? 'on' : 'off'));
  }, []);
  const enable = useMutation({
    mutationFn: enablePush,
    onSuccess: (r) => {
      if (r === 'on') setPush('on');
      else
        toast.error(
          r === 'no_key'
            ? t('settings.pushNoKey')
            : r === 'denied'
              ? t('settings.pushDenied')
              : t('settings.pushUnsupported'),
        );
    },
  });
  const test = useMutation({
    mutationFn: api.testPush,
    onSuccess: () => toast.success(t('settings.test')),
  });
  const f = health.data?.features;

  return (
    <div className="mx-auto grid max-w-2xl gap-6 pb-8">
      <h1 className="font-display text-3xl font-extrabold tracking-tight">{t('settings.title')}</h1>

      <section className="rounded-2xl border bg-card p-5" aria-labelledby="h-channels">
        <h2 id="h-channels" className="font-semibold">
          {t('settings.channels')}
        </h2>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-secondary p-3">
          <span>
            <span className="flex items-center gap-2 font-medium">
              <Bell className="size-4" aria-hidden /> {t('settings.push')}
            </span>
            {isIos() && !isStandalone() && (
              <span className="block text-xs text-muted-foreground">{t('settings.pushHint')}</span>
            )}
            {push === 'unsupported' && (
              <span className="block text-xs text-muted-foreground">
                {t('settings.pushUnsupported')}
              </span>
            )}
          </span>
          <span className="flex gap-2">
            {push === 'on' ? (
              <span className="flex items-center gap-1 text-sm font-medium">
                <Check className="size-4" aria-hidden /> {t('settings.pushOn')}
              </span>
            ) : (
              <Button
                size="sm"
                onClick={() => enable.mutate()}
                disabled={push === 'unsupported' || enable.isPending}
              >
                {t('settings.pushEnable')}
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={() => test.mutate()}
              disabled={test.isPending}
            >
              {t('settings.test')}
            </Button>
          </span>
        </div>
        <TelegramLink />
        <ul className="mt-2">
          {f &&
            CHANNELS.map((c) => (
              <Feature
                key={c.key}
                on={f[c.key]}
                label={c.label}
                hint={t(`settings.services.${c.key}`)}
              />
            ))}
        </ul>
        <p className="mt-2 text-xs text-muted-foreground">{t('notifications.quiet')}</p>
      </section>

      <section className="rounded-2xl border bg-card p-5" aria-labelledby="h-sources">
        <h2 id="h-sources" className="font-semibold">
          {t('settings.sources')}
        </h2>
        <ul className="mt-2">
          {f &&
            SERVICES.map((c) => (
              <Feature
                key={c.key}
                on={f[c.key]}
                label={c.label}
                hint={t(`settings.services.${c.key}`)}
              />
            ))}
        </ul>
      </section>

      <section className="rounded-2xl border bg-card p-5" aria-labelledby="h-interface">
        <h2 id="h-interface" className="font-semibold">
          {t('settings.interface')}
        </h2>
        {/* content-start: a long hint in one column must not stretch the other column's rows. */}
        <div className="mt-3 grid items-start gap-4 sm:grid-cols-2">
          <div className="grid content-start gap-2">
            <h3 className="text-sm font-semibold">{t('settings.theme')}</h3>
            <ToggleGroup
              type="single"
              variant="outline"
              value={theme}
              onValueChange={(v) => v && setTheme(v as Theme)}
              aria-label={t('settings.theme')}
            >
              {(['light', 'dark', 'system'] as Theme[]).map((v) => (
                <ToggleGroupItem key={v} value={v} className="px-3">
                  {t(`settings.${v}`)}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
          <div className="grid content-start gap-2">
            <h3 className="text-sm font-semibold">{t('settings.language')}</h3>
            <ToggleGroup
              type="single"
              variant="outline"
              value={langChoice}
              onValueChange={(v) => {
                if (!v) return;
                chooseLanguage(v as LanguageChoice);
                setLangChoice(v as LanguageChoice);
              }}
              aria-label={t('settings.language')}
              className="flex-wrap"
            >
              <ToggleGroupItem value="auto" className="px-3">
                {t('settings.auto')}
              </ToggleGroupItem>
              {(Object.entries(LANGUAGES) as [Language, string][]).map(([code, name]) => (
                <ToggleGroupItem key={code} value={code} lang={code} className="px-3">
                  {name}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            <p className="text-xs text-muted-foreground">
              <Trans
                i18nKey="settings.languageHint"
                components={{
                  // Not "link": the parser treats that tag name as an empty HTML element.
                  gh: (
                    <a
                      href="https://github.com/cornips/gier/blob/main/CONTRIBUTING.md#translations"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline underline-offset-4 hover:text-foreground"
                    />
                  ),
                }}
              />
            </p>
          </div>
        </div>
      </section>

      <section
        className="flex items-center gap-4 rounded-2xl border bg-card p-5"
        aria-labelledby="h-about"
      >
        <LogoMark className="size-12" title="" />
        <div>
          <h2 id="h-about" className="font-semibold">
            {t('settings.about')} · v{health.data?.version ?? '0.1.0'}
          </h2>
          <p className="text-sm text-muted-foreground">{t('app.tagline')}</p>
          <p className="text-xs text-muted-foreground">
            {t('settings.notice')} ·{' '}
            <a
              href="https://github.com/cornips/gier"
              className="underline underline-offset-4"
              target="_blank"
              rel="noopener noreferrer"
            >
              github.com/cornips/gier
            </a>
          </p>
        </div>
      </section>

      {/* Alpha: feedback and the build version, only here. Tapping the version reloads everything. */}
      <AppInfo className="flex flex-row flex-wrap items-center gap-2" onFeedback={openFeedback} />
    </div>
  );
}
