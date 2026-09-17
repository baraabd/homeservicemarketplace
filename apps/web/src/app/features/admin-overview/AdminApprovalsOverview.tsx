import { Link } from 'react-router';
import { ClipboardCheck, FileClock, Inbox, RefreshCw, ShieldCheck, Users } from 'lucide-react';
import type { ListAdminProvidersResponse } from '@homeservicemarketplace/contracts';
import { useAdminProviders } from '../../hooks/admin/useAdminProviders';
import { DirectoryError } from '../admin-directory/components/DirectoryPrimitives';
import type { ReviewLanguage } from '../admin-provider-review/copy';
import { APPROVAL_OVERVIEW_QUERY } from './queries';
import { ApprovalPreviewRow } from './ApprovalPreviewRow';
import { ADMIN_OVERVIEW_COPY } from './copy';
import '../admin-provider-review/admin-review.css';
import '../admin-directory/admin-directory.css';
import './admin-overview.css';

const METRICS = [
  { key: 'pendingReview', label: 'pending', path: '/admin/reviews', icon: ClipboardCheck },
  { key: 'returned', label: 'returned', path: '/admin/reviews?status=REJECTED', icon: FileClock },
  { key: 'draft', label: 'drafts', path: '/admin/providers?status=DRAFT', icon: Inbox },
  { key: 'all', label: 'all', path: '/admin/providers', icon: Users },
] as const;

/** Exact server aggregates and the oldest submitted files; no local readiness policy. */
export function AdminApprovalsOverview({ lang }: { lang: ReviewLanguage }) {
  const t = ADMIN_OVERVIEW_COPY[lang];
  const query = useAdminProviders(APPROVAL_OVERVIEW_QUERY);
  // A failed refresh must not present cached personal data as a current queue.
  const data: ListAdminProvidersResponse | undefined = query.isError ? undefined : query.data;
  return (
    <section className="admin-review admin-overview ar-stack" data-testid="admin-approvals-overview" aria-labelledby="approval-overview-title" dir={lang === 'ar' ? 'rtl' : 'ltr'} lang={lang}>
      <header className="ao-hero">
        <div className="ao-hero-copy">
          <span className="ar-eyebrow">{t.eyebrow}</span>
          <h2 id="approval-overview-title" className="ao-title">{t.title}</h2>
          <p className="ar-muted">{t.description}</p>
        </div>
        <div className="ao-actions">
          <Link className="ar-button ar-button-primary" data-testid="overview-open-queue" to="/admin/reviews"><ClipboardCheck size={18} aria-hidden="true" />{t.openQueue}</Link>
          <Link className="ar-button" to="/admin/providers">{t.directory}</Link>
        </div>
      </header>
      <div>
        <div className="ao-metrics">
          {METRICS.map(({ key, label, path, icon: Icon }) => (
            <Link key={key} to={path} className={`ar-card ao-metric${key === 'pendingReview' ? ' ao-metric-primary' : ''}`}>
              <span className="ao-metric-label"><Icon size={18} aria-hidden="true" />{t[label]}</span>
              <strong data-testid={`overview-count-${key}`}>{data?.counts?.[key]?.toLocaleString(lang) ?? '—'}</strong>
            </Link>
          ))}
        </div>
        <p className="ao-count-hint ar-muted">{t.countsHint}</p>
      </div>
      <div className="ao-workspace">
        <section className="ar-card ao-queue" aria-labelledby="approval-preview-title" aria-busy={query.isFetching}>
          <header className="ao-queue-header">
            <div><h3 id="approval-preview-title" className="ar-heading">{t.queueTitle}</h3><p className="ar-muted">{t.queueHint}</p></div>
            <button type="button" className="ar-button" disabled={query.isFetching} onClick={() => void query.refetch()} aria-label={t.refresh}><RefreshCw size={18} aria-hidden="true" /></button>
          </header>
          {query.isPending ? (
            <div className="ao-empty" role="status"><RefreshCw size={26} aria-hidden="true" /><p>{t.loading}</p></div>
          ) : query.isError ? (
            <DirectoryError error={query.error} onRetry={() => void query.refetch()} isAr={lang === 'ar'} />
          ) : !data?.items.length ? (
            <div className="ao-empty" role="status"><Inbox size={32} aria-hidden="true" /><h4>{t.empty}</h4><p className="ar-muted">{t.emptyHint}</p><Link className="ar-button" to="/admin/providers">{t.directory}</Link></div>
          ) : (
            <><ul className="ao-requests">{data.items.map((provider) => <ApprovalPreviewRow key={provider.id} provider={provider} lang={lang} checkedAt={query.dataUpdatedAt} />)}</ul><footer className="ao-queue-footer"><p className="ar-muted">{t.previewHint}</p><Link className="ar-button" to="/admin/reviews">{t.openQueue}</Link></footer></>
          )}
        </section>
        <aside className="ar-card ao-guide" aria-labelledby="approval-workflow-title">
          <ShieldCheck size={27} aria-hidden="true" className="ao-guide-icon" />
          <h3 id="approval-workflow-title" className="ar-heading">{t.workflowTitle}</h3>
          <ol className="ao-workflow">{t.workflow.map((step, index) => <li key={step}><span aria-hidden="true" data-step={(index + 1).toLocaleString(lang)} /><p>{step}</p></li>)}</ol>
          <p className="ar-muted">{t.workflowHint}</p>
          <Link className="ar-button" to="/admin/settings/verification-policies">{t.policies}</Link>
        </aside>
      </div>
    </section>
  );
}
