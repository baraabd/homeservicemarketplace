import { formatReviewDate } from '../format-review-date';
import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { ArrowLeft, ArrowRight, Mail, RefreshCw, ShieldCheck } from 'lucide-react';
import type { AdminProviderReviewMutationResponse } from '@homeservicemarketplace/contracts';
import { useLang } from '../../../i18n/LanguageContext';
import { adminProvidersQueryKeys } from '../../../hooks/admin/useAdminProviders';
import { getProviderReview, requestStatus, reviewQueryKey } from '../api';
import { REVIEW_COPY, statusLabel } from '../copy';
import { ReviewBadge, ReviewBanner, StatusBadge } from './ReviewPrimitives';
import { ReviewDossier } from './ReviewDossier';
import { ReviewTaskOverview } from './ReviewTaskOverview';
import { ReviewIdentity } from './ReviewIdentity';
import { ReviewCategories } from './ReviewCategories';
import { ReviewPortfolio } from './ReviewPortfolio';
import { ReviewDecisionPanel } from './ReviewDecisionPanel';
import { ReviewAccountActions } from './ReviewAccountActions';
import '../admin-review.css';

/** Route-owned application review; server actions and capabilities are authoritative. */
export function AdminProviderReviewWorkspace({
  providerProfileId,
  onBack,
}: {
  providerProfileId: string;
  onBack?: () => void;
}) {
  return (
    <ReviewWorkspace
      key={providerProfileId}
      providerProfileId={providerProfileId}
      onBack={onBack}
    />
  );
}

