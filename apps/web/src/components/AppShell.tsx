import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Bell, Coins, Menu, Settings, Store } from 'lucide-react';
import { AppInfo, FeedbackDialog } from './AppInfo';
import { ErrorBoundary } from './ErrorBoundary';
import { InstallBanner } from './InstallBanner';
import { PageSpinner } from './States';
import { Wordmark } from './Logo';
import { SearchCommand, SearchTrigger } from './SearchCommand';
import { Button } from './ui/button';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from './ui/sheet';
import { api } from '@/lib/api';
import { useMediaQuery, WIDE } from '@/lib/media';
import { cn } from '@/lib/utils';

const NAV = [
  { to: '/stores', key: 'stores', icon: Store },
  { to: '/costs', key: 'costs', icon: Coins },
  { to: '/settings', key: 'settings', icon: Settings },
] as const;

const Notifications = lazy(() =>
  import('@/pages/Notifications').then((m) => ({ default: m.Notifications })),
);

export function AppShell() {
  const { t } = useTranslation();
  const [searchOpen, setSearchOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const wide = useMediaQuery(WIDE);
  const searchBar = useRef<HTMLButtonElement>(null);
  const openFeedback = () => {
    setMenuOpen(false);
    setFeedbackOpen(true);
  };
  const notifications = useQuery({
    queryKey: ['notifications'],
    queryFn: api.notifications,
    refetchInterval: 60_000,
  });
  const unread = notifications.data?.filter((n) => !n.readAt).length ?? 0;
  // The search bar belongs to the products screen; elsewhere it is in the way. ⌘K and / still work.
  const showSearch = useLocation().pathname === '/';

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen((o) => !o);
      }
      if (
        e.key === '/' &&
        !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)
      ) {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // The bell opens the notifications in a panel below it; the same bell closes it again.
  const bell = (
    <Popover open={notificationsOpen} onOpenChange={setNotificationsOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label={unread ? `${t('nav.notifications')} (${unread})` : t('nav.notifications')}
        >
          <Bell />
          {unread > 0 && (
            <span className="absolute -top-0.5 -right-0.5 grid min-w-4 place-items-center rounded-full bg-prey px-1 text-[10px] font-bold text-prey-foreground tabular">
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        collisionPadding={16}
        aria-label={t('nav.notifications')}
        className="max-h-[min(var(--radix-popover-content-available-height),40rem)] w-[min(28rem,calc(100vw-2rem))] overflow-y-auto overscroll-contain rounded-2xl p-4"
      >
        <Suspense fallback={<PageSpinner />}>
          <Notifications panel onOpen={() => setNotificationsOpen(false)} />
        </Suspense>
      </PopoverContent>
    </Popover>
  );

  return (
    <div
      className={cn(
        'min-h-dvh md:pb-10',
        showSearch
          ? 'pb-[calc(env(safe-area-inset-bottom)+5.5rem)]'
          : 'pb-[calc(env(safe-area-inset-bottom)+1.5rem)]',
      )}
    >
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded focus:bg-card focus:px-3 focus:py-2"
      >
        {t('common.skip')}
      </a>
      <header className="sticky top-0 z-30 border-b bg-background/85 pt-[env(safe-area-inset-top)] backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4">
          <Link to="/" aria-label={t('nav.home')} className="rounded-md">
            <Wordmark />
          </Link>
          {showSearch && (
            <SearchTrigger
              ref={searchBar}
              onClick={() => setSearchOpen(true)}
              className="mx-auto hidden min-w-0 max-w-xl md:flex"
            />
          )}
          <nav
            aria-label={t('common.mainMenu')}
            className="ml-auto hidden items-center gap-1 md:flex"
          >
            {NAV.map(({ to, key, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                title={t(`nav.${key}`)}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-2 rounded-md px-2.5 py-2 text-sm font-medium text-muted-foreground transition hover:bg-accent hover:text-foreground lg:px-3',
                    isActive && 'bg-secondary text-foreground',
                  )
                }
              >
                <Icon className="size-4" aria-hidden />
                {/* Icons only until there is room for the labels next to the search bar. */}
                <span className="sr-only lg:not-sr-only">{t(`nav.${key}`)}</span>
              </NavLink>
            ))}
            {wide && bell}
          </nav>
          <div className="ml-auto flex items-center md:hidden">
            {!wide && bell}
            <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" aria-label={t('common.menu')}>
                  <Menu />
                </Button>
              </SheetTrigger>
              <SheetContent side="right" className="flex w-72 flex-col">
                <SheetHeader>
                  <SheetTitle>
                    <Wordmark />
                  </SheetTitle>
                </SheetHeader>
                <nav aria-label={t('common.mainMenu')} className="grid gap-1 px-4">
                  {[{ to: '/', key: 'products', icon: Store }, ...NAV].map(
                    ({ to, key, icon: Icon }) => (
                      <NavLink
                        key={to}
                        to={to}
                        end
                        onClick={() => setMenuOpen(false)}
                        className={({ isActive }) =>
                          cn(
                            'flex items-center gap-3 rounded-lg px-3 py-3 font-medium',
                            isActive ? 'bg-secondary' : 'hover:bg-accent',
                          )
                        }
                      >
                        <Icon className="size-4" aria-hidden />
                        {t(`nav.${key}`)}
                      </NavLink>
                    ),
                  )}
                </nav>
                <AppInfo
                  className="mt-auto border-t px-4 pt-2 pb-[calc(env(safe-area-inset-bottom)+0.75rem)]"
                  onFeedback={openFeedback}
                />
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </header>

      <div className="px-4 md:hidden">
        <InstallBanner />
      </div>

      <main id="main" className="mx-auto max-w-6xl px-4 pt-6">
        <ErrorBoundary>
          <Outlet
            context={{ openSearch: () => setSearchOpen(true), openFeedback } satisfies ShellContext}
          />
        </ErrorBoundary>
      </main>

      {/* Mobile: on the products screen search lives at the bottom, within thumb reach. */}
      {showSearch && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t bg-background/90 px-4 pt-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] backdrop-blur md:hidden">
          <SearchTrigger onClick={() => setSearchOpen(true)} />
        </div>
      )}

      <SearchCommand open={searchOpen} onOpenChange={setSearchOpen} anchor={searchBar} />
      <FeedbackDialog open={feedbackOpen} onOpenChange={setFeedbackOpen} />
    </div>
  );
}

export interface ShellContext {
  openSearch: () => void;
  /** The feedback dialog lives in the shell, so it survives closing the menu. */
  openFeedback: () => void;
}
