import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Check, Send } from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';

/**
 * Link your own Telegram chat to the shared Gier bot (ADR-016). Gier asks the relay for a one-time
 * link; the user taps Start in Telegram, and this card notices the new link by polling.
 */
export function TelegramLink() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [pending, setPending] = useState<{ url: string; until: number; before: number } | null>(
    null,
  );
  const status = useQuery({
    queryKey: ['telegram'],
    queryFn: api.telegram,
    refetchInterval: pending ? 3000 : false,
  });
  const count = status.data?.links.length ?? 0;
  const announced = useRef(false);

  useEffect(() => {
    if (!pending) return;
    if (count > pending.before) {
      setPending(null);
      if (!announced.current) toast.success(t('settings.telegram.linkedToast'));
      announced.current = true;
    } else if (Date.now() > pending.until) setPending(null);
  }, [count, pending, t]);

  const link = useMutation({
    mutationFn: api.telegramLink,
    onSuccess: (r) => {
      announced.current = false;
      setPending({ url: r.url, until: Date.parse(r.expiresAt), before: count });
    },
    onError: () => toast.error(t('settings.telegram.failed')),
  });
  const unlink = useMutation({
    mutationFn: api.telegramUnlink,
    onSuccess: () => {
      toast.success(t('settings.telegram.unlinked'));
      void qc.invalidateQueries({ queryKey: ['telegram'] });
    },
    onError: () => toast.error(t('settings.telegram.failed')),
  });

  if (status.data?.mode !== 'relay') return null;
  const links = status.data.links;

  return (
    <div className="mt-3 grid gap-3 rounded-xl bg-secondary p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span>
          <span className="flex items-center gap-2 font-medium">
            <Send className="size-4" aria-hidden /> {t('settings.telegram.title')}
          </span>
          <span className="block text-xs text-muted-foreground">
            {links.length
              ? t('settings.telegram.linked', { count: links.length })
              : t('settings.telegram.hint')}
          </span>
        </span>
        {pending ? (
          <Button size="sm" asChild>
            <a href={pending.url} target="_blank" rel="noopener noreferrer">
              {t('settings.telegram.open')}
            </a>
          </Button>
        ) : (
          <Button size="sm" onClick={() => link.mutate()} disabled={link.isPending}>
            {t('settings.telegram.link')}
          </Button>
        )}
      </div>
      {pending && (
        <p className="text-xs text-muted-foreground" role="status">
          {t('settings.telegram.waiting')}
        </p>
      )}
      {links.length > 0 && (
        <ul className="grid gap-2">
          {links.map((l) => (
            <li key={l.id} className="flex items-center justify-between gap-3 text-sm">
              <span className="flex items-center gap-1">
                <Check className="size-4" aria-hidden />
                {new Date(l.createdAt).toLocaleDateString()}
              </span>
              <Button
                size="sm"
                variant="outline"
                onClick={() => unlink.mutate(l.id)}
                disabled={unlink.isPending}
              >
                {t('settings.telegram.unlink')}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
