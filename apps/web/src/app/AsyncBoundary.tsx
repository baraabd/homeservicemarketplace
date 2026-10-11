import { Component, Suspense, type ReactNode } from 'react';
import { Button } from './components/ui/button';
import { LanguageProvider, useLang } from './i18n/LanguageContext';
import { ASYNC_COPY } from './async-copy';

function PageLoadingState() {
  const { lang, dir } = useLang();
  return (
    <section
      className="w-full space-y-4 p-6 text-foreground"
      role="status"
      aria-live="polite"
      lang={lang}
      dir={dir}
    >
      <p>{ASYNC_COPY[lang].loadingPage}</p>
      <div aria-hidden="true" className="space-y-3 motion-safe:animate-pulse">
        <div className="h-6 w-1/2 rounded-md bg-muted" />
        <div className="h-20 w-full rounded-lg bg-muted" />
        <div className="h-20 w-full rounded-lg bg-muted" />
      </div>
    </section>
  );
}

function PageLoadError() {
  const { lang, dir } = useLang();
  return (
    <section className="w-full space-y-4 p-6 text-foreground" lang={lang} dir={dir}>
      <div role="alert">
        <p>{ASYNC_COPY[lang].pageError}</p>
      </div>
      <Button type="button" className="min-h-11" onClick={() => window.location.reload()}>
        {ASYNC_COPY[lang].reloadPage}
      </Button>
    </section>
  );
}

class AsyncErrorBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/** Keep loading and chunk-recovery local so an existing shell stays mounted. */
export function AsyncBoundary({
  children,
  loading = <PageLoadingState />,
  error = <PageLoadError />,
  standalone = false,
}: {
  children: ReactNode;
  loading?: ReactNode;
  error?: ReactNode;
  /** Admin/disputes supply their own language context only after loading. */
  standalone?: boolean;
}) {
  // The page keeps its own provider and state. Only a top-level fallback needs
  // the established stored-language reader before that page is available.
  return (
    <AsyncErrorBoundary
      fallback={standalone ? <LanguageProvider>{error}</LanguageProvider> : error}
    >
      <Suspense fallback={standalone ? <LanguageProvider>{loading}</LanguageProvider> : loading}>
        {children}
      </Suspense>
    </AsyncErrorBoundary>
  );
}
