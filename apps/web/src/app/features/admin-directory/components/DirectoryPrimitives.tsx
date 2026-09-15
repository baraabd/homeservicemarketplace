import { ArrowLeft, ArrowRight, RefreshCw, Search } from 'lucide-react';
import { useState } from 'react';

export const directoryControl =
  'min-h-11 rounded-xl border border-slate-300 bg-white px-3 py-2 text-base text-slate-900 outline-none focus-visible:ring-2 focus-visible:ring-amber-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100';
export const directoryButton =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800';
export const directoryPrimary =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-amber-500 px-4 py-2 text-sm font-bold text-slate-950 hover:bg-amber-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600 focus-visible:ring-offset-2 disabled:opacity-50';
export const directorySurface =
  'rounded-2xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800';

export function DirectorySearch({
  value,
  onSearch,
  isAr,
  semantic = false,
}: {
  semantic?: boolean;
  value: string;
  onSearch: (value: string) => void;
  isAr: boolean;
}) {
  const [draft, setDraft] = useState(value);
  const [previousValue, setPreviousValue] = useState(value);
  if (previousValue !== value) {
    setPreviousValue(value);
    setDraft(value);
  }
  const label = isAr ? 'ابحث بالبريد أو الاسم' : 'Search by email or name';
  return (
    <form
      className="flex w-full min-w-0 gap-2 sm:w-auto sm:flex-1"
      onSubmit={(event) => {
        event.preventDefault();
        onSearch(draft.trim());
      }}
    >
      <div className="relative min-w-0 flex-1">
        <Search aria-hidden="true" size={18} className="absolute start-3 top-3 text-slate-400" />
        <input
          type="search"
          maxLength={200}
          aria-label={label}
          placeholder={label}
          className={`${semantic ? 'ar-input' : directoryControl} w-full ps-10`}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
      </div>
      <button type="submit" className={semantic ? 'ar-button ar-button-primary' : directoryPrimary}>
        {isAr ? 'بحث' : 'Search'}
      </button>
    </form>
  );
}

export function DirectoryPagination({
  nextCursor,
  onNext,
  onPrevious,
  hasPrevious,
  previousIsFirst = false,
  pending,
  count,
  isAr,
}: {
  nextCursor?: string | null;
  onNext: (cursor: string) => void;
  onPrevious: () => void;
  hasPrevious: boolean;
  previousIsFirst?: boolean;
  pending: boolean;
  count: number;
  isAr: boolean;
}) {
  return (
    <nav
      aria-label={isAr ? 'صفحات النتائج' : 'Result pages'}
      className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 p-4 dark:border-slate-700"
    >
      <p role="status" className="text-sm text-slate-500 dark:text-slate-400">
        {isAr ? `${count.toLocaleString('ar')} في هذه الصفحة` : `${count} on this page`}
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={directoryButton}
          disabled={!hasPrevious || pending}
          onClick={onPrevious}
        >
          {isAr ? <ArrowRight size={16} /> : <ArrowLeft size={16} />}
          {previousIsFirst && hasPrevious
            ? isAr
              ? 'الصفحة الأولى'
              : 'First page'
            : isAr
              ? 'السابق'
              : 'Previous'}
        </button>
        <button
          type="button"
          className={directoryButton}
          disabled={!nextCursor || pending}
          onClick={() => nextCursor && onNext(nextCursor)}
        >
          {isAr ? 'التالي' : 'Next'}
          {isAr ? <ArrowLeft size={16} /> : <ArrowRight size={16} />}
        </button>
      </div>
    </nav>
  );
}

export function DirectoryError({
  error,
  onRetry,
  isAr,
}: {
  error: unknown;
  onRetry: () => void;
  isAr: boolean;
}) {
  const forbidden = (error as { response?: { status?: number } })?.response?.status === 403;
  return (
    <div role="alert" className="space-y-3 p-6 text-sm text-rose-700 dark:text-rose-300">
      <p>
        {forbidden
          ? isAr
            ? 'ليس لديك صلاحية عرض هذه البيانات.'
            : 'You do not have permission to view this information.'
          : isAr
            ? 'تعذّر تحميل البيانات. حاول مرة أخرى.'
            : 'Could not load data. Please try again.'}
      </p>
      {!forbidden && (
        <button type="button" className={directoryButton} onClick={onRetry}>
          <RefreshCw size={16} />
          {isAr ? 'إعادة المحاولة' : 'Retry'}
        </button>
      )}
    </div>
  );
}
