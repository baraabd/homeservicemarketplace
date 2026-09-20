import { Link } from 'react-router';
import { AlertTriangle, Gavel, Scale, UserMinus } from 'lucide-react';
import { useLang } from '../../../i18n/LanguageContext';
import { useAdminDisputeQueue } from './api';
import { WORKSPACE_COPY } from './copy';
import '../../admin-approvals/approval-center.css';

// Sprint 12 closure — the dispute half of the Admin dashboard.
//
// The dashboard already opened with the provider approval centre and a KPI row
// that carried a single `disputesOpen` number. An Admin could therefore see at
// a glance how many provider applications were waiting, but had to open the
// dispute inbox to discover whether any case was unassigned, overdue, or
// waiting on an independent appeal. Those three are the ones that decide
// whether somebody has to act today.
//
// EVERY NUMBER HERE IS THE SERVER'S
//
// `GET /v1/admin/dispute-workspaces` already returns `counts` computed with
// four `count()` queries over the whole table, scoped to exclude cases the
// reader is a party to. Nothing is derived by counting the rows of the page
// that happens to be loaded, and nothing is invented when the request fails:
// an error renders an explicit "unavailable" marker rather than a zero, because
// "no overdue cases" and "we could not ask" must not look identical.
//
// The tiles reuse the approval centre's own `.ac-metric` markup and stylesheet
// so the two halves of the dashboard are visibly one product.
export function DisputeCenterSummary() {
  const { lang } = useLang();
  const t = WORKSPACE_COPY[lang];
  // '' and false = the unfiltered queue, which is the scope these totals
  // describe. The counts are queue-wide regardless, but asking for the default
  // view keeps this component from competing with the inbox's cache entry.
  const query = useAdminDisputeQueue('', false);
  const counts = query.isError ? undefined : query.data?.pages[0]?.counts;

  const cards = [
    { key: 'all', label: t.all, hint: t.summaryAllHint, icon: Scale },
    { key: 'unassigned', label: t.unassigned, hint: t.summaryUnassignedHint, icon: UserMinus },
    { key: 'overdue', label: t.overdue, hint: t.summaryOverdueHint, icon: AlertTriangle },
    { key: 'appeals', label: t.appeals, hint: t.summaryAppealsHint, icon: Gavel },
  ] as const;

  return (
    <section
      className="ar-card ac-center"
      aria-labelledby="dispute-center-title"
      aria-busy={query.isFetching}
      data-testid="admin-dispute-summary"
    >
      <header className="ac-header">
        <div>
          <p className="ar-eyebrow">{t.summaryEyebrow}</p>
          <h2 id="dispute-center-title" className="ar-title">
            {t.queue}
          </h2>
          <p className="ar-muted">{t.summaryDescription}</p>
        </div>
        <Link className="ar-button ar-button-primary" to="/admin/disputes">
          {t.summaryOpenInbox}
        </Link>
      </header>
      <div className="ac-metrics" aria-label={t.queue}>
        {cards.map(({ key, label, hint, icon: Icon }) => (
          <Link
            key={key}
            to="/admin/disputes"
            className={`ac-metric${key === 'overdue' ? ' ac-metric-primary' : ''}`}
          >
            <div className="ac-metric-heading">
              <span>{label}</span>
              <Icon size={20} aria-hidden="true" />
            </div>
            <strong data-testid={`dispute-count-${key}`}>
              {counts ? counts[key].toLocaleString(lang) : t.countUnavailable}
            </strong>
            <span className="ar-muted">{hint}</span>
          </Link>
        ))}
      </div>
      <p className="ac-count-hint ar-muted">{t.summaryCountsHint}</p>
    </section>
  );
}
