import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes, useLocation, type Location } from 'react-router';
import { AppShell } from './components/AppShell';
import { ErrorBoundary } from './components/ErrorBoundary';
import { PageSpinner } from './components/States';
import { OverviewPage } from './pages/Overview';
import { ProductDialog, ProductPage } from './pages/ProductDetail';
import { useMediaQuery, WIDE } from './lib/media';

const WizardPage = lazy(() => import('./pages/Wizard'));
const StoresPage = lazy(() => import('./pages/Stores'));
const NotificationsPage = lazy(() => import('./pages/Notifications'));
const CostsPage = lazy(() => import('./pages/Costs'));
const SettingsPage = lazy(() => import('./pages/Settings'));
const WelcomePage = lazy(() => import('./pages/Welcome'));

/**
 * Product detail opens as a dialog over the page you came from (background location) and as a
 * full page on a direct visit, e.g. from a notification. Same URL either way: /p/:id. On small
 * screens it is always a page: a dialog over the overview adds nothing there.
 */
export function App() {
  const location = useLocation();
  const wide = useMediaQuery(WIDE);
  const background = wide
    ? (location.state as { background?: Location } | null)?.background
    : undefined;
  return (
    <ErrorBoundary>
      <Suspense fallback={<PageSpinner />}>
        <Routes location={background ?? location}>
          <Route path="welcome" element={<WelcomePage />} />
          <Route element={<AppShell />}>
            <Route index element={<OverviewPage />} />
            <Route path="p/:id" element={<ProductPage />} />
            <Route path="track" element={<WizardPage />} />
            <Route path="stores" element={<StoresPage />} />
            <Route path="notifications" element={<NotificationsPage />} />
            <Route path="costs" element={<CostsPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </Suspense>
      {background && (
        <Routes>
          <Route path="p/:id" element={<ProductDialog />} />
        </Routes>
      )}
    </ErrorBoundary>
  );
}
