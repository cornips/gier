import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Bell, Check, Download, Share, Store } from 'lucide-react';
import { api } from '@/lib/api';
import { promptInstall, useInstall } from '@/lib/install';
import { enablePush, pushSupported } from '@/lib/push';
import { LogoMark } from '@/components/Logo';
import { Button } from '@/components/ui/button';

export const STORES_REVIEWED = 'gier.storesReviewed';

const storesReviewed = () => {
  try {
    return localStorage.getItem(STORES_REVIEWED) === '1';
  } catch {
    return false;
  }
};

/** First run on a phone: install, notifications, known stores, first product. */
export default function WelcomePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const stores = useQuery({ queryKey: ['stores'], queryFn: api.stores });
  const { platform } = useInstall();
  const [push, setPush] = useState<string | null>(() =>
    pushSupported() && Notification.permission === 'granted' ? 'on' : null,
  );
  const fixed = stores.data?.filter((s) => s.isFixed) ?? [];
  const finish = (to: string) => {
    try {
      localStorage.setItem('gier.welcomed', '1');
    } catch {
      /* ignore */
    }
    void navigate(to);
  };

  const steps = [
    {
      icon: platform === 'prompt' ? Download : Share,
      title: t('welcome.install'),
      hint:
        platform === 'ios'
          ? t('welcome.installIos')
          : platform === 'manual'
            ? t('install.manual')
            : t('welcome.installHint'),
      done: platform === 'installed',
      action: platform === 'prompt' && (
        <Button size="sm" variant="outline" onClick={() => void promptInstall()}>
          {t('install.action')}
        </Button>
      ),
    },
    {
      icon: Bell,
      title: t('welcome.push'),
      hint: t('welcome.pushHint'),
      done: push === 'on',
      action: pushSupported() && push !== 'on' && (
        <Button size="sm" variant="outline" onClick={() => void enablePush().then(setPush)}>
          {t('settings.pushEnable')}
        </Button>
      ),
    },
    {
      icon: Store,
      title: t('welcome.stores'),
      hint: fixed.length
        ? `${fixed
            .slice(0, 6)
            .map((s) => s.name)
            .join(', ')}${fixed.length > 6 ? ` +${fixed.length - 6}` : ''}`
        : t('welcome.storesHint'),
      done: storesReviewed(),
      action: (
        <Button size="sm" variant="ghost" asChild>
          <Link to="/stores?from=welcome">{t('welcome.storesReview')}</Link>
        </Button>
      ),
    },
  ];

  return (
    <main className="mx-auto grid min-h-dvh max-w-md grid-cols-1 content-between gap-8 px-5 pt-[calc(env(safe-area-inset-top)+3rem)] pb-[calc(env(safe-area-inset-bottom)+2rem)]">
      <div className="grid grid-cols-1 gap-6">
        <LogoMark className="size-16" />
        <h1 className="font-display text-4xl leading-[1.05] font-extrabold tracking-tight">
          {t('welcome.title')}
        </h1>
        <p className="text-lg text-muted-foreground">{t('welcome.intro')}</p>
        <ol className="grid grid-cols-1 gap-3">
          {steps.map(({ icon: Icon, title, hint, done, action }) => (
            <li key={title} className="flex items-center gap-3 rounded-2xl border bg-card p-4">
              <span
                className={
                  done
                    ? 'grid size-10 place-items-center rounded-full bg-prey'
                    : 'grid size-10 place-items-center rounded-full bg-secondary'
                }
              >
                {done ? (
                  <Check className="size-5" aria-hidden />
                ) : (
                  <Icon className="size-5" aria-hidden />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">{title}</span>
                <span className="line-clamp-2 block text-sm text-muted-foreground">{hint}</span>
              </span>
              {action}
            </li>
          ))}
        </ol>
      </div>
      <div className="grid gap-2">
        <Button size="lg" className="h-12 text-base" onClick={() => finish('/track')}>
          {t('welcome.first')}
        </Button>
        <Button size="lg" variant="ghost" onClick={() => finish('/')}>
          {t('welcome.later')}
        </Button>
      </div>
    </main>
  );
}
