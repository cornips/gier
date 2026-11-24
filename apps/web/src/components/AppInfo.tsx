import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { MessageSquare, RefreshCw } from 'lucide-react';
import { api } from '@/lib/api';
import { BUILD_LABEL, COMMIT, hardRefresh } from '@/lib/build';
import { Button } from './ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import { Label } from './ui/label';
import { RadioGroup, RadioGroupItem } from './ui/radio-group';
import { Textarea } from './ui/textarea';
import { cn } from '@/lib/utils';

const KINDS = ['bug', 'idea', 'question', 'other'] as const;

/**
 * Bottom of the menu during the alpha: "Send feedback" and the version of this build. Tapping the
 * version reloads everything from the server. A dot marks a newer version on the server.
 */
export function AppInfo({
  className,
  onFeedback,
}: {
  className?: string;
  /** Opens the feedback dialog; it lives in the shell so closing the menu does not close it. */
  onFeedback: () => void;
}) {
  const { t } = useTranslation();
  const health = useQuery({ queryKey: ['health'], queryFn: api.health, staleTime: 5 * 60_000 });
  const serverCommit = health.data?.commit ?? null;
  const outdated = Boolean(COMMIT && serverCommit && COMMIT !== serverCommit);
  return (
    <div className={cn('grid gap-1 text-sm', className)}>
      {health.data?.features.feedback && (
        <button
          type="button"
          onClick={onFeedback}
          className="flex items-center gap-3 rounded-lg px-3 py-3 text-left font-medium hover:bg-accent"
        >
          <MessageSquare className="size-4" aria-hidden />
          {t('feedback.open')}
        </button>
      )}
      <button
        type="button"
        onClick={() => void hardRefresh()}
        className="flex items-center gap-3 rounded-lg px-3 py-2 text-left text-xs text-muted-foreground hover:bg-accent"
        title={t('build.refreshHint')}
      >
        <RefreshCw className="size-3.5" aria-hidden />
        <span className="tabular">
          {t('build.version', { version: BUILD_LABEL })}
          {outdated && (
            <span className="ml-2 rounded bg-prey px-1.5 text-prey-foreground">
              {t('build.update')}
            </span>
          )}
        </span>
      </button>
    </div>
  );
}

export function FeedbackDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t, i18n } = useTranslation();
  const [kind, setKind] = useState<(typeof KINDS)[number]>('bug');
  const [message, setMessage] = useState('');
  const send = useMutation({
    mutationFn: () =>
      api.sendFeedback({
        kind,
        message: message.trim(),
        lang: i18n.language.startsWith('nl') ? 'nl' : 'en',
        context: {
          app: BUILD_LABEL,
          page: window.location.pathname + window.location.search,
          screen: `${window.innerWidth}×${window.innerHeight} @${window.devicePixelRatio}x`,
          display: window.matchMedia('(display-mode: standalone)').matches
            ? 'installed app'
            : 'browser',
          browser: navigator.userAgent.slice(0, 300),
        },
      }),
    onSuccess: () => {
      toast.success(t('feedback.thanks'));
      setMessage('');
      onOpenChange(false);
    },
    onError: (e) =>
      toast.error(
        String(e).includes('too_many_requests') ? t('feedback.tooMany') : t('feedback.failed'),
      ),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('feedback.title')}</DialogTitle>
          <DialogDescription>{t('feedback.hint')}</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (message.trim().length >= 3) send.mutate();
          }}
        >
          <RadioGroup
            value={kind}
            onValueChange={(v) => setKind(v as (typeof KINDS)[number])}
            className="grid grid-cols-2 gap-2"
            aria-label={t('feedback.kind')}
          >
            {KINDS.map((k) => (
              <Label
                key={k}
                className="flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2.5 font-normal has-[[data-state=checked]]:border-foreground"
              >
                <RadioGroupItem value={k} />
                {t(`feedback.kinds.${k}`)}
              </Label>
            ))}
          </RadioGroup>
          <Textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            maxLength={2000}
            rows={5}
            required
            placeholder={t('feedback.placeholder')}
            aria-label={t('feedback.message')}
          />
          <p className="text-xs text-muted-foreground">{t('feedback.privacy')}</p>
          <DialogFooter>
            <Button type="submit" disabled={message.trim().length < 3 || send.isPending}>
              {t('feedback.send')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
