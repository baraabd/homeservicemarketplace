import { useInfiniteQuery } from '@tanstack/react-query';
import type { AdminProviderReviewHistoryKind } from '@homeservicemarketplace/contracts';
import { getProviderReviewHistory, requestStatus, reviewHistoryQueryKey } from '../api';
import { formatReviewDate } from '../format-review-date';
import { REVIEW_COPY, TASK_LABELS, type ReviewLanguage } from '../copy';
import { reviewCorrectionFieldLabel } from '../../provider-onboarding-v2/copy/review-correction-fields';
import { ReviewBanner } from './ReviewPrimitives';

const LABELS: Record<AdminProviderReviewHistoryKind, { en: string; ar: string }> = {
  SUBMITTED: { en: 'Application submitted', ar: 'أُرسل الطلب للمراجعة' },
  WITHDRAWN: { en: 'Application withdrawn', ar: 'سحب المهني الطلب للتعديل' },
  APPROVED: { en: 'Application approved', ar: 'تمت الموافقة على الطلب' },
  CHANGES_REQUESTED: { en: 'Application returned for changes', ar: 'أُعيد الطلب للتصحيح' },
  REJECTED: { en: 'Application rejected', ar: 'رُفض الطلب' },
  SUSPENDED: { en: 'Professional suspended', ar: 'أُوقف حساب المهني' },
  REACTIVATED: { en: 'Suspension lifted', ar: 'رُفع الإيقاف عن المهني' },
  NOTES_UPDATED: { en: 'Internal notes updated', ar: 'حُدّثت الملاحظات الداخلية' },
  CATEGORY_APPROVED: { en: 'Service approved', ar: 'تمت الموافقة على الخدمة' },
  CATEGORY_REJECTED: { en: 'Service rejected', ar: 'رُفضت الخدمة' },
  IDENTITY_SUBMITTED: { en: 'Identity submitted', ar: 'أُرسلت الهوية للمراجعة' },
  IDENTITY_ASSIGNED: { en: 'Identity review assigned', ar: 'أُسندت مراجعة الهوية' },
  IDENTITY_CHANGES_REQUESTED: { en: 'Identity changes requested', ar: 'طُلب تصحيح وثائق الهوية' },
  IDENTITY_REJECTED: { en: 'Identity rejected', ar: 'رُفضت وثائق الهوية' },
  IDENTITY_APPROVED: { en: 'Identity verified', ar: 'تم توثيق الهوية' },
  IDENTITY_REVOKED: { en: 'Verification revoked', ar: 'أُلغي التوثيق' },
  IDENTITY_REVERIFY_REQUIRED: { en: 'Verification requested again', ar: 'طُلب تجديد التوثيق' },
  IDENTITY_EXPIRED: { en: 'Verification expired', ar: 'انتهت صلاحية التوثيق' },
  PORTFOLIO_APPROVED: { en: 'Portfolio image approved', ar: 'تمت الموافقة على صورة العمل' },
  PORTFOLIO_REJECTED: { en: 'Portfolio image returned', ar: 'أُعيدت صورة العمل للتصحيح' },
  PORTFOLIO_UPDATED: { en: 'Portfolio image updated', ar: 'حُدّثت صورة العمل' },
};

