import { formatReviewDate } from '../format-review-date';
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import type {
  AdminPortfolioItem,
  AdminPortfolioListResponse,
  AdminProviderReview,
  ReviewAdminPortfolioItemRequest,
} from '@homeservicemarketplace/contracts';
import { Image, LockKeyhole, ZoomIn } from 'lucide-react';
import { api } from '../../../../lib/api';
import { reviewQueryKey, requestStatus } from '../api';
import { REVIEW_COPY, type ReviewLanguage } from '../copy';
import { ReviewBanner, StatusBadge } from './ReviewPrimitives';
import { ReviewDialog } from './ReviewDialog';

const portfolioPath = (id: string) => `/v1/admin/providers/${encodeURIComponent(id)}/portfolio`;

/** Credentials and image blobs never enter the metadata query cache. */
function usePrivatePortfolioImage(
  providerId: string,
  item: AdminPortfolioItem | null,
  openId: number,
) {
  const [state, setState] = useState<{
    openId: number;
    itemId: string;
    url?: string;
    failed?: boolean;
  } | null>(null);
  useEffect(() => {
    if (!item) return;
    const controller = new AbortController();
    let objectUrl: string | undefined;
    void api
      .get<Blob>(`${portfolioPath(providerId)}/${encodeURIComponent(item.id)}/media`, {
        responseType: 'blob',
        signal: controller.signal,
      })
      .then(({ data }) => {
        if (controller.signal.aborted) return;
        // Never render HTML/SVG returned by a proxy failure as active content.
        if (
          !['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif'].includes(data.type)
        )
          throw new Error('Unsupported image response');
        objectUrl = URL.createObjectURL(data);
        setState({ openId, itemId: item.id, url: objectUrl });
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ openId, itemId: item.id, failed: true });
      });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [providerId, item, openId]);
  return item && state?.itemId === item.id && state.openId === openId ? state : null;
}

