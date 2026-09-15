import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type {
  AdminVerificationQueueItem,
  AdminVerificationQueueQuery,
  VerificationCaseStateCode,
} from '@homeservicemarketplace/contracts';

import { useLang } from '../../../i18n/LanguageContext';
import { CASE_STATE_LABELS, UI } from '../copy/verification-copy';
import { listVerificationQueue } from '../queue/verification-queue-api';
import { useCursorHistory } from '../../admin-directory/hooks/useCursorHistory';
import {
  DirectoryPagination,
  directoryButton,
  directoryControl,
} from '../../admin-directory/components/DirectoryPrimitives';

// Sprint 9B.12 — the review queue.
//
// docs/sprint-09b12/ADMIN_VERIFICATION_UX.md
//
// Filters NARROW, never widen. Every one of them is sent to the server and
// applied there; nothing is filtered client-side after the fact, because a
// client-side filter over one page of a cursor-paged list shows "3 results"
// when the answer is thirty — and a reviewer working a backlog would believe
// the smaller number.
//
// An unusable filter value is an ERROR from the server rather than a silently
// dropped clause. The queue that comes back then genuinely matches what was
// asked for, which is the only way a reviewer can trust an empty result.

const STATES: VerificationCaseStateCode[] = [
  'SUBMITTED',
  'IN_REVIEW',
  'ACTION_REQUIRED',
  'VERIFIED',
  'REJECTED',
  'EXPIRED',
];

export interface VerificationQueuePanelProps {
  onOpenCase: (item: AdminVerificationQueueItem) => void;
  selectedCaseId?: string | null;
  locationState?: {
    filters: AdminVerificationQueueQuery;
    onFiltersChange: (filters: AdminVerificationQueueQuery) => void;
    pagination: ReturnType<typeof useCursorHistory>;
  };
}

