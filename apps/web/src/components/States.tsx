import { Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ReactNode } from 'react';
import { Button } from './ui/button';
import { LogoMark } from './Logo';
import { ApiError, isAuthError, signInAgain } from '@/lib/api';

export function PageSpinner() {
  const { t } = useTranslation();
  return (
    <div role="status" className="grid min-h-[40vh] place-items-center text-muted-foreground">
      <Loader2 className="size-6 animate-spin" aria-hidden />
      <span className="sr-only">{t('common.loading')}</span>
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const { t } = useTranslation();
  if (isAuthError(error))
    return (
      <div
        role="alert"
        className="mx-auto grid max-w-md place-items-center gap-3 rounded-xl border bg-card p-8 text-center"
      >
        <p className="font-medium">{t('common.signedOut')}</p>
        <p className="text-sm text-muted-foreground">{t('common.signedOutHint')}</p>
        <Button onClick={signInAgain}>{t('common.signIn')}</Button>
      </div>
    );
  const message =
    error instanceof ApiError
      ? t(`common.errors.${error.code}`, { defaultValue: error.message })
      : error instanceof Error
        ? error.message
        : String(error);
  return (
    <div
      role="alert"
      className="mx-auto grid max-w-md place-items-center gap-3 rounded-xl border bg-card p-8 text-center"
    >
      <p className="font-medium">{t('common.error')}</p>
      <p className="text-sm text-muted-foreground">{message}</p>
      {onRetry && (
        <Button variant="outline" onClick={onRetry}>
          {t('common.retry')}
        </Button>
      )}
    </div>
  );
}

export function EmptyState({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="mx-auto grid max-w-md place-items-center gap-4 rounded-2xl border border-dashed p-10 text-center">
      <LogoMark className="size-14 opacity-90" title="" />
      <p className="font-display text-lg font-bold">{title}</p>
      {action}
    </div>
  );
}
