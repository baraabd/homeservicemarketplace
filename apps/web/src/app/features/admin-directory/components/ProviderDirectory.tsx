import { Link, useLocation } from 'react-router';
import {
  ArrowLeft,
  ArrowRight,
  BriefcaseBusiness,
  ClipboardCheck,
  Inbox,
  RefreshCw,
} from 'lucide-react';
import type {
  ListAdminProvidersQuery,
  ListAdminProvidersResponse,
} from '@homeservicemarketplace/contracts';
import { useLang } from '../../../i18n/LanguageContext';
import { useAdminProviders } from '../../../hooks/admin/useAdminProviders';
import { useDirectoryLocation } from '../hooks/useDirectoryLocation';
import { DIRECTORY_COPY, PROVIDER_STATUS_LABELS } from '../copy';
import { DirectoryError, DirectoryPagination } from './DirectoryPrimitives';
import { ProviderDirectoryRow } from './ProviderDirectoryRow';
import {
  ASSIGNMENT_OPTIONS,
  DIRECTORY_STATUSES,
  IDENTITY_STATES,
  PORTFOLIO_STATES,
  SORT_OPTIONS,
} from '../filters';
import { ProviderDirectoryFilters } from './ProviderDirectoryFilters';
import '../../admin-provider-review/admin-review.css';
import '../admin-directory.css';

function knownValue<T extends string>(value: string | null, options: readonly T[]): T | undefined {
  return options.find((option) => option === value);
}

const COUNT_KEYS: Record<string, keyof NonNullable<ListAdminProvidersResponse['counts']>> = {
  ALL: 'all',
  PENDING_REVIEW: 'pendingReview',
  ACTIVE: 'active',
  REJECTED: 'returned',
};