export function VerificationQueuePanel({
  onOpenCase,
  selectedCaseId = null,
  locationState,
}: VerificationQueuePanelProps) {
  const { lang, dir } = useLang();
  const t = UI[lang];

  const [localFilters, setLocalFilters] = useState<AdminVerificationQueueQuery>({});
  const filters = locationState?.filters ?? localFilters;
  const setFilters = locationState?.onFiltersChange ?? setLocalFilters;
  const [searchDraft, setSearchDraft] = useState(filters.search ?? '');
  const [appliedSearch, setAppliedSearch] = useState(filters.search);
  if (appliedSearch !== filters.search) {
    setAppliedSearch(filters.search);
    setSearchDraft(filters.search ?? '');
  }
  const localPagination = useCursorHistory();
  const pagination = locationState?.pagination ?? localPagination;
  const pageFilters = { ...filters, ...(pagination.cursor ? { cursor: pagination.cursor } : {}) };

  const query = useQuery({
    queryKey: ['admin', 'verification', 'queue', pageFilters],
    queryFn: () => listVerificationQueue(pageFilters),
  });

  const set = (patch: Partial<AdminVerificationQueueQuery>) => {
    pagination.reset();
    const next = { ...filters, ...patch };
    // An empty control means "no filter", not "filter on empty string".
    for (const key of Object.keys(next) as Array<keyof AdminVerificationQueueQuery>) {
      if (next[key] === '' || next[key] === undefined) delete next[key];
    }
    setFilters(next);
  };

  const items = query.data?.items ?? [];
  const failureStatus = (query.error as { response?: { status?: number } } | null)?.response
    ?.status;

  return (
    <section
      aria-label={t.queueTitle}
      dir={dir}
      data-testid="verification-queue"
      className="ar-card ar-stack"
    >
      <h3 className="ar-heading">{t.queueTitle}</h3>

      {/* ── filters ──────────────────────────────────────────────────────── */}
      <div className="ar-case-filters">
        <div>
          <label className="ar-muted" htmlFor="queue-search">
            {t.searchLabel}
          </label>
          <input
            id="queue-search"
            data-testid="queue-search"
            value={searchDraft}
            onChange={(e) => setSearchDraft(e.target.value)}
            onKeyDown={(e) => {
              // Applied on Enter rather than on every keystroke: a request per
              // character turns a reviewer typing a name into a dozen queries
              // whose answers arrive out of order.
              if (e.key === 'Enter') set({ search: searchDraft.trim() || undefined });
            }}
            className={`${directoryControl} max-w-full`}
          />
        </div>

        <div>
          <label className="ar-muted" htmlFor="queue-state">
            {t.filterState}
          </label>
          <select
            id="queue-state"
            data-testid="queue-state"
            value={filters.state ?? ''}
            onChange={(e) => set({ state: (e.target.value || undefined) as never })}
            className={`${directoryControl} max-w-full`}
          >
            <option value="">{t.filterAll}</option>
            {STATES.map((s) => (
              <option key={s} value={s}>
                {CASE_STATE_LABELS[lang][s]}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="ar-muted" htmlFor="queue-policy">
            {t.filterPolicy}
          </label>
          <input
            id="queue-policy"
            data-testid="queue-policy"
            value={filters.policyVersion ?? ''}
            onChange={(e) => set({ policyVersion: e.target.value || undefined })}
            className={`${directoryControl} max-w-full`}
          />
        </div>

        <div>
          <label className="ar-muted" htmlFor="queue-from">
            {t.filterFrom}
          </label>
          <input
            id="queue-from"
            type="date"
            data-testid="queue-from"
            value={filters.submittedFrom ?? ''}
            onChange={(e) => set({ submittedFrom: e.target.value || undefined })}
            className={`${directoryControl} max-w-full`}
          />
        </div>

        <div>
          <label className="ar-muted" htmlFor="queue-to">
            {t.filterTo}
          </label>
          <input
            id="queue-to"
            type="date"
            data-testid="queue-to"
            value={filters.submittedTo ?? ''}
            onChange={(e) => set({ submittedTo: e.target.value || undefined })}
            className={`${directoryControl} max-w-full`}
          />
        </div>

        <button
          type="button"
          className={directoryButton}
          onClick={() => set({ search: searchDraft.trim() || undefined })}
        >
          {lang === 'ar' ? 'بحث' : 'Search'}
        </button>
        <button
          type="button"
          data-testid="queue-clear"
          onClick={() => {
            pagination.reset();
            setFilters({});
            setSearchDraft('');
          }}
          className={directoryButton}
        >
          {t.clearFilters}
        </button>
      </div>

      {/* ── the list ─────────────────────────────────────────────────────── */}
      {query.isLoading && (
        <p aria-busy="true" data-testid="queue-loading" className="text-sm">
          {t.loading}
        </p>
      )}

      {query.isError && (
        <div role="alert" data-testid="queue-error">
          {/* A permission failure is a different message from a broken filter,
              and both are different from "nothing to review". */}
          <p className="text-sm font-semibold">
            {failureStatus === 403 ? t.forbiddenTitle : t.failed}
          </p>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            {failureStatus === 403 ? t.forbiddenBody : ''}
          </p>
          {failureStatus !== 403 && (
            <button
              type="button"
              onClick={() => void query.refetch()}
              className="mt-1 text-sm font-semibold underline"
            >
              {t.reload}
            </button>
          )}
        </div>
      )}

      {!query.isLoading && !query.isError && items.length === 0 && (
        <p data-testid="queue-empty" className="text-sm text-slate-600 dark:text-slate-300">
          {t.queueEmpty}
        </p>
      )}

      {!query.isError && items.length > 0 && (
        <div className="overflow-x-auto" role="region" aria-label={t.queueTitle} tabIndex={0}>
          <table className="w-full text-sm ar-case-table" data-testid="queue-table">
            <thead>
              <tr className="text-start">
                <th scope="col" className="p-2 text-start">
                  {t.searchLabel}
                </th>
                <th scope="col" className="p-2 text-start">
                  {t.filterState}
                </th>
                <th scope="col" className="p-2 text-start">
                  {t.policyVersion}
                </th>
                <th scope="col" className="p-2 text-start">
                  {t.submitted}
                </th>
                <th scope="col" className="p-2 text-start">
                  {t.documentsCount}
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr
                  key={item.id}
                  data-testid={`queue-row-${item.id}`}
                  data-selected={item.id === selectedCaseId ? 'true' : 'false'}
                >
                  <td className="p-2">
                    <button
                      type="button"
                      onClick={() => onOpenCase(item)}
                      className="min-h-11 font-semibold underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
                    >
                      {item.providerDisplayName ?? item.providerProfileId}
                    </button>
                  </td>
                  <td className="p-2">{CASE_STATE_LABELS[lang][item.state]}</td>
                  <td className="p-2">
                    <bdi>{item.policyVersion}</bdi>
                  </td>
                  <td className="p-2">
                    {item.submittedAt ? new Date(item.submittedAt).toLocaleDateString(lang) : '—'}
                  </td>
                  <td className="p-2">{item.documentCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <DirectoryPagination
        nextCursor={query.isError ? null : query.data?.nextCursor}
        onNext={pagination.nextPage}
        onPrevious={pagination.previousPage}
        hasPrevious={pagination.hasPrevious}
        pending={query.isFetching}
        count={items.length}
        isAr={lang === 'ar'}
      />
    </section>
  );
}
