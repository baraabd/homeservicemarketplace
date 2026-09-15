import { useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import type { AdminProviderReview } from '@homeservicemarketplace/contracts';
import { reviewProviderCategory, requestStatus } from '../api';
import { REVIEW_COPY, type ReviewLanguage } from '../copy';
import { ReviewBanner, StatusBadge } from './ReviewPrimitives';
import { ReviewDialog } from './ReviewDialog';

export function ReviewCategories({
  review,
  lang,
  onChanged,
}: {
  review: AdminProviderReview;
  lang: ReviewLanguage;
  onChanged: () => Promise<unknown>;
}) {
  const t = REVIEW_COPY[lang];
  const openerRef = useRef<HTMLButtonElement | null>(null);
  const [selection, setSelection] = useState<{
    id: string;
    name: string;
    action: 'APPROVE' | 'REJECT';
  } | null>(null);
  const [error, setError] = useState<number | null>(null);
  const mutation = useMutation({
    mutationFn: async () => {
      if (!selection) return;
      await reviewProviderCategory(selection.id, { action: selection.action });
    },
  });
  async function confirm() {
    try {
      await mutation.mutateAsync();
      setSelection(null);
      setError(null);
      await onChanged();
    } catch (failure) {
      setError(requestStatus(failure) ?? 500);
    }
  }
  return (
    <div className="ar-stack">
      <div className="ar-divider" />
      <div>
        <h3 className="ar-subheading">{t.categoryReview}</h3>
        <p className="ar-muted">{t.categoryHint}</p>
      </div>
      {review.categoryApplications.length ? (
        <ul className="ar-list">
          {review.categoryApplications.map((application) => (
            <li key={application.id} className="ar-list-row">
              <div>
                <strong>
                  {lang === 'ar'
                    ? application.serviceCategoryLabelAr
                    : application.serviceCategoryLabelEn}
                </strong>
                <div>
                  <StatusBadge value={application.status} lang={lang} />
                  {application.supersededAt && (
                    <small className="ar-muted">
                      {' '}
                      {lang === 'ar' ? 'طلب سابق' : 'Previous request'}
                    </small>
                  )}
                </div>
              </div>
              <div className="ar-actions">
                {application.availableActions.map((action) => (
                  <button
                    key={action}
                    className={`ar-button${action === 'REJECT' ? ' ar-button-danger' : ''}`}
                    type="button"
                    data-testid={`review-category-${action.toLowerCase()}-${application.id}`}
                    onClick={(event) => {
                      openerRef.current = event.currentTarget;
                      setSelection({
                        id: application.id,
                        name:
                          lang === 'ar'
                            ? application.serviceCategoryLabelAr
                            : application.serviceCategoryLabelEn,
                        action,
                      });
                      setError(null);
                    }}
                  >
                    {action === 'APPROVE' ? t.approveService : t.rejectService}
                  </button>
                ))}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="ar-muted">{t.empty}</p>
      )}
      <ReviewDialog
        open={!!selection}
        onClose={() => {
          if (!mutation.isPending) setSelection(null);
        }}
        title={selection?.action === 'REJECT' ? t.rejectService : t.approveService}
        description={selection?.name ?? t.confirmService}
        openerRef={openerRef}
      >
        {error && (
          <ReviewBanner role="alert" tone="danger">
            {error === 409 ? t.conflict : error === 403 ? t.noActions : t.mutationFailed}
          </ReviewBanner>
        )}
        <div className="ar-actions">
          {error === 409 ? (
            <button
              type="button"
              className="ar-button"
              onClick={async () => {
                try {
                  await onChanged();
                  setSelection(null);
                } catch {
                  /* Keep the failed decision open. */
                }
              }}
            >
              {t.refresh}
            </button>
          ) : (
            <button
              type="button"
              data-testid="review-category-confirm"
              className="ar-button ar-button-primary"
              disabled={mutation.isPending || error === 403}
              onClick={() => void confirm()}
            >
              {mutation.isPending ? t.saving : t.confirmService}
            </button>
          )}
          <button
            type="button"
            className="ar-button"
            disabled={mutation.isPending}
            onClick={() => setSelection(null)}
          >
            {t.cancel}
          </button>
        </div>
      </ReviewDialog>
    </div>
  );
}
