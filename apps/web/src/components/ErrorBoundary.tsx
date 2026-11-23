import { Component, type ErrorInfo, type ReactNode } from 'react';
import { useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';
import { RotateCw } from 'lucide-react';
import { BASE } from '@/lib/api';
import { LogoMark } from './Logo';
import { Button } from './ui/button';

function Fallback({ error, onReset }: { error: Error; onReset: () => void }) {
  const { t } = useTranslation();
  return (
    <div
      role="alert"
      className="mx-auto mt-16 grid max-w-md place-items-center gap-4 rounded-2xl border bg-card p-8 text-center"
    >
      <LogoMark className="size-12" title="" />
      <p className="font-display text-xl font-bold">{t('common.crashTitle')}</p>
      <p className="text-sm text-muted-foreground">{t('common.crashHint')}</p>
      <details className="w-full text-left text-xs text-muted-foreground">
        <summary className="cursor-pointer">{t('common.crashDetails')}</summary>
        <pre className="mt-2 overflow-x-auto whitespace-pre-wrap">{error.message}</pre>
      </details>
      <div className="flex flex-wrap justify-center gap-2">
        <Button onClick={onReset}>
          <RotateCw /> {t('common.retry')}
        </Button>
        <Button variant="outline" asChild>
          <a href={`${BASE}/`}>{t('nav.home')}</a>
        </Button>
      </div>
    </div>
  );
}

class Boundary extends Component<
  { children: ReactNode; resetKey: string },
  { error: Error | null; key: string }
> {
  override state = { error: null as Error | null, key: this.props.resetKey };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  static getDerivedStateFromProps(
    props: { resetKey: string },
    state: { error: Error | null; key: string },
  ) {
    // Navigating elsewhere clears the error, so one broken screen never locks the whole app.
    return props.resetKey !== state.key ? { error: null, key: props.resetKey } : null;
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Gier UI error', error, info.componentStack);
  }

  override render() {
    return this.state.error ? (
      <Fallback error={this.state.error} onReset={() => this.setState({ error: null })} />
    ) : (
      this.props.children
    );
  }
}

/** Catches rendering errors per page and shows a way out instead of an empty screen. */
export function ErrorBoundary({ children }: { children: ReactNode }) {
  const location = useLocation();
  return <Boundary resetKey={location.pathname + location.search}>{children}</Boundary>;
}
