import { Link } from 'react-router';
import { ArrowLeft, ArrowRight, Clock3, MapPin, UserRound } from 'lucide-react';
import type { AdminProviderSummary } from '@homeservicemarketplace/contracts';
import { ReviewBadge, StatusBadge } from '../../admin-provider-review/components/ReviewPrimitives';
import { statusLabel, type ReviewLanguage } from '../../admin-provider-review/copy';
import { formatReviewDate } from '../../admin-provider-review/format-review-date';
import {
  ACCESS_REASON_LABELS,
  ATTENTION_LABELS,
  DIRECTORY_COPY,
  EXTRA_STATE_LABELS,
  PROVIDER_STATUS_LABELS,
} from '../copy';

function AxisState({ value, lang }: { value: string | null | undefined; lang: ReviewLanguage }) {
  if (!value || (statusLabel(value, lang) === value && !EXTRA_STATE_LABELS[value])) {
    return <ReviewBadge>{DIRECTORY_COPY[lang].unknown}</ReviewBadge>;
  }
  return EXTRA_STATE_LABELS[value] ? (
    <ReviewBadge>{EXTRA_STATE_LABELS[value][lang]}</ReviewBadge>
  ) : (
    <StatusBadge value={value} lang={lang} />
  );
}

/** Missing dates never imply the application was not submitted. */
export function ProviderSubmission({
  provider,
  lang,
  checkedAt,
}: {
  provider: AdminProviderSummary;
  lang: ReviewLanguage;
  checkedAt: number;
}) {
  const t = DIRECTORY_COPY[lang];
  const stamp = provider.submittedForReviewAt;
  const validDate = stamp && !Number.isNaN(new Date(stamp).valueOf());
  if (!validDate) {
    return (
      <p className="ad-submission ar-muted">
        {provider.status === 'DRAFT' &&
        provider.attentionReasons?.includes('APPLICATION_NOT_SUBMITTED')
          ? t.notSubmitted
          : t.submittedUnknown}
      </p>
    );
  }
  const elapsedDays = Math.max(0, Math.floor((checkedAt - new Date(stamp).valueOf()) / 86_400_000));
  return (
    <div className="ad-submission">
      <p>
        <Clock3 size={15} aria-hidden />{' '}
        <span>
          {t.submitted}{' '}
          <time dateTime={stamp}>{formatReviewDate(stamp, lang, t.submittedUnknown, true)}</time>
        </span>
      </p>
      <span className="ar-muted">
        {elapsedDays < 1 ? t.today : `${elapsedDays.toLocaleString(lang)} ${t.elapsedDays}`}
      </span>
    </div>
  );
}

