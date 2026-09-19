import { useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import type { AdminProviderReview } from '@homeservicemarketplace/contracts';
import { reviewProviderCategory, requestStatus } from '../api';
import { REVIEW_COPY, type ReviewLanguage } from '../copy';
import { ReviewBanner, StatusBadge } from './ReviewPrimitives';
import { ReviewDialog } from './ReviewDialog';
import { ReviewMutationNotice } from './ReviewMutationNotice';

export function ReviewCategories({
  review,
  lang,
  onChanged,
  readOnly = false,
}: {
  review: AdminProviderReview;
  lang: ReviewLanguage;
  onChanged: () => Promise<unknown>;
  readOnly?: boolean;
}) {
  const t = REVIEW_COPY[lang];
  const openerRef = useRef<HTMLButtonElement | null>(null);
  const [selection, setSelection] = useState<{
    id: string;
    name: string;
    status: string;
    action: 'APPROVE' | 'REJECT';
  } | null>(null);
  const [error, setError] = useState<number | null>(null);
  const mutation = useMutation({
    mutationFn: async () => {
      if (!selection) return;
      await reviewProviderCategory(selection.id, { action: selection.action });
    },
  });
  const current = review.categoryApplications.find((item) => item.id === selection?.id);
  const selectionCurrent = !!selection && !!current &&
    current.status === selection.status && current.availableActions.includes(selection.action);
  async function confirm() {
    if (readOnly || mutation.isPending || !selectionCurrent || error === 403 || error === 409) return;
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
                    disabled={readOnly || mutation.isPending}
                    onClick={(event) => {
                      if (readOnly || mutation.isPending) return;
                      openerRef.current = event.currentTarget;
                      setSelection({
                        id: application.id,
                        status: application.status,
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
        <ReviewMutationNotice lang={lang} paused={readOnly} stale={!!selection && !selectionCurrent} />
        {error && (
          <ReviewBanner role="alert" tone="danger">
            {error === 409 ? t.conflict : error === 403 ? t.noActions : t.mutationFailed}
          </ReviewBanner>
        )}
        <div className="ar-actions">
          {(error === 409 || readOnly || (!!selection && !selectionCurrent)) && (
            <button
              type="button"
              className="ar-button"
              disabled={mutation.isPending}
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
          )}
          {error !== 409 && (
            <button
              type="button"
              data-testid="review-category-confirm"
              className="ar-button ar-button-primary"
              disabled={readOnly || mutation.isPending || !selectionCurrent || error === 403}
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