/** Separate lifecycle and operational views share only the factual rows and query boundary. */
export function ProviderDirectory({ reviewQueue = false }: { reviewQueue?: boolean }) {
  const { lang, dir, darkMode } = useLang();
  const t = DIRECTORY_COPY[lang];
  const location = useLocation();
  const list = useDirectoryLocation();
  const queueStatuses = ['PENDING_REVIEW', 'REJECTED'] as const;
  const filters: ListAdminProvidersQuery = {
    status:
      knownValue(list.params.get('status'), reviewQueue ? queueStatuses : DIRECTORY_STATUSES) ??
      (reviewQueue ? 'PENDING_REVIEW' : 'ALL'),
    query: list.params.get('query') || undefined,
    userId: list.params.get('userId') || undefined,
    sort:
      knownValue(list.params.get('sort'), SORT_OPTIONS) ??
      (reviewQueue ? 'SUBMITTED_OLDEST' : 'UPDATED_NEWEST'),
    assignment: knownValue(list.params.get('assignment'), ASSIGNMENT_OPTIONS),
    identityState: knownValue(list.params.get('identityState'), IDENTITY_STATES),
    portfolioState: knownValue(list.params.get('portfolioState'), PORTFOLIO_STATES),
    country: list.params.get('country') || undefined,
    submittedFrom: list.params.get('submittedFrom') || undefined,
    submittedTo: list.params.get('submittedTo') || undefined,
    cursor: list.cursor,
    limit: 50,
  };
  const query = useAdminProviders(filters);
  const data = query.isError ? undefined : query.data;
  const items = data?.items ?? [];
  const title = reviewQueue ? t.queue : t.directory;
  const DirectionArrow = dir === 'rtl' ? ArrowLeft : ArrowRight;
  const returnTo = `${location.pathname}${location.search}`;
  function clearFilters() {
    list.filter(Object.fromEntries([...list.params.keys()].map((key) => [key, undefined])));
  }
  return (
    <section
      aria-label={title}
      className={`admin-review admin-directory ar-stack${darkMode ? ' dark' : ''}`}
      dir={dir}
      lang={lang}
      data-testid={reviewQueue ? 'admin-review-directory' : 'admin-provider-directory'}
    >
      <header className="ad-page-header">
        <div className="ad-header-main">
          <span className="ad-header-icon" aria-hidden>
            {reviewQueue ? <ClipboardCheck size={26} /> : <BriefcaseBusiness size={26} />}
          </span>
          <div>
            <p className="ar-eyebrow">{reviewQueue ? t.queueEyebrow : t.directoryEyebrow}</p>
            <h2 className="ar-title">{title}</h2>
            <p className="ad-description ar-muted">
              {reviewQueue ? t.queueDescription : t.directoryDescription}
            </p>
          </div>
        </div>
        <div className="ad-header-actions">
          <button
            type="button"
            className="ar-button"
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
          >
            <RefreshCw size={17} aria-hidden />
            {t.refresh}
          </button>
          <Link className="ar-button" to={reviewQueue ? '/admin/providers' : '/admin/reviews'}>
            {reviewQueue ? t.openDirectory : t.openQueue}
            <DirectionArrow size={17} aria-hidden />
          </Link>
        </div>
      </header>

      <div className={`ad-overview${reviewQueue ? ' ad-queue-overview' : ''}`}>
        {reviewQueue ? (
          <div className="ad-queue-guide">
            <span className="ad-guide-icon">
              <ClipboardCheck size={24} aria-hidden />
            </span>
            <div>
              <h3>{filters.sort === 'SUBMITTED_OLDEST' ? t.queueOrder : t.queue}</h3>
              <p>{t.queueOrderHint}</p>
            </div>
          </div>
        ) : null}
        <div className="ad-count-grid" aria-label={t.status}>
          {(reviewQueue
            ? ['PENDING_REVIEW', 'REJECTED']
            : ['ALL', 'PENDING_REVIEW', 'ACTIVE', 'REJECTED']
          ).map((status) => (
            <button
              key={status}
              type="button"
              className={`ad-count-card${filters.status === status ? ' ad-count-selected' : ''}`}
              aria-pressed={filters.status === status}
              onClick={() => list.filter({ status })}
            >
              <span>{PROVIDER_STATUS_LABELS[status][lang]}</span>
              <strong data-testid={`directory-count-${status}`}>
                {data?.counts ? data.counts[COUNT_KEYS[status]].toLocaleString(lang) : '—'}
              </strong>
            </button>
          ))}
        </div>
      </div>
      <p className="ad-count-hint ar-muted">{t.countsHint}</p>
      <ProviderDirectoryFilters
        params={list.params}
        filters={filters}
        filter={list.filter}
        clear={clearFilters}
        lang={lang}
        reviewQueue={reviewQueue}
      />
      <div className="ar-card ad-results" aria-busy={query.isFetching}>
        <header className="ad-results-heading">
          <div>
            <h3>{reviewQueue ? t.queue : t.searchResults}</h3>
            <p className="ar-muted">
              {reviewQueue
                ? filters.sort === 'SUBMITTED_OLDEST'
                  ? t.oldest
                  : t.recent
                : t.directoryOrderHint}
            </p>
          </div>
          <p className="ad-total" role="status">
            <span>{reviewQueue ? t.requestCount : t.matching}</span>
            <strong data-testid="directory-total">
              {data?.total === undefined ? '—' : data.total.toLocaleString(lang)}
            </strong>
          </p>
        </header>
        {query.isPending ? (
          <div className="ad-empty" role="status">
            <RefreshCw size={28} aria-hidden />
            <p>{t.loading}</p>
          </div>
        ) : query.isError ? (
          <DirectoryError
            error={query.error}
            onRetry={() => void query.refetch()}
            isAr={lang === 'ar'}
          />
        ) : items.length === 0 ? (
          <div className="ad-empty" role="status">
            <Inbox size={34} aria-hidden />
            <h3>{reviewQueue ? t.emptyQueue : t.empty}</h3>
            <p>{reviewQueue ? t.emptyQueueHint : t.emptyHint}</p>
            {list.params.size > 0 ? (
              <button type="button" className="ar-button" onClick={clearFilters}>
                {t.clear}
              </button>
            ) : null}
          </div>
        ) : (
          <ul className="ad-provider-list">
            {items.map((provider) => (
              <ProviderDirectoryRow
                key={provider.id}
                provider={provider}
                lang={lang}
                reviewQueue={reviewQueue}
                returnTo={returnTo}
                locationState={location.state}
                checkedAt={query.dataUpdatedAt}
              />
            ))}
          </ul>
        )}
        <DirectoryPagination
          nextCursor={data?.nextCursor}
          onNext={list.nextPage}
          onPrevious={list.previousPage}
          hasPrevious={list.hasPrevious}
          previousIsFirst={list.previousIsFirst}
          pending={query.isFetching}
          count={items.length}
          isAr={lang === 'ar'}
        />
      </div>
    </section>
  );
}
