import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link2, Plus, Search } from 'lucide-react';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from './ui/command';
import { api } from '@/lib/api';
import { isUrl } from '@/lib/format';
import { cn } from '@/lib/utils';

function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

/** One entry point (ADR-004): search tracked products, start tracking a name/EAN, or paste a URL. */
export function SearchCommand({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const query = useDebounced(q.trim(), 150);
  const url = isUrl(query);
  const followed = useQuery({
    queryKey: ['search', query],
    queryFn: () => api.search(query),
    enabled: open && query.length >= 2 && !url,
  });

  useEffect(() => {
    if (!open) setQ('');
  }, [open]);

  const go = (to: string, state?: unknown) => {
    onOpenChange(false);
    void navigate(to, { state });
  };

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('search.placeholder')}
      description={t('search.followHint')}
      shouldFilter={false}
    >
      <CommandInput value={q} onValueChange={setQ} placeholder={t('search.placeholder')} />
      <CommandList>
        {query.length < 2 && <CommandEmpty>{t('search.empty')}</CommandEmpty>}
        {!!followed.data?.followed.length && (
          <CommandGroup heading={t('search.followed')}>
            {followed.data.followed.map((p) => (
              <CommandItem key={p.id} value={`p-${p.id}`} onSelect={() => go(`/p/${p.id}`)}>
                <Search aria-hidden />
                {p.name}
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {query.length >= 2 && (
          <CommandGroup heading={t('search.new')}>
            {url ? (
              <CommandItem
                value="url"
                onSelect={() => go(`/track?url=${encodeURIComponent(query)}`)}
              >
                <Link2 aria-hidden />
                <span className="truncate">{t('search.url')}</span>
              </CommandItem>
            ) : (
              <CommandItem
                value="follow"
                onSelect={() => go(`/track?q=${encodeURIComponent(query)}`)}
              >
                <Plus aria-hidden />
                <span className="flex flex-col">
                  <span>{t('search.follow', { q: query })}</span>
                  <span className="text-xs text-muted-foreground">{t('search.followHint')}</span>
                </span>
              </CommandItem>
            )}
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  );
}

export function SearchTrigger({ onClick, className }: { onClick: () => void; className?: string }) {
  const { t } = useTranslation();
  const mac = typeof navigator !== 'undefined' && /mac|iphone|ipad/i.test(navigator.userAgent);
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex h-11 w-full items-center gap-3 rounded-full border bg-card px-4 text-left text-sm text-muted-foreground shadow-sm transition hover:border-foreground/30',
        className,
      )}
    >
      <Search className="size-4 text-foreground" aria-hidden />
      <span className="flex-1 truncate">
        <span className="hidden sm:inline">{t('search.placeholder')}</span>
        <span className="sm:hidden">{t('search.short')}</span>
      </span>
      <kbd className="hidden rounded border bg-muted px-1.5 font-mono text-[11px] md:inline">
        {mac ? '⌘' : 'Ctrl'} K
      </kbd>
    </button>
  );
}