export function ReviewHistory({ providerId, lang }: { providerId: string; lang: ReviewLanguage }) {
  const t = REVIEW_COPY[lang];
  const query = useInfiniteQuery({
    queryKey: reviewHistoryQueryKey(providerId),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) => getProviderReviewHistory(providerId, pageParam, signal),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    retry: false,
  });
  const items = query.data?.pages.flatMap((page) => page.items) ?? [];
  const forbidden = requestStatus(query.error) === 403;
  return (
    <section className="ar-stack" aria-label={t.history} data-testid="review-history">
      <div className="ar-subheader">
        <h3 className="ar-subheading">{t.history}</h3>
        <button
          type="button"
          className="ar-button"
          disabled={query.isFetching}
          onClick={() => void query.refetch()}
        >
          {t.refresh}
        </button>
      </div>
      <p className="ar-muted">
        {lang === 'ar'
          ? 'قرارات الطلب والهوية والخدمات والمعرض، من الأحدث إلى الأقدم. تُعرض نسخة الطلب فقط عندما سُجل ارتباط القرار بها.'
          : 'Application, identity, service and portfolio decisions, newest first. A submission is shown only when the event recorded its exact reference.'}
      </p>
      {query.isPending && (
        <p role="status" className="ar-muted">
          {lang === 'ar' ? 'جارٍ تحميل السجل…' : 'Loading history…'}
        </p>
      )}
      {query.isError && (
        <ReviewBanner tone="danger" role="alert">
          {forbidden
            ? lang === 'ar'
              ? 'ليست لديك صلاحية قراءة السجل.'
              : 'You do not have access to this history.'
            : lang === 'ar'
              ? 'تعذر تحميل السجل. أعد المحاولة.'
              : 'Could not load history. Try again.'}
        </ReviewBanner>
      )}
      {!query.isPending && !query.isError && !items.length && (
        <p className="ar-muted">{t.historyEmpty}</p>
      )}
      {!forbidden && (
        <ol className="ar-timeline ar-list">
          {items.map((item) => (
            <li key={item.id} className="ar-timeline-item ar-stack">
              <div>
                <strong>
                  {LABELS[item.kind]?.[lang] ?? (lang === 'ar' ? 'حُدّث الملف' : 'Profile updated')}
                </strong>
                <p className="ar-muted">
                  <bdi>
                    {item.actor?.displayName ??
                      (item.actor
                        ? lang === 'ar'
                          ? 'مستخدم سابق'
                          : 'Former user'
                        : lang === 'ar'
                          ? 'النظام'
                          : 'System')}
                  </bdi>{' '}
                  ·{' '}
                  <time dateTime={item.occurredAt}>
                    {formatReviewDate(item.occurredAt, lang, t.notProvided)}
                  </time>
                </p>
              </div>
              {item.subject && (
                <p>
                  <bdi>
                    {(lang === 'ar' ? item.subject.labelAr : item.subject.labelEn) ??
                      (lang === 'ar' ? 'عنصر سابق' : 'Previous item')}
                  </bdi>
                </p>
              )}
              {item.reason && (
                <p>
                  <bdi>{item.reason}</bdi>
                </p>
              )}
              {item.submission && (
                <details>
                  <summary className="ar-disclosure">
                    {lang === 'ar' ? 'نسخة الطلب التي تمت مراجعتها' : 'Reviewed submission'}
                  </summary>
                  <dl className="ar-fields">
                    <div>
                      <dt>{t.submittedAt}</dt>
                      <dd>{formatReviewDate(item.submission.submittedAt, lang, t.notProvided)}</dd>
                    </div>
                    <div>
                      <dt>{t.policyVersion}</dt>
                      <dd>
                        <bdi>{item.submission.policyVersion}</bdi>
                      </dd>
                    </div>
                    <div>
                      <dt>{lang === 'ar' ? 'مرجع الطلب' : 'Submission reference'}</dt>
                      <dd className="ar-wrap">
                        <bdi>{item.submission.id}</bdi>
                      </dd>
                    </div>
                    {item.submission.reviewedRevision && (
                      <div>
                        <dt>
                          {lang === 'ar' ? 'مرجع نسخة البيانات' : 'Content revision reference'}
                        </dt>
                        <dd className="ar-wrap">
                          <bdi>{item.submission.reviewedRevision}</bdi>
                        </dd>
                      </div>
                    )}
                  </dl>
                </details>
              )}
              {item.contentRevision !== null && (
                <p className="ar-muted">
                  {lang === 'ar'
                    ? `إصدار الصورة: ${item.contentRevision}`
                    : `Image revision: ${item.contentRevision}`}
                </p>
              )}
              {item.feedback && (
                <details>
                  <summary className="ar-disclosure">{t.previousCorrections}</summary>
                  <ul className="ar-list">
                    {item.feedback.items.map((feedback) => (
                      <li key={feedback.id}>
                        <strong>
                          {TASK_LABELS[lang][feedback.taskId]} ·{' '}
                          {reviewCorrectionFieldLabel(feedback.field, lang)}
                        </strong>
                        <p>
                          <bdi>{feedback.providerMessage}</bdi>
                        </p>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              {item.privateNote && (
                <details className="ar-private-preview">
                  <summary className="ar-disclosure">{t.privateNote}</summary>
                  <p>
                    <bdi>{item.privateNote}</bdi>
                  </p>
                  <small>{t.privateHint}</small>
                </details>
              )}
            </li>
          ))}
        </ol>
      )}
      {query.hasNextPage && !forbidden && (
        <button
          type="button"
          className="ar-button"
          disabled={query.isFetching}
          onClick={() => void query.fetchNextPage()}
        >
          {lang === 'ar' ? 'عرض أحداث أقدم' : 'Load earlier events'}
        </button>
      )}
    </section>
  );
}
