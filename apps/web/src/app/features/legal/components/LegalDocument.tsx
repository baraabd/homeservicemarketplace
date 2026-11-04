import { Link } from 'react-router';

import {
  LEGAL_CHROME,
  LEGAL_COPY_VERSIONS,
  LEGAL_PAGE_IDS,
  LEGAL_PAGES,
  legalPath,
  type LegalLang,
  type LegalPageId,
} from '../copy/legal-documents.copy';

// K02 — one renderer for a public policy page, used by the full-page route
// and by the in-place signup dialog, so both always show the same text.

export function LegalDocument({
  id,
  lang,
  headingId,
  headingLevel = 1,
  showNav = true,
}: {
  id: LegalPageId;
  lang: LegalLang;
  headingId?: string;
  headingLevel?: 1 | 2;
  showNav?: boolean;
}) {
  const page = LEGAL_PAGES[id][lang];
  const chrome = LEGAL_CHROME[lang];
  const version = id === 'terms' || id === 'privacy' ? LEGAL_COPY_VERSIONS[id] : null;
  const Heading = headingLevel === 1 ? 'h1' : 'h2';
  const Section = headingLevel === 1 ? 'h2' : 'h3';
  return (
    <article className="flex flex-col gap-5 text-slate-800 dark:text-slate-100" lang={lang}>
      <header className="flex flex-col gap-2">
        <Heading
          id={headingId}
          className="text-slate-900 dark:text-white"
          style={{ fontSize: '26px', fontWeight: 800, lineHeight: 1.25 }}
        >
          {page.title}
        </Heading>
        <p style={{ fontSize: '16px', lineHeight: 1.6 }}>{page.summary}</p>
        <p
          role="note"
          className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-amber-900 dark:border-amber-600 dark:bg-amber-950 dark:text-amber-100"
          style={{ fontSize: '15px', lineHeight: 1.5 }}
          data-testid="legal-draft-banner"
        >
          {chrome.draftBanner}
        </p>
        {version ? (
          <p className="text-slate-600 dark:text-slate-300" style={{ fontSize: '14px' }}>
            {chrome.version}:{' '}
            <bdi dir="ltr" data-testid="legal-version">
              {version}
            </bdi>
          </p>
        ) : null}
      </header>
      {page.sections.map((section) => (
        <section key={section.heading} className="flex flex-col gap-2">
          <Section
            className="text-slate-900 dark:text-white"
            style={{ fontSize: '19px', fontWeight: 700, lineHeight: 1.35 }}
          >
            {section.heading}
          </Section>
          {section.paragraphs.map((paragraph) => (
            <p key={paragraph} style={{ fontSize: '16px', lineHeight: 1.7 }}>
              {paragraph}
            </p>
          ))}
        </section>
      ))}
      {showNav ? (
        <nav
          aria-label={chrome.navLabel}
          className="border-t border-slate-200 pt-4 dark:border-slate-700"
        >
          <p className="mb-2 text-slate-600 dark:text-slate-300" style={{ fontSize: '14px' }}>
            {chrome.otherPages}
          </p>
          <ul className="flex flex-wrap gap-2">
            {LEGAL_PAGE_IDS.filter((other) => other !== id).map((other) => (
              <li key={other}>
                <Link
                  to={legalPath(other)}
                  className="inline-flex min-h-11 items-center rounded-xl border border-slate-300 px-4 text-blue-700 underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 dark:border-slate-600 dark:text-blue-300"
                  style={{ fontSize: '15px', fontWeight: 600 }}
                >
                  {LEGAL_PAGES[other][lang].title}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}
    </article>
  );
}
