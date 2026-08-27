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
}

export function VerificationQueuePanel({
  onOpenCase,
  selectedCaseId = null,
}: VerificationQueuePanelProps) {
  const { lang, dir } = useLang();
  const t = UI[lang];

  const [filters, setFilters] = useState<AdminVerificationQueueQuery>({});
  const [searchDraft, setSearchDraft] = useState('');

  const query = useQuery({
    queryKey: ['admin', 'verification', 'queue', filters],
    queryFn: () => listVerificationQueue(filters),
  });

  const set = (patch: Partial<AdminVerificationQueueQuery>) =>
    setFilters((f) => {
      const next = { ...f, ...patch };
      // An empty control means "no filter", not "filter on empty string".
      for (const key of Object.keys(next) as Array<keyof AdminVerificationQueueQuery>) {
        if (next[key] === '' || next[key] === undefined) delete next[key];
      }
      return next;
    });

  const items = query.data?.items ?? [];
  const failureStatus = (query.error as { response?: { status?: number } } | null)?.response
    ?.status;

  return (
    <section
      aria-label={t.queueTitle}
      dir={dir}
      data-testid="verification-queue"
      className="space-y-3"
    >
      <h3 className="text-base font-semibold">{t.queueTitle}</h3>

      {/* ── filters ──────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-2">
        <div>
          <label className="block text-xs" htmlFor="queue-search">
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
            className="rounded-lg border px-2 py-1.5 text-sm"
          />
        </div>

        <div>
          <label className="block text-xs" htmlFor="queue-state">
            {t.filterState}
          </label>
          <select
            id="queue-state"
            data-testid="queue-state"
            value={filters.state ?? ''}
            onChange={(e) => set({ state: (e.target.value || undefined) as never })}
            className="rounded-lg border px-2 py-1.5 text-sm"
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
          <label className="block text-xs" htmlFor="queue-policy">
            {t.filterPolicy}
          </label>
          <input
            id="queue-policy"
            data-testid="queue-policy"
            value={filters.policyVersion ?? ''}
            onChange={(e) => set({ policyVersion: e.target.value || undefined })}
            className="rounded-lg border px-2 py-1.5 text-sm"
          />
        </div>

        <div>
          <label className="block text-xs" htmlFor="queue-from">
            {t.filterFrom}
          </label>
          <input
            id="queue-from"
            type="date"
            data-testid="queue-from"
            value={filters.submittedFrom ?? ''}
            onChange={(e) => set({ submittedFrom: e.target.value || undefined })}
            className="rounded-lg border px-2 py-1.5 text-sm"
          />
        </div>

        <div>
          <label className="block text-xs" htmlFor="queue-to">
            {t.filterTo}
          </label>
          <input
            id="queue-to"
            type="date"
            data-testid="queue-to"
            value={filters.submittedTo ?? ''}
            onChange={(e) => set({ submittedTo: e.target.value || undefined })}
            className="rounded-lg border px-2 py-1.5 text-sm"
          />
        </div>

        <button
          type="button"
          data-testid="queue-clear"
          onClick={() => {
            setFilters({});
            setSearchDraft('');
          }}
          className="self-end rounded-lg border px-3 py-1.5 text-sm font-semibold"
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

      {items.length > 0 && (
        <table className="w-full text-sm" data-testid="queue-table">
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
                    className="font-semibold underline"
                  >
                    {item.providerDisplayName ?? item.providerProfileId}
                  </button>
                </td>
                <td className="p-2">{CASE_STATE_LABELS[lang][item.state]}</td>
                <td className="p-2">{item.policyVersion}</td>
                <td className="p-2">
                  {item.submittedAt ? new Date(item.submittedAt).toLocaleDateString(lang) : '—'}
                </td>
                <td className="p-2">{item.documentCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
