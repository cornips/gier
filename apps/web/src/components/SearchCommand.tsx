import { useEffect, useMemo, useState, type RefObject } from 'react';
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

const DESKTOP = '(min-width: 48rem)';
const MIN_WIDTH = 448;

/**
 * On desktop the panel opens exactly over the visible search bar, so suggestions hang right
 * below it; without one (other screens, ⌘K) it sits top-centre. Phones get a full screen with the
 * field at the top, clear of the keyboard.
 */
function placeOver(anchor: RefObject<HTMLElement | null> | undefined) {
  return (panel: HTMLDivElement | null) => {
    if (!panel) return;
    const place = () => {
      const rect = anchor?.current?.getBoundingClientRect();
      const vars = ['--search-top', '--search-left', '--search-width', '--search-shift'];
      if (!window.matchMedia(DESKTOP).matches || !rect?.width) {
        vars.forEach((v) => panel.style.removeProperty(v));
        return;
      }
      panel.style.setProperty('--search-top', `${rect.top}px`);
      panel.style.setProperty('--search-left', `${rect.left}px`);
      panel.style.setProperty('--search-width', `${Math.max(rect.width, MIN_WIDTH)}px`);
      panel.style.setProperty('--search-shift', '0px');
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  };
}

/** One entry point (ADR-004): search tracked products, start tracking a name/EAN, or paste a URL. */
export function SearchCommand({
  open,
  onOpenChange,
  anchor,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** The search bar the panel should open over, when it is on screen. */
  anchor?: RefObject<HTMLElement | null>;
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

  const contentRef = useMemo(() => placeOver(anchor), [anchor]);

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
      contentRef={contentRef}
      className={cn(
        // Phone: full screen, field on top.
        'inset-0 flex h-dvh max-w-none translate-x-0 translate-y-0 flex-col gap-0 rounded-none border-0 pt-[env(safe-area-inset-top)] data-[state=closed]:zoom-out-100 data-[state=open]:zoom-in-100 sm:max-w-none',
        '[&>[data-slot=dialog-close]]:top-[calc(env(safe-area-inset-top)+1rem)] **:data-[slot=command-input-wrapper]:pr-10',
        // Desktop: over the search bar (see placeOver), suggestions directly below.
        'md:inset-auto md:top-[var(--search-top,1rem)] md:left-[var(--search-left,50%)] md:h-auto md:w-[var(--search-width,36rem)] md:max-w-[calc(100%-2rem)] md:translate-x-[var(--search-shift,-50%)] md:rounded-2xl md:border md:pt-0 md:[&>[data-slot=dialog-close]]:top-4',
      )}
    >
      <CommandInput
        value={q}
        onValueChange={setQ}
        placeholder={t('search.placeholder')}
        // Phone: closing the keyboard on an empty field means "never mind", so leave the full
        // screen. Not when the whole app loses focus (switching apps), nor on desktop.
        onBlur={() => {
          if (!q.trim() && document.hasFocus() && !window.matchMedia(DESKTOP).matches) {
            onOpenChange(false);
          }
        }}
        // 16px stops iOS from zooming in on focus.
        className="text-base md:text-sm"
      />
      <CommandList className="max-h-none flex-1 md:max-h-[min(60vh,26rem)] md:flex-none">
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

export function SearchTrigger({
  onClick,
  className,
  ref,
}: {
  onClick: () => void;
  className?: string;
  ref?: React.Ref<HTMLButtonElement>;
}) {
  const { t } = useTranslation();
  const mac = typeof navigator !== 'undefined' && /mac|iphone|ipad/i.test(navigator.userAgent);
  return (
    <button
      ref={ref}
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