function ReviewWorkspace({
  providerProfileId,
  onBack,
}: {
  providerProfileId: string;
  onBack?: () => void;
}) {
  const { lang, dir } = useLang();
  const t = REVIEW_COPY[lang];
  const navigate = useNavigate();
  const qc = useQueryClient();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [source, setSource] = useState<'submitted' | 'current'>('submitted');
  const query = useQuery({
    queryKey: reviewQueryKey(providerProfileId),
    queryFn: ({ signal }) => getProviderReview(providerProfileId, signal),
    refetchOnWindowFocus: false,
    retry: false,
  });
  const review = query.data;
  const loadedProviderId = review?.provider.id;
  useEffect(() => {
    if (loadedProviderId) headingRef.current?.focus({ preventScroll: true });
  }, [loadedProviderId]);
  const denied = query.isError && [401, 403, 404].includes(requestStatus(query.error) ?? 0);
  async function refresh() {
    const response = await query.refetch();
    // Keep a failed refresh in the error surface, never pretend stale facts are current.
    if (response.isError) throw response.error;
    void qc.invalidateQueries({ queryKey: adminProvidersQueryKeys.detail(providerProfileId) });
    return response.data;
  }
  function decided(response: AdminProviderReviewMutationResponse) {
    qc.setQueryData(reviewQueryKey(providerProfileId), response.review);
    void qc.invalidateQueries({ queryKey: adminProvidersQueryKeys.root });
    void qc.invalidateQueries({ queryKey: ['admin', 'verification'] });
  }
  const BackIcon = dir === 'rtl' ? ArrowRight : ArrowLeft;
  const selectedSource = !review?.submission ? 'current' : source;
  const snapshot =
    selectedSource === 'current'
      ? (review?.current ?? null)
      : (review?.submission?.snapshot ?? null);
  return (
    <div
      className="admin-review ar-stack"
      dir={dir}
      lang={lang}
      data-testid="admin-provider-review-workspace"
    >
      <div className="ar-subheader">
        <button
          type="button"
          className="ar-button"
          onClick={() => (onBack ? onBack() : navigate('/admin/providers'))}
        >
          <BackIcon size={17} aria-hidden />
          {t.back}
        </button>
        <button
          type="button"
          className="ar-button"
          data-testid="review-refresh"
          disabled={query.isFetching}
          onClick={() => void refresh().catch(() => undefined)}
        >
          <RefreshCw size={16} aria-hidden />
          {t.refresh}
        </button>
      </div>
      {query.isLoading && (
        <div className="ar-stack" role="status" aria-busy="true">
          <p>{t.loading}</p>
          <div className="ar-skeleton" />
          <div className="ar-skeleton" />
        </div>
      )}
      {query.isError && (
        <ReviewBanner role="alert" tone="danger">
          {requestStatus(query.error) === 403
            ? t.forbidden
            : requestStatus(query.error) === 404
              ? t.notFound
              : t.failed}
          <div>
            <button
              className="ar-button"
              type="button"
              onClick={() => void refresh().catch(() => undefined)}
            >
              {t.retry}
            </button>
          </div>
        </ReviewBanner>
      )}
      {review && !denied && (
        <>
          <header className="ar-header">
            <div className="ar-person">
              <div className="ar-avatar" aria-hidden>
                {review.provider.displayName
                  .trim()
                  .split(/\s+/)
                  .slice(0, 2)
                  .map((name) => name[0])
                  .join('')}
              </div>
              <div>
                <span className="ar-eyebrow">{t.eyebrow}</span>
                <h1 className="ar-title" ref={headingRef} tabIndex={-1}>
                  <bdi dir="auto">{review.provider.displayName}</bdi>
                </h1>
                <div className="ar-meta">
                  {review.provider.email && (
                    <span>
                      <Mail size={15} aria-hidden />
                      <bdi>{review.provider.email}</bdi>
                    </span>
                  )}
                  {review.submission && (
                    <span>
                      {t.submittedAt}:{' '}
                      {formatReviewDate(review.submission.submittedAt, lang, t.notProvided)}
                    </span>
                  )}
                </div>
              </div>
            </div>
            <ReviewBadge tone={review.canWork ? 'success' : 'warning'}>
              <ShieldCheck size={16} aria-hidden />
              {review.canWork ? t.allowed : t.blocked}
            </ReviewBadge>
          </header>
          <div className="ar-status-grid">
            <div className="ar-status-cell">
              <span className="ar-muted">{t.account}</span>
              <StatusBadge value={review.provider.accountStatus} lang={lang} />
              {review.provider.standingState && (
                <StatusBadge value={review.provider.standingState} lang={lang} />
              )}
            </div>
            <div className="ar-status-cell">
              <span className="ar-muted">{t.application}</span>
              <StatusBadge value={review.provider.providerStatus} lang={lang} />
            </div>
            <div className="ar-status-cell">
              <span className="ar-muted">{t.identity}</span>
              <StatusBadge value={review.provider.verificationState ?? 'UNVERIFIED'} lang={lang} />
              {review.verification && (
                <small className="ar-muted">
                  {t.identityCaseState}: {statusLabel(review.verification.state, lang)}
                </small>
              )}
            </div>
            <div className="ar-status-cell">
              <span className="ar-muted">{t.access}</span>
              <ReviewBadge tone={review.canWork ? 'success' : 'neutral'}>
                {review.canWork ? t.allowed : t.blocked}
              </ReviewBadge>
            </div>
          </div>
          <a className="ar-button ar-mobile-decision" href="#review-decision-panel">
            {t.reviewPanel}
          </a>
          <div className="ar-layout">
            <div className="ar-stack">
              {review.submission && (
                <div className="ar-tabs" role="group" aria-label={t.application}>
                  {(['submitted', 'current'] as const).map((value) => (
                    <button
                      type="button"
                      className="ar-button"
                      key={value}
                      data-testid={`review-source-${value}`}
                      aria-pressed={selectedSource === value}
                      onClick={() => setSource(value)}
                    >
                      {value === 'submitted' ? t.submitted : t.current}
                    </button>
                  ))}
                </div>
              )}
              <ReviewBanner
                tone={
                  review.submission && selectedSource === 'submitted' && !snapshot
                    ? 'warning'
                    : 'neutral'
                }
              >
                {!review.submission
                  ? t.noSubmission
                  : selectedSource === 'current'
                    ? t.currentHint
                    : snapshot
                      ? t.sourceHint
                      : t.historicalMissing}
              </ReviewBanner>
              <ReviewTaskOverview review={review} snapshot={snapshot} lang={lang} />
              <ReviewDossier
                submittedSource={selectedSource === 'submitted'}
                review={review}
                snapshot={snapshot}
                lang={lang}
                identity={<ReviewIdentity review={review} lang={lang} onChanged={refresh} />}
                categories={<ReviewCategories review={review} lang={lang} onChanged={refresh} />}
                portfolio={<ReviewPortfolio review={review} lang={lang} onChanged={refresh} />}
              />
              <ReviewAccountActions
                providerProfileId={providerProfileId}
                lang={lang}
                onChanged={refresh}
              />
            </div>
            <ReviewDecisionPanel
              review={review}
              lang={lang}
              onChanged={refresh}
              onDecided={decided}
              readOnly={query.isError || query.isFetching}
            />
          </div>
        </>
      )}
    </div>
  );
}
