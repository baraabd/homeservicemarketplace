import { Link } from 'react-router';
import { ArrowLeft, ArrowRight, MapPin } from 'lucide-react';
import type { AdminProviderSummary } from '@homeservicemarketplace/contracts';
import { ProviderSubmission } from '../admin-directory/components/ProviderDirectoryRow';
import { DIRECTORY_COPY } from '../admin-directory/copy';
import { ReviewBadge, StatusBadge } from '../admin-provider-review/components/ReviewPrimitives';
import type { ReviewLanguage } from '../admin-provider-review/copy';
import { ADMIN_OVERVIEW_COPY } from './copy';

/** A read-only entry into the existing dossier, never an approval shortcut. */
export function ApprovalPreviewRow({ provider, lang, checkedAt }: {
  provider: AdminProviderSummary;
  lang: ReviewLanguage;
  checkedAt: number;
}) {
  const t = ADMIN_OVERVIEW_COPY[lang];
  const directory = DIRECTORY_COPY[lang];
  const Arrow = lang === 'ar' ? ArrowLeft : ArrowRight;
  return (
    <li className="ao-request" data-testid={`approval-preview-${provider.id}`}>
      <div className="ao-person">
        <span className="ao-avatar" aria-hidden="true">{provider.initials}</span>
        <div className="ao-person-copy">
          <h4><bdi dir="auto">{provider.displayName}</bdi></h4>
          <p className="ar-muted"><bdi dir="ltr">{provider.email ?? directory.unknown}</bdi></p>
          <p className="ao-location ar-muted"><MapPin size={14} aria-hidden="true" />
            <bdi dir="auto">{[provider.serviceAreaCity, provider.serviceAreaCountry].filter(Boolean).join(' · ') || directory.locationMissing}</bdi>
          </p>
        </div>
      </div>
      <div className="ao-request-facts">
        <ProviderSubmission provider={provider} lang={lang} checkedAt={checkedAt} />
        <dl className="ao-axes">
          <div><dt>{t.identity}</dt><dd>{provider.verificationState === undefined ? <ReviewBadge>{directory.unknown}</ReviewBadge> : <StatusBadge value={provider.verificationState ?? 'UNVERIFIED'} lang={lang} />}</dd></div>
          <div><dt>{t.workAccess}</dt><dd><ReviewBadge tone={provider.workAccess?.canWork ? 'success' : 'neutral'}>{!provider.workAccess ? directory.unknown : provider.workAccess.canWork ? directory.canWork : directory.cannotWork}</ReviewBadge></dd></div>
        </dl>
      </div>
      <Link className="ar-button ao-review-link" to={`/admin/providers/${encodeURIComponent(provider.id)}?returnTo=${encodeURIComponent('/admin/reviews')}`} aria-label={`${t.inspect}: ${provider.displayName}`}>
        {t.inspect}<Arrow size={17} aria-hidden="true" />
      </Link>
    </li>
  );
}
