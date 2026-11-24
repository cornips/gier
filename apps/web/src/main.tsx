import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { registerSW } from 'virtual:pwa-register';
import './index.css';
import './lib/install';
import i18n from './i18n';
import { api, BASE, isAuthError, signInAgain } from './lib/api';
import { App } from './App';
import { ThemeProvider } from './lib/theme';
import { TooltipProvider } from './components/ui/tooltip';
import { Toaster } from './components/ui/sonner';

registerSW({ immediate: true });

// Tell the server which language the user sees, so notifications use it too.
const reportLanguage = (lng: string) => void api.setLanguage(lng).catch(() => {});
reportLanguage(i18n.language);
i18n.on('languageChanged', reportLanguage);

/**
 * When the login proxy ended the session, go through its login page once by ourselves. A second time
 * within a few minutes means the login did not help (e.g. access was withdrawn): then the error screen
 * with a sign-in button stays, instead of a redirect loop.
 */
// A hard refresh (see lib/build.ts) adds ?refresh= to bypass every cache; drop it from the address.
{
  const url = new URL(window.location.href);
  if (url.searchParams.has('refresh')) {
    url.searchParams.delete('refresh');
    window.history.replaceState(window.history.state, '', url.toString());
  }
}

const RELOGIN_KEY = 'gier.reloginAt';
function onAuthLost(error: unknown) {
  if (!isAuthError(error)) return;
  try {
    const last = Number(sessionStorage.getItem(RELOGIN_KEY)) || 0;
    if (Date.now() - last < 3 * 60_000) return;
    sessionStorage.setItem(RELOGIN_KEY, String(Date.now()));
  } catch {
    return;
  }
  signInAgain();
}

const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: onAuthLost }),
  mutationCache: new MutationCache({ onError: onAuthLost }),
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: true,
      retry: (count, error) => !isAuthError(error) && count < 1,
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter basename={BASE || '/'}>
          <TooltipProvider delayDuration={300}>
            <App />
            <Toaster position="top-center" />
          </TooltipProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </ThemeProvider>
  </StrictMode>,
);