export function ProviderDirectoryRow({
  provider,
  lang,
  reviewQueue,
  returnTo,
  locationState,
  checkedAt,
}: {
  provider: AdminProviderSummary;
  lang: ReviewLanguage;
  reviewQueue: boolean;
  returnTo: string;
  locationState: unknown;
  checkedAt: number;
}) {
  const t = DIRECTORY_COPY[lang];
  const DirectionArrow = lang === 'ar' ? ArrowLeft : ArrowRight;
  const portfolio = provider.portfolio;
  const attention =
    provider.attentionReasons?.flatMap((reason) =>
      ATTENTION_LABELS[reason] ? [ATTENTION_LABELS[reason][lang]] : [],
    ) ?? [];
  const accountState = provider.account?.deletedAt ? 'DELETED' : provider.account?.status;
  return (
    <li
      className={`ad-provider-row${reviewQueue ? ' ad-request-row' : ''}`}
      data-testid={`provider-row-${provider.id}`}
    >
      <div className="ad-row-heading">
        <div className="ad-person">
          <span className="ad-avatar" aria-hidden>
            {provider.initials}
          </span>
          <div className="ad-person-details">
            <h3>{provider.displayName}</h3>
            <p className="ad-email ar-muted" dir="ltr">
              {provider.email ?? t.unknown}
            </p>
            <p className="ad-location ar-muted">
              <MapPin size={14} aria-hidden />
              <span>
                {[provider.serviceAreaCity, provider.serviceAreaCountry]
                  .filter(Boolean)
                  .join(' · ') || t.locationMissing}
              </span>
            </p>
            {provider.serviceCategories?.length ? (
              <p className="ad-services ar-muted">
                {provider.serviceCategories
                  .map((category) => (lang === 'ar' ? category.labelAr : category.labelEn))
                  .join(' · ')}
              </p>
            ) : null}
          </div>
        </div>
        <div className="ad-application-summary">
          <ReviewBadge
            tone={
              provider.status === 'PENDING_REVIEW'
                ? 'warning'
                : provider.status === 'ACTIVE'
                  ? 'success'
                  : 'neutral'
            }
          >
            {PROVIDER_STATUS_LABELS[provider.status]?.[lang] ?? t.unknown}
          </ReviewBadge>
          <ProviderSubmission provider={provider} lang={lang} checkedAt={checkedAt} />
        </div>
      </div>
      <dl className="ad-axis-grid">
        <div>
          <dt>{t.account}</dt>
          <dd>
            <AxisState value={accountState} lang={lang} />
            {provider.account?.isActive === false && !provider.account.deletedAt ? (
              <span className="ad-state-note">
                {lang === 'ar' ? 'الحساب غير مفعّل' : 'Account deactivated'}
              </span>
            ) : null}
          </dd>
        </div>
        <div>
          <dt>{t.onboarding}</dt>
          <dd>
            <AxisState value={provider.onboardingState} lang={lang} />
          </dd>
        </div>
        <div>
          <dt>{t.identity}</dt>
          <dd>
            <AxisState
              // The API treats a recorded null axis as unverified. An omitted
              // field in an older response still means the state is unknown.
              value={
                provider.verificationState === null ? 'UNVERIFIED' : provider.verificationState
              }
              lang={lang}
            />
          </dd>
        </div>
        <div>
          <dt>{t.portfolio}</dt>
          <dd>
            {!portfolio ? (
              <ReviewBadge>{t.unknown}</ReviewBadge>
            ) : portfolio.total === 0 ? (
              <ReviewBadge>{t.emptyPortfolio}</ReviewBadge>
            ) : (
              <>
                {portfolio.pending > 0 ? (
                  <ReviewBadge tone="warning">
                    {portfolio.pending.toLocaleString(lang)} {t.pendingImages}
                  </ReviewBadge>
                ) : portfolio.rejected > 0 ? (
                  <ReviewBadge tone="danger">
                    {portfolio.rejected.toLocaleString(lang)} {t.rejectedImages}
                  </ReviewBadge>
                ) : (
                  <ReviewBadge tone="success">
                    {portfolio.approved.toLocaleString(lang)} {t.approvedImages}
                  </ReviewBadge>
                )}
                {portfolio.pending > 0 || portfolio.rejected > 0 ? (
                  <span className="ad-state-note">
                    {portfolio.approved.toLocaleString(lang)} {t.approvedImages}
                    {portfolio.pending > 0 && portfolio.rejected > 0
                      ? ` · ${portfolio.rejected.toLocaleString(lang)} ${t.rejectedImages}`
                      : ''}
                  </span>
                ) : null}
              </>
            )}
          </dd>
        </div>
        <div>
          <dt>{t.access}</dt>
          <dd>
            <ReviewBadge tone={provider.workAccess?.canWork ? 'success' : 'neutral'}>
              {!provider.workAccess
                ? t.unknown
                : provider.workAccess.canWork
                  ? t.canWork
                  : t.cannotWork}
            </ReviewBadge>
            {provider.workAccess?.denialReason ? (
              <span className="ad-state-note">
                {ACCESS_REASON_LABELS[provider.workAccess.denialReason]?.[lang] ?? t.unknown}
              </span>
            ) : null}
            {provider.workAccess ? (
              <span className="ad-state-note">
                {provider.workAccess.hasLiveGrant ? t.liveGrant : t.noGrant}
              </span>
            ) : null}
          </dd>
        </div>
      </dl>
      <div className="ad-row-footer">
        <div className="ad-review-context">
          {reviewQueue ? (
            <p className="ad-reviewer">
              <UserRound size={16} aria-hidden />
              <span>
                {t.reviewer}:{' '}
                <strong>
                  {provider.verificationCase
                    ? (provider.verificationCase.assignedTo?.name ?? t.unassigned)
                    : provider.verificationCase === null
                      ? t.noActiveCase
                      : t.unknown}
                </strong>
              </span>
            </p>
          ) : null}
          {attention.length > 0 ? (
            <div className="ad-attention">
              <span>{t.focus}</span>
              <ul>
                {attention.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            </div>
          ) : reviewQueue ? (
            <p className="ar-muted">{t.noAttention}</p>
          ) : null}
        </div>
        <Link
          className={`ar-button ad-open-link${reviewQueue ? ' ar-button-primary' : ''}`}
          state={locationState}
          to={`/admin/providers/${encodeURIComponent(provider.id)}?returnTo=${encodeURIComponent(returnTo)}`}
          aria-label={`${t.open} ${provider.displayName}`}
        >
          {reviewQueue ? t.startReview : t.open}
          <DirectionArrow size={17} aria-hidden />
        </Link>
      </div>
    </li>
  );
}
