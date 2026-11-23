import { useEffect } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ArrowLeft, ArrowRight } from 'lucide-react';

import { LangToggle, useLang } from '../../../i18n/LanguageContext';
import { LegalDocument } from '../components/LegalDocument';
import { LEGAL_CHROME, LEGAL_PAGES, isLegalPageId } from '../copy/legal-documents.copy';

// K02 — public, unauthenticated policy page: /legal/:page. Works on a direct
// visit, a reload and a new tab. "Back" returns to the previous in-app page
// when there is one (the signup form keeps its own state in memory and its
// non-secret draft in sessionStorage); otherwise it goes to the entry page.
export function LegalPage() {
  const { page } = useParams();
  const { lang, t } = useLang();
  const navigate = useNavigate();
  const chrome = LEGAL_CHROME[lang];
  const id = isLegalPageId(page) ? page : null;

  useEffect(() => {
    const title = id ? LEGAL_PAGES[id][lang].title : chrome.notFound;
    document.title = `${title} · ${t('appName')}`;
  }, [id, lang, chrome.notFound, t]);

  const hasHistory =
    typeof window !== 'undefined' &&
    typeof (window.history.state as { idx?: number } | null)?.idx === 'number' &&
    (window.history.state as { idx: number }).idx > 0;
  const BackIcon = lang === 'ar' ? ArrowRight : ArrowLeft;
  const backClass =
    'inline-flex min-h-11 items-center gap-2 rounded-xl px-3 text-slate-800 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 dark:text-slate-100 dark:hover:bg-slate-800';

  return (
    <div className="min-h-svh bg-white dark:bg-slate-950">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 backdrop-blur dark:border-slate-800 dark:bg-slate-950/95">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-2">
          {hasHistory ? (
            <button type="button" onClick={() => navigate(-1)} className={backClass}>
              <BackIcon size={18} aria-hidden="true" />
              <span style={{ fontSize: '15px', fontWeight: 600 }}>{chrome.back}</span>
            </button>
          ) : (
            <Link to="/select" className={backClass}>
              <BackIcon size={18} aria-hidden="true" />
              <span style={{ fontSize: '15px', fontWeight: 600 }}>{t('appName')}</span>
            </Link>
          )}
          <LangToggle />
        </div>
      </header>
      <main
        className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-10"
        style={{ overflowWrap: 'anywhere' }}
      >
        {id ? (
          <LegalDocument id={id} lang={lang} />
        ) : (
          <h1 style={{ fontSize: '22px', fontWeight: 800 }}>{chrome.notFound}</h1>
        )}
      </main>
    </div>
  );
}