export function ReviewPortfolio({
  review,
  lang,
  onChanged,
}: {
  review: AdminProviderReview;
  lang: ReviewLanguage;
  onChanged: () => Promise<unknown>;
}) {
  const t = REVIEW_COPY[lang];
  const providerId = review.provider.id;
  const query = useQuery({
    queryKey: [...reviewQueryKey(providerId), 'portfolio'],
    queryFn: async ({ signal }) =>
      (await api.get<AdminPortfolioListResponse>(portfolioPath(providerId), { signal })).data,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const [openId, setOpenId] = useState(0);
  const [selected, setSelected] = useState<AdminPortfolioItem | null>(null);
  const [action, setAction] = useState<'APPROVE' | 'REJECT' | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<number | null>(null);
  const [invalid, setInvalid] = useState(false);
  const openerRef = useRef<HTMLButtonElement | null>(null);
  const image = usePrivatePortfolioImage(providerId, selected, openId);
  const mutation = useMutation({
    mutationFn: async (body: ReviewAdminPortfolioItemRequest) => {
      if (!selected) throw new Error('No image selected');
      return api.patch<AdminPortfolioItem>(
        `${portfolioPath(providerId)}/${encodeURIComponent(selected.id)}/review`,
        body,
      );
    },
  });
  async function confirm() {
    if (!selected || !action) return;
    if (action === 'REJECT' && !reason.trim()) {
      setInvalid(true);
      return;
    }
    try {
      await mutation.mutateAsync({
        action,
        expectedRevision: selected.revision,
        ...(action === 'REJECT' ? { reason: reason.trim() } : {}),
      });
      setSelected(null);
      setAction(null);
      setReason('');
      setError(null);
      await Promise.all([query.refetch(), onChanged()]);
    } catch (failure) {
      setError(requestStatus(failure) ?? 500);
    }
  }
  return (
    <div className="ar-stack" data-testid="review-portfolio">
      <div className="ar-divider" />
      <div>
        <h3 className="ar-subheading">{t.galleryCurrent}</h3>
        <p className="ar-muted">{t.galleryHint}</p>
      </div>
      {query.isLoading && <p role="status">{t.loading}</p>}
      {query.isError && (
        <ReviewBanner tone="warning" role="alert">
          {requestStatus(query.error) === 403
            ? lang === 'ar'
              ? 'ليست لديك صلاحية للاطلاع على صور المعرض.'
              : 'You do not have permission to inspect portfolio images.'
            : t.mediaFailed}
          <button className="ar-button" type="button" onClick={() => void query.refetch()}>
            {t.retry}
          </button>
        </ReviewBanner>
      )}
      {query.data &&
        !query.isError &&
        (query.data.items.length ? (
          <div className="ar-gallery">
            {query.data.items.map((item, index) => (
              <article
                key={item.id}
                className="ar-gallery-item"
                data-testid={`review-portfolio-${item.id}`}
              >
                <div className="ar-gallery-image">
                  <div className="ar-image-placeholder">
                    <Image size={30} aria-hidden />
                    <span>{t.protected}</span>
                  </div>
                </div>
                <div className="ar-gallery-body">
                  <strong>{item.title || `${t.order} ${index + 1}`}</strong>
                  <StatusBadge value={item.moderationState} lang={lang} />
                  <p className="ar-muted ar-portfolio-description">
                    {item.description || t.notProvided}
                  </p>
                  {item.moderationReason && <p>{item.moderationReason}</p>}
                  <button
                    type="button"
                    className="ar-button"
                    data-testid={`review-portfolio-open-${item.id}`}
                    onClick={(event) => {
                      openerRef.current = event.currentTarget;
                      setOpenId((value) => value + 1);
                      setSelected(item);
                      setAction(null);
                      setReason('');
                      setError(null);
                      setInvalid(false);
                    }}
                  >
                    <ZoomIn size={16} aria-hidden />
                    {t.openImage}
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <ReviewBanner>{t.galleryEmpty}</ReviewBanner>
        ))}
      <ReviewDialog
        open={!!selected}
        onClose={() => {
          if (!mutation.isPending) setSelected(null);
        }}
        title={selected?.title || t.openImage}
        description={t.galleryHint}
        openerRef={openerRef}
      >
        {image?.url ? (
          <img
            src={image.url}
            alt={selected?.description || selected?.title || t.openImage}
            className="ar-inspected-image"
          />
        ) : image?.failed ? (
          <ReviewBanner role="alert" tone="danger">
            {t.mediaFailed}
          </ReviewBanner>
        ) : (
          <div className="ar-gallery-image" role="status">
            <LockKeyhole size={26} aria-hidden />
            {t.loading}
          </div>
        )}
        {selected && (
          <>
            <p>{selected.description}</p>
            <StatusBadge value={selected.moderationState} lang={lang} />
            <small className="ar-muted">
              {t.revision} {selected.revision} ·{' '}
              {formatReviewDate(selected.updatedAt, lang, t.notProvided)}
            </small>
            {selected.reviewBlockedReason && (
              <ReviewBanner tone="warning">
                {selected.reviewBlockedReason === 'PUBLICATION_ACK_REQUIRED'
                  ? lang === 'ar'
                    ? 'يجب أن يؤكد المهني حق نشر هذه الصورة قبل قبولها.'
                    : 'The provider must confirm publication rights before this image can be approved.'
                  : lang === 'ar'
                    ? 'تحتاج هذه الصورة القديمة إلى نقل تخزينها قبل اتخاذ قرار. احتفظنا بحالتها الحالية.'
                    : 'This older image needs its storage migrated before a decision can be recorded. Its current state is preserved.'}
              </ReviewBanner>
            )}
            {review.permissions.canModeratePortfolio && (
              <div className="ar-actions">
                {(selected.availableActions ?? []).map((choice) => (
                  <button
                    type="button"
                    key={choice}
                    className={`ar-button${action === choice ? ' ar-button-primary' : ''}`}
                    disabled={!image?.url || mutation.isPending || !!error}
                    aria-pressed={action === choice}
                    onClick={() => {
                      setAction(choice);
                      setInvalid(false);
                    }}
                  >
                    {choice === 'APPROVE' ? t.approveImage : t.rejectImage}
                  </button>
                ))}
              </div>
            )}
            {action === 'REJECT' && (
              <label className="ar-label">
                {t.imageReason}
                <textarea
                  className="ar-input"
                  value={reason}
                  rows={3}
                  maxLength={1000}
                  required
                  aria-invalid={invalid}
                  onChange={(event) => {
                    setReason(event.target.value);
                    setInvalid(false);
                  }}
                />
                <small>{t.messageHint}</small>
              </label>
            )}
            {invalid && (
              <ReviewBanner role="alert" tone="danger">
                {t.imageReasonRequired}
              </ReviewBanner>
            )}
            {error && (
              <ReviewBanner role="alert" tone="danger">
                {error === 409 ? t.conflict : error === 403 ? t.noActions : t.mutationFailed}
              </ReviewBanner>
            )}
            {error === 409 ? (
              <button
                className="ar-button"
                type="button"
                onClick={async () => {
                  try {
                    await Promise.all([query.refetch(), onChanged()]);
                    setSelected(null);
                  } catch {
                    /* Keep the inspected revision and reason on failure. */
                  }
                }}
              >
                {t.refresh}
              </button>
            ) : (
              action && (
                <button
                  className="ar-button ar-button-primary"
                  type="button"
                  data-testid="review-portfolio-confirm"
                  disabled={mutation.isPending || !image?.url || error === 403}
                  onClick={() => void confirm()}
                >
                  {mutation.isPending ? t.saving : t.confirm}
                </button>
              )
            )}
            {!!selected.history?.length && (
              <details>
                <summary className="ar-disclosure">{t.history}</summary>
                <ul className="ar-list">
                  {selected.history.map((entry) => (
                    <li key={entry.id}>
                      <StatusBadge value={entry.action} lang={lang} />
                      <p>{entry.reason}</p>
                      <small className="ar-muted">
                        {formatReviewDate(entry.at, lang, t.notProvided)}
                      </small>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </>
        )}
      </ReviewDialog>
    </div>
  );
}
