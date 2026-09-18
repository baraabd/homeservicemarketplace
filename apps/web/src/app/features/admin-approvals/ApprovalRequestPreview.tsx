import { ArrowLeft, ArrowRight, MapPin } from 'lucide-react';
import { Link } from 'react-router';
import type { AdminProviderSummary } from '@homeservicemarketplace/contracts';
import { ReviewBadge, StatusBadge } from '../admin-provider-review/components/ReviewPrimitives';
import { formatReviewDate } from '../admin-provider-review/format-review-date';
import type { ReviewLanguage } from '../admin-provider-review/copy';
import { APPROVAL_COPY } from './copy';

/** Read-only summary. Decisions belong to the versioned, permission-aware dossier. */
export function ApprovalRequestPreview({
  provider,
  lang,
}: {
  provider: AdminProviderSummary;
  lang: ReviewLanguage;
}) {
  const t = APPROVAL_COPY[lang];
  const Arrow = lang === 'ar' ? ArrowLeft : ArrowRight;
  return (
    <li className="ac-request" data-testid={`approval-preview-${provider.id}`}>
      <div className="ac-request-person">
        <span className="ac-avatar" aria-hidden="true">{provider.initials}</span>
        <div className="ac-person-copy">
          <h4><bdi dir="auto">{provider.displayName}</bdi></h4>
          {provider.email && <p className="ar-muted"><bdi dir="ltr">{provider.email}</bdi></p>}
          <p className="ac-location ar-muted">
            <MapPin size={14} aria-hidden="true" />
            <span>
              {[provider.serviceAreaCity, provider.serviceAreaCountry].filter(Boolean).join(' · ') || t.unknown}
            </span>
          </p>
          {!!provider.serviceCategories?.length && (
            <p className="ar-muted">
              {provider.serviceCategories
                .map((item) => lang === 'ar' ? item.labelAr : item.labelEn)
                .join(' · ')}
            </p>
          )}
        </div>
      </div>
      <div className="ac-request-meta">
        <StatusBadge value={provider.status} lang={lang} />
        <p className="ar-muted">
          {t.submitted}: {formatReviewDate(provider.submittedForReviewAt ?? null, lang, t.noDate, true)}
        </p>
        <ReviewBadge tone={provider.workAccess?.canWork ? 'success' : 'neutral'}>
          {!provider.workAccess
            ? t.accessUnknown
            : provider.workAccess.canWork ? t.accessAllowed : t.accessBlocked}
        </ReviewBadge>
      </div>
      <Link
        className="ar-button ac-open"
        to={`/admin/providers/${encodeURIComponent(provider.id)}?returnTo=${encodeURIComponent('/admin')}`}
        aria-label={`${t.open}: ${provider.displayName}`}
      >
        {t.open}<Arrow size={17} aria-hidden="true" />
      </Link>
    </li>
  );
}
