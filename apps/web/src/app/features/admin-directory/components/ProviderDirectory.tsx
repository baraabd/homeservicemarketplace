import { Link, useLocation } from 'react-router';
import { BriefcaseBusiness, ClipboardCheck } from 'lucide-react';
import type { ListAdminProvidersQuery } from '@homeservicemarketplace/contracts';
import { useLang } from '../../../i18n/LanguageContext';
import { useAdminProviders } from '../../../hooks/admin/useAdminProviders';
import { useDirectoryLocation } from '../hooks/useDirectoryLocation';
import {
  DirectoryError,
  DirectoryPagination,
  DirectorySearch,
  directoryControl,
  directoryPrimary,
  directorySurface,
} from './DirectoryPrimitives';

const statuses = ['ALL', 'DRAFT', 'PENDING_REVIEW', 'ACTIVE', 'REJECTED', 'SUSPENDED'] as const;
const labels: Record<string, { en: string; ar: string }> = {
  ALL: { en: 'All statuses', ar: 'كل الحالات' },
  DRAFT: { en: 'Draft', ar: 'مسودة' },
  PENDING_REVIEW: { en: 'Awaiting review', ar: 'بانتظار المراجعة' },
  ACTIVE: { en: 'Accepted', ar: 'مقبول' },
  REJECTED: { en: 'Returned / rejected', ar: 'معاد للتعديل / مرفوض' },
  SUSPENDED: { en: 'Suspended', ar: 'معلّق' },
};

export function ProviderDirectory({ reviewQueue = false }: { reviewQueue?: boolean }) {
  const { lang } = useLang();
  const isAr = lang === 'ar';
  const location = useLocation();
  const list = useDirectoryLocation();
  const status = (list.params.get('status') ||
    (reviewQueue ? 'PENDING_REVIEW' : 'ALL')) as ListAdminProvidersQuery['status'];
  const query = useAdminProviders({
    status,
    query: list.params.get('query') || undefined,
    userId: list.params.get('userId') || undefined,
    cursor: list.cursor,
    limit: 50,
  });
  const items = query.data?.items ?? [];
  const returnTo = `${location.pathname}${location.search}`;
  const title = reviewQueue
    ? isAr
      ? 'طلبات المهنيين'
      : 'Provider applications'
    : isAr
      ? 'دليل المهنيين'
      : 'Provider directory';
  const description = reviewQueue
    ? isAr
      ? 'راجع بيانات التسجيل والهوية والأعمال، ثم اتخذ القرار من ملف المهني.'
      : 'Review registration details, identity and portfolio, then decide from the provider file.'
    : isAr
      ? 'جميع ملفات المهنيين، من المسودة إلى القبول. حالة القبول مستقلة عن صلاحية العمل الفعلية.'
      : 'Every provider profile, from draft to accepted. Acceptance and current work access are separate facts.';
  return (
    <section
      aria-label={title}
      className="space-y-5"
      data-testid={reviewQueue ? 'admin-review-directory' : 'admin-provider-directory'}
    >
      <header className="flex items-start gap-3">
        <div className="rounded-2xl bg-amber-100 p-3 text-amber-800 dark:bg-amber-950 dark:text-amber-300">
          {reviewQueue ? <ClipboardCheck size={24} /> : <BriefcaseBusiness size={24} />}
        </div>
        <div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-white">{title}</h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-300">
            {description}
          </p>
        </div>
      </header>
      <div className={`${directorySurface} flex flex-wrap gap-3 p-4`}>
        <DirectorySearch
          value={list.params.get('query') ?? ''}
          onSearch={(value) => list.filter({ query: value || undefined })}
          isAr={isAr}
        />
        <select
          aria-label={isAr ? 'حالة ملف المهني' : 'Provider profile status'}
          value={status}
          onChange={(event) => list.filter({ status: event.target.value })}
          className={`${directoryControl} w-full sm:w-auto`}
        >
          {statuses.map((value) => (
            <option key={value} value={value}>
              {labels[value][lang]}
            </option>
          ))}
        </select>
        {list.params.has('userId') && (
          <button
            type="button"
            onClick={() => list.filter({ userId: undefined })}
            className={directoryPrimary}
          >
            {isAr ? 'عرض جميع الحسابات' : 'Show all accounts'}
          </button>
        )}
      </div>
      <div className={`${directorySurface} overflow-hidden`} aria-busy={query.isFetching}>
        {query.isPending ? (
          <p role="status" className="p-8 text-slate-500">
            {isAr ? 'جارٍ تحميل المهنيين…' : 'Loading providers…'}
          </p>
        ) : query.isError ? (
          <DirectoryError error={query.error} onRetry={() => void query.refetch()} isAr={isAr} />
        ) : items.length === 0 ? (
          <p role="status" className="p-8 text-slate-500 dark:text-slate-400">
            {isAr ? 'لا توجد ملفات مطابقة للفلاتر.' : 'No profiles match these filters.'}
          </p>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-700">
            {items.map((provider) => (
              <li
                key={provider.id}
                className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:p-5"
              >
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  <span
                    aria-hidden="true"
                    className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-slate-100 font-bold text-slate-600 dark:bg-slate-700 dark:text-slate-200"
                  >
                    {provider.initials}
                  </span>
                  <div className="min-w-0">
                    <p className="break-words font-semibold text-slate-900 dark:text-white">
                      {provider.displayName}
                    </p>
                    <p className="break-all text-sm text-slate-500 dark:text-slate-400" dir="ltr">
                      {provider.email ?? '—'}
                    </p>
                    <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                      {[provider.serviceAreaCity, provider.serviceAreaCountry]
                        .filter(Boolean)
                        .join(' · ') || (isAr ? 'الموقع غير مكتمل' : 'Location incomplete')}
                    </p>
                  </div>
                </div>
                <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 sm:justify-end">
                  <div className="space-y-1">
                    <span className="inline-flex rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700 dark:bg-slate-700 dark:text-slate-200">
                      {labels[provider.status]?.[lang] ?? provider.status}
                    </span>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {provider.submittedForReviewAt
                        ? `${isAr ? 'أُرسل' : 'Submitted'} ${new Date(provider.submittedForReviewAt).toLocaleDateString(lang)}`
                        : isAr
                          ? 'لم يُرسل بعد'
                          : 'Not submitted yet'}
                    </p>
                  </div>
                  <Link
                    className={directoryPrimary}
                    state={location.state}
                    to={`/admin/providers/${encodeURIComponent(provider.id)}?returnTo=${encodeURIComponent(returnTo)}`}
                    aria-label={`${isAr ? 'فتح ملف' : 'Open profile'} ${provider.displayName}`}
                  >
                    {isAr ? 'فتح الملف' : 'Open profile'}
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
        <DirectoryPagination
          nextCursor={query.isError ? null : query.data?.nextCursor}
          onNext={list.nextPage}
          onPrevious={list.previousPage}
          hasPrevious={list.hasPrevious}
          previousIsFirst={list.previousIsFirst}
          pending={query.isFetching}
          count={items.length}
          isAr={isAr}
        />
      </div>
    </section>
  );
}
