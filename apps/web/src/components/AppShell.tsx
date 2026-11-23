import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Bell, Coins, Menu, Settings, Store } from 'lucide-react';
import { ErrorBoundary } from './ErrorBoundary';
import { InstallBanner } from './InstallBanner';
import { Wordmark } from './Logo';
import { SearchCommand, SearchTrigger } from './SearchCommand';
import { Button } from './ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from './ui/sheet';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

const NAV = [
  { to: '/stores', key: 'stores', icon: Store },
  { to: '/costs', key: 'costs', icon: Coins },
  { to: '/settings', key: 'settings', icon: Settings },
] as const;

export function AppShell() {
  const { t } = useTranslation();
  const [searchOpen, setSearchOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const notifications = useQuery({
    queryKey: ['notifications'],
    queryFn: api.notifications,
    refetchInterval: 60_000,
  });
  const unread = notifications.data?.filter((n) => !n.readAt).length ?? 0;

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

  const bell = (
    <Button asChild variant="ghost" size="icon" className="relative">
      <Link
        to="/notifications"
        aria-label={unread ? `${t('nav.notifications')} (${unread})` : t('nav.notifications')}
      >
        <Bell />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 grid min-w-4 place-items-center rounded-full bg-prey px-1 text-[10px] font-bold text-prey-foreground tabular">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </Link>
    </Button>
  );

  return (
    <div className="min-h-dvh pb-[calc(env(safe-area-inset-bottom)+5.5rem)] md:pb-10">
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
          <SearchTrigger
            onClick={() => setSearchOpen(true)}
            className="mx-auto hidden max-w-xl md:flex"
          />
          <nav
            aria-label={t('common.mainMenu')}
            className="ml-auto hidden items-center gap-1 md:flex"
          >
            {NAV.map(({ to, key, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition hover:bg-accent hover:text-foreground',
                    isActive && 'bg-secondary text-foreground',
                  )
                }
              >
                <Icon className="size-4" aria-hidden />
                {t(`nav.${key}`)}
              </NavLink>
            ))}
            {bell}
          </nav>
          <div className="ml-auto flex items-center md:hidden">
            {bell}
            <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" aria-label={t('common.menu')}>
                  <Menu />
                </Button>
              </SheetTrigger>
              <SheetContent side="right" className="w-72">
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
          <Outlet context={{ openSearch: () => setSearchOpen(true) }} />
        </ErrorBoundary>
      </main>

      {/* Mobile: search lives at the bottom, within thumb reach. */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t bg-background/90 px-4 pt-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] backdrop-blur md:hidden">
        <SearchTrigger onClick={() => setSearchOpen(true)} />
      </div>

      <SearchCommand open={searchOpen} onOpenChange={setSearchOpen} />
    </div>
  );
}

export interface ShellContext {
  openSearch: () => void;
}
