import { Link } from 'react-router';
import {
  ArrowLeft,
  ArrowRight,
  ClipboardCheck,
  FileSearch,
  Inbox,
  RefreshCw,
  ShieldCheck,
  Users,
} from 'lucide-react';
import type { ListAdminProvidersQuery } from '@homeservicemarketplace/contracts';
import { useLang } from '../../i18n/LanguageContext';
import { useAdminProviders } from '../../hooks/admin/useAdminProviders';
import { DirectoryError } from '../admin-directory/components/DirectoryPrimitives';
import { ApprovalRequestPreview } from './ApprovalRequestPreview';
import { APPROVAL_COPY } from './copy';
import '../admin-provider-review/admin-review.css';
import './approval-center.css';

const PREVIEW_QUERY: ListAdminProvidersQuery = {
  status: 'PENDING_REVIEW',
  sort: 'SUBMITTED_OLDEST',
  limit: 3,
};

/** The dashboard uses the existing provider query cache and its mutation invalidation. */
export function ApprovalCenter() {
  const { lang, dir } = useLang();
  const t = APPROVAL_COPY[lang];
  const query = useAdminProviders(PREVIEW_QUERY);
  // Never convert failed/old API responses into a false empty queue or stale action links.
  const data = query.isError ? undefined : query.data;
  const Arrow = dir === 'rtl' ? ArrowLeft : ArrowRight;
  const cards = [
    {
      key: 'pendingReview',
      label: t.pending,
      hint: t.pendingHint,
      to: '/admin/reviews',
      icon: ClipboardCheck,
    },
    {
      key: 'draft',
      label: t.draft,
      hint: t.draftHint,
      to: '/admin/providers?status=DRAFT',
      icon: FileSearch,
    },
    {
      key: 'active',
      label: t.active,
      hint: t.activeHint,
      to: '/admin/providers?status=ACTIVE',
      icon: ShieldCheck,
    },
    {
      key: 'returned',
      label: t.returned,
      hint: t.returnedHint,
      to: '/admin/reviews?status=REJECTED',
      icon: RefreshCw,
    },
  ] as const;
  return (
    <section
      className="admin-review ac-center ar-stack"
      dir={dir}
      lang={lang}
      aria-labelledby="approval-center-title"
      data-testid="admin-approval-center"
    >
      <header className="ac-hero">
        <div className="ac-hero-copy">
          <p className="ar-eyebrow">{t.eyebrow}</p>
          <h2 id="approval-center-title" className="ar-title">
            {t.title}
          </h2>
          <p className="ar-muted">{t.description}</p>
        </div>
        <Link className="ar-button ar-button-primary" to="/admin/reviews">
          <ClipboardCheck size={19} aria-hidden="true" />
          {t.openQueue}
          <Arrow size={18} aria-hidden="true" />
        </Link>
      </header>
      <div className="ac-metrics" aria-label={t.metrics}>
        {cards.map(({ key, label, hint, to, icon: Icon }) => (
          <Link
            key={key}
            to={to}
            className={`ac-metric${key === 'pendingReview' ? ' ac-metric-primary' : ''}`}
          >
            <div className="ac-metric-heading">
              <span>{label}</span>
              <Icon size={20} aria-hidden="true" />
            </div>
            <strong data-testid={`approval-count-${key}`}>
              {data?.counts?.[key]?.toLocaleString(lang) ?? t.countUnavailable}
            </strong>
            <span className="ar-muted">{hint}</span>
          </Link>
        ))}
      </div>
      <p className="ac-count-hint ar-muted">{t.countsHint}</p>
      <div className="ac-content">
        <section
          className="ar-card ac-queue"
          aria-labelledby="approval-queue-title"
          aria-busy={query.isFetching}
        >
          <header className="ac-section-heading">
            <div>
              <h3 id="approval-queue-title" className="ar-heading">
                {t.queue}
              </h3>
              <p className="ar-muted">{t.oldest}</p>
            </div>
            <button
              type="button"
              className="ar-button ac-refresh"
              data-testid="approval-refresh"
              aria-label={t.refresh}
              title={t.refresh}
              disabled={query.isFetching}
              onClick={() => void query.refetch()}
            >
              <RefreshCw size={18} aria-hidden="true" />
            </button>
          </header>
          {query.isPending ? (
            <div className="ac-empty" role="status">
              <RefreshCw size={28} aria-hidden="true" />
              <p>{t.loading}</p>
            </div>
          ) : query.isError ? (
            <DirectoryError
              error={query.error}
              onRetry={() => void query.refetch()}
              isAr={lang === 'ar'}
            />
          ) : /* A truthy response missing `items` must render the empty state,
                 not white-screen the whole Admin dashboard. */
          !data?.items?.length ? (
            <div className="ac-empty" role="status">
              <Inbox size={32} aria-hidden="true" />
              <h4>{t.empty}</h4>
              <p className="ar-muted">{t.emptyHint}</p>
            </div>
          ) : (
            <ul className="ac-requests">
              {data.items.map((provider) => (
                <ApprovalRequestPreview key={provider.id} provider={provider} lang={lang} />
              ))}
            </ul>
          )}
          <footer className="ac-queue-footer">
            <Link className="ar-button" to="/admin/reviews">
              {t.viewAll}
              <Arrow size={17} aria-hidden="true" />
            </Link>
          </footer>
        </section>
        <aside className="ac-guidance ar-stack" aria-label={t.flowTitle}>
          <section className="ar-card ac-guide">
            <div className="ac-guide-heading">
              <ShieldCheck size={23} aria-hidden="true" />
              <h3 className="ar-heading">{t.flowTitle}</h3>
            </div>
            <p className="ar-muted">{t.flowHint}</p>
            <ol className="ac-steps">
              {t.flow.map((step, index) => (
                <li key={index}>
                  <span className="ac-step-number" aria-hidden="true">
                    {(index + 1).toLocaleString(lang)}
                  </span>
                  <div>
                    <h4>{step.title}</h4>
                    <p className="ar-muted">{step.hint}</p>
                  </div>
                </li>
              ))}
            </ol>
            <Link className="ar-button" to="/admin/identity-cases">
              {t.identityLink}
              <Arrow size={17} aria-hidden="true" />
            </Link>
          </section>
          <section className="ar-card ac-help">
            <h3 className="ar-heading">{t.missingTitle}</h3>
            <p className="ar-muted">{t.missingHint}</p>
            <Link className="ar-button" to="/admin/providers">
              <Users size={17} aria-hidden="true" />
              {t.allProviders}
            </Link>
            <Link className="ac-text-link" to="/admin/providers?status=DRAFT">
              {t.draftsLink}
              <Arrow size={16} aria-hidden="true" />
            </Link>
          </section>
        </aside>
      </div>
    </section>
  );
}
