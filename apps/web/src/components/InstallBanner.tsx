import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, Share, X } from 'lucide-react';
import { promptInstall, useInstall } from '@/lib/install';
import { LogoMark } from './Logo';
import { Button } from './ui/button';

const KEY = 'gier.installDismissedAt';
const QUIET_DAYS = 14;

function dismissedRecently() {
  try {
    const at = Number(localStorage.getItem(KEY) ?? 0);
    return Date.now() - at < QUIET_DAYS * 86_400_000;
  } catch {
    return false;
  }
}

/** On a phone in the browser: invite to install Gier, which iPhone needs for notifications. */
export function InstallBanner() {
  const { t } = useTranslation();
  const { platform, mobile } = useInstall();
  const [hidden, setHidden] = useState(dismissedRecently);
  if (!mobile || hidden || platform === 'installed') return null;

  const dismiss = () => {
    try {
      localStorage.setItem(KEY, String(Date.now()));
    } catch {
      /* ignore */
    }
    setHidden(true);
  };

  return (
    <aside
      aria-label={t('install.title')}
      className="mx-auto mt-4 flex max-w-6xl items-start gap-3 rounded-2xl border bg-card p-3 shadow-sm"
    >
      <LogoMark className="size-10 shrink-0" title="" />
      <div className="min-w-0 flex-1 text-sm">
        <p className="font-semibold">{t('install.title')}</p>
        <p className="text-muted-foreground">
          {platform === 'ios' ? (
            <>
              {t('install.iosBefore')}{' '}
              <Share className="inline size-4 align-text-bottom" aria-label={t('install.share')} />{' '}
              {t('install.iosAfter')}
            </>
          ) : platform === 'prompt' ? (
            t('install.prompt')
          ) : (
            t('install.manual')
          )}
        </p>
        {platform === 'prompt' && (
          <Button size="sm" className="mt-2" onClick={() => void promptInstall()}>
            <Download /> {t('install.action')}
          </Button>
        )}
      </div>
      <Button size="icon-sm" variant="ghost" onClick={dismiss} aria-label={t('install.dismiss')}>
        <X />
      </Button>
    </aside>
  );
}
