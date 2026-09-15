import { SlidersHorizontal } from 'lucide-react';
import type { ListAdminProvidersQuery } from '@homeservicemarketplace/contracts';
import { statusLabel, type ReviewLanguage } from '../../admin-provider-review/copy';
import { DIRECTORY_COPY, PROVIDER_STATUS_LABELS } from '../copy';
import { DirectorySearch } from './DirectoryPrimitives';
import { DIRECTORY_STATUSES, IDENTITY_STATES, PORTFOLIO_STATES } from '../filters';

export function ProviderDirectoryFilters({
  params,
  filters,
  filter,
  clear,
  lang,
  reviewQueue,
}: {
  params: URLSearchParams;
  filters: ListAdminProvidersQuery;
  filter: (patch: Record<string, string | undefined>) => void;
  clear: () => void;
  lang: ReviewLanguage;
  reviewQueue: boolean;
}) {
  const t = DIRECTORY_COPY[lang];
  const hasFilters = [...params.keys()].some((key) => !['cursor', 'previousCursor'].includes(key));
  return (
    <div className="ar-card ad-filter-card">
      <div className="ad-search-row">
        <DirectorySearch
          semantic
          value={params.get('query') ?? ''}
          onSearch={(query) => filter({ query: query || undefined })}
          isAr={lang === 'ar'}
        />
        <label className="ad-filter-label">
          <span>{t.sort}</span>
          <select
            className="ar-input"
            value={filters.sort}
            onChange={(event) => filter({ sort: event.target.value })}
          >
            <option value="SUBMITTED_OLDEST">{t.oldest}</option>
            <option value="UPDATED_NEWEST">{t.recent}</option>
          </select>
        </label>
      </div>
      <div className="ad-filter-grid">
        <label className="ad-filter-label">
          <span>{t.status}</span>
          <select
            className="ar-input"
            value={filters.status}
            onChange={(event) => filter({ status: event.target.value })}
          >
            {(reviewQueue ? ['PENDING_REVIEW', 'REJECTED'] : DIRECTORY_STATUSES).map((value) => (
              <option key={value} value={value}>
                {PROVIDER_STATUS_LABELS[value][lang]}
              </option>
            ))}
          </select>
        </label>
        <label className="ad-filter-label">
          <span>{t.assignment}</span>
          <select
            className="ar-input"
            value={filters.assignment ?? 'ALL'}
            onChange={(event) =>
              filter({ assignment: event.target.value === 'ALL' ? undefined : event.target.value })
            }
          >
            <option value="ALL">{t.allReviewers}</option>
            <option value="UNASSIGNED">{t.unassigned}</option>
            <option value="MINE">{t.assignedToMe}</option>
          </select>
        </label>
        <label className="ad-filter-label">
          <span>{t.identity}</span>
          <select
            className="ar-input"
            value={filters.identityState ?? ''}
            onChange={(event) => filter({ identityState: event.target.value || undefined })}
          >
            <option value="">{t.allIdentity}</option>
            {IDENTITY_STATES.map((value) => (
              <option key={value} value={value}>
                {statusLabel(value, lang)}
              </option>
            ))}
          </select>
        </label>
        <label className="ad-filter-label">
          <span>{t.portfolio}</span>
          <select
            className="ar-input"
            value={filters.portfolioState ?? ''}
            onChange={(event) => filter({ portfolioState: event.target.value || undefined })}
          >
            <option value="">{t.allPortfolio}</option>
            {PORTFOLIO_STATES.map((value) => (
              <option key={value} value={value}>
                {statusLabel(value, lang)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="ad-filter-bottom">
        <details
          className="ad-advanced-filters"
          open={
            params.has('country') ||
            params.has('submittedFrom') ||
            params.has('submittedTo') ||
            undefined
          }
        >
          <summary>
            <SlidersHorizontal size={16} aria-hidden />
            {t.advanced}
          </summary>
          <div className="ad-filter-grid ad-date-filters">
            <label className="ad-filter-label">
              <span>{t.country}</span>
              <input
                className="ar-input"
                dir="ltr"
                placeholder={t.countryHint}
                maxLength={2}
                key={params.get('country') ?? ''}
                defaultValue={params.get('country') ?? ''}
                pattern="[A-Za-z]{2}"
                onBlur={(event) => {
                  const country = event.target.value.toUpperCase();
                  if (event.target.reportValidity() && country !== (params.get('country') ?? ''))
                    filter({ country: country || undefined });
                }}
              />
            </label>
            <label className="ad-filter-label">
              <span>{t.submittedFrom}</span>
              <input
                className="ar-input"
                type="date"
                value={params.get('submittedFrom') ?? ''}
                max={params.get('submittedTo') ?? undefined}
                onChange={(event) => filter({ submittedFrom: event.target.value || undefined })}
              />
            </label>
            <label className="ad-filter-label">
              <span>{t.submittedTo}</span>
              <input
                className="ar-input"
                type="date"
                value={params.get('submittedTo') ?? ''}
                min={params.get('submittedFrom') ?? undefined}
                onChange={(event) => filter({ submittedTo: event.target.value || undefined })}
              />
            </label>
          </div>
          <p className="ar-muted">{t.datesTimezone}</p>
        </details>
        {hasFilters ? (
          <button type="button" className="ar-button" onClick={clear}>
            {t.clear}
          </button>
        ) : null}
      </div>
      {params.has('userId') ? (
        <div className="ad-account-filter">
          <span>{t.accountFilter}</span>
          <button type="button" className="ar-button" onClick={() => filter({ userId: undefined })}>
            {t.showAccounts}
          </button>
        </div>
      ) : null}
    </div>
  );
}
