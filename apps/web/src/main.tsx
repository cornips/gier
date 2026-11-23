import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { registerSW } from 'virtual:pwa-register';
import './index.css';
import i18n from './i18n';
import { api, BASE } from './lib/api';
import { App } from './App';
import { ThemeProvider } from './lib/theme';
import { TooltipProvider } from './components/ui/tooltip';
import { Toaster } from './components/ui/sonner';

registerSW({ immediate: true });

// Tell the server which language the user sees, so notifications use it too.
const reportLanguage = (lng: string) => void api.setLanguage(lng).catch(() => {});
reportLanguage(i18n.language);
i18n.on('languageChanged', reportLanguage);

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: true, retry: 1 } },
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
