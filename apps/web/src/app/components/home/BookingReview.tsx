import { useCallback, useEffect, useId, useRef } from 'react';
import { AlertCircle, CheckCircle2, ChevronRight, EyeOff, ThumbsUp } from 'lucide-react';
import type { BookingReviewView } from '@homeservicemarketplace/contracts';

import type { ReviewSubmissionError } from '../../hooks/seeker/useBookingReview';
import type { BookingReviewController } from '../../hooks/seeker/useBookingReviewController';
import { REVIEW_COMMENT_MAX_LENGTH } from '../../../lib/seeker/reviews-api';

// R11 — the seeker's review of a completed booking, on the job screen.
//
// Until R11 "Submit Review" set a flag in this screen and nothing else: the
// comment was never read, nothing was sent, and a reload asked for the review
// again. Now the screen shows what the SERVER says about the booking's review,
// and Submit sends it.
//
// Two pieces share one controller (useBookingReviewController): the entry (a prompt, or the saved review)
// sits in the job's scroll content, and the sheet overlays the screen.

type Lang = 'en' | 'ar';

const COPY = {
  en: {
    promptTitle: 'How was your experience?',
    promptBody: 'Leave a review to help others choose.',
    sheetTitle: (name: string) => `Rate your experience with ${name}`,
    ratingLabel: 'Your rating',
    ratingHint: 'Tap a star to rate',
    star: (n: number) => (n === 1 ? '1 star out of 5' : `${n} stars out of 5`),
    commentLabel: 'Comment (optional)',
    commentPlaceholder: 'Add a comment (optional)…',
    submit: 'Submit Review',
    sending: 'Sending…',
    close: 'Close',
    final: 'A review cannot be changed after it is sent.',
    saved: 'Your review was saved.',
    yours: 'Your review',
    noComment: 'No comment.',
    hidden: 'This review was hidden by our team and is not counted.',
    readFailed: 'We could not load your review for this job.',
    retry: 'Try again',
    errors: {
      NETWORK: 'Your review was not sent. Check your connection and try again.',
      SESSION: 'Your session has ended. Sign in again to send your review.',
      INVALID: 'That review could not be accepted. Check the rating and the comment.',
      ALREADY_REVIEWED: 'This job has already been reviewed. A review cannot be changed.',
      NOT_REVIEWABLE: 'This job cannot be reviewed.',
      UNKNOWN: 'Your review was not sent. Try again.',
    } satisfies Record<ReviewSubmissionError, string>,
  },
  ar: {
    promptTitle: 'كيف كانت تجربتك؟',
    promptBody: 'اترك تقييماً ليساعد الآخرين على الاختيار.',
    sheetTitle: (name: string) => `كيف كانت تجربتك مع ${name}؟`,
    ratingLabel: 'تقييمك',
    ratingHint: 'اضغط على نجمة للتقييم',
    star: (n: number) => `${n} من 5 نجوم`,
    commentLabel: 'تعليق (اختياري)',
    commentPlaceholder: 'أضف تعليقاً (اختياري)…',
    submit: 'إرسال التقييم',
    sending: 'جارٍ الإرسال…',
    close: 'إغلاق',
    final: 'لا يمكن تعديل التقييم بعد إرساله.',
    saved: 'تم حفظ تقييمك.',
    yours: 'تقييمك',
    noComment: 'بدون تعليق.',
    hidden: 'تم إخفاء هذا التقييم من قِبل فريقنا ولا يُحتسب.',
    readFailed: 'تعذّر تحميل تقييمك لهذا الطلب.',
    retry: 'حاول مرة أخرى',
    errors: {
      NETWORK: 'لم يُرسل تقييمك. تحقق من اتصالك وحاول مرة أخرى.',
      SESSION: 'انتهت جلستك. سجّل الدخول مرة أخرى لإرسال تقييمك.',
      INVALID: 'تعذّر قبول هذا التقييم. تحقق من عدد النجوم ومن التعليق.',
      ALREADY_REVIEWED: 'تم تقييم هذا الطلب من قبل. لا يمكن تعديل التقييم.',
      NOT_REVIEWABLE: 'لا يمكن تقييم هذا الطلب.',
      UNKNOWN: 'لم يُرسل تقييمك. حاول مرة أخرى.',
    } satisfies Record<ReviewSubmissionError, string>,
  },
} as const;

function StarRow({ rating, size }: { rating: number; size: number }) {
  return (
    <span className="inline-flex items-center gap-0.5" aria-hidden="true">
      {[1, 2, 3, 4, 5].map((s) => (
        <svg
          key={s}
          width={size}
          height={size}
          viewBox="0 0 24 24"
          fill={s <= rating ? '#F59E0B' : 'none'}
          stroke={s <= rating ? '#F59E0B' : '#CBD5E1'}
          strokeWidth="1.5"
        >
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
        </svg>
      ))}
    </span>
  );
}

function SavedReview({
  review,
  lang,
  reveal,
}: {
  review: BookingReviewView;
  lang: Lang;
  /** Just saved in this visit: bring it into view, once. */
  reveal: boolean;
}) {
  const copy = COPY[lang];
  const cardRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!reveal) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    cardRef.current?.scrollIntoView?.({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
  }, [reveal]);
  return (
    <div
      ref={cardRef}
      className="bg-white border border-slate-200 rounded-3xl p-4 flex flex-col gap-2"
      data-testid="booking-review-saved"
      data-review-state={review.state}
    >
      <div className="flex items-center justify-between gap-3">
        <p className="text-slate-900" style={{ fontSize: '14px', fontWeight: 800 }}>
          {copy.yours}
        </p>
        <span
          className="inline-flex items-center gap-2"
          role="img"
          aria-label={copy.star(review.rating)}
          data-testid="booking-review-saved-rating"
          data-rating={review.rating}
        >
          <StarRow rating={review.rating} size={16} />
        </span>
      </div>
      {/* Rendered as text. A comment is never interpreted as markup. */}
      <p
        className={`break-words whitespace-pre-wrap ${review.comment ? 'text-slate-700' : 'text-slate-400'}`}
        style={{ fontSize: '13px' }}
        data-testid="booking-review-saved-comment"
        dir="auto"
      >
        {review.comment ?? copy.noComment}
      </p>
      {review.state === 'HIDDEN' && (
        <p
          className="flex items-start gap-2 text-slate-600"
          style={{ fontSize: '12px' }}
          data-testid="booking-review-hidden"
        >
          <EyeOff size={14} className="mt-0.5 flex-shrink-0" aria-hidden="true" />
          {copy.hidden}
        </p>
      )}
    </div>
  );
}

/** What the job screen shows about this booking's review. */
export function BookingReviewEntry({
  controller,
  lang,
  triggerRef,
}: {
  controller: BookingReviewController;
  lang: Lang;
  triggerRef: React.RefObject<HTMLButtonElement>;
}) {
  const copy = COPY[lang];
  const { status, isError, isLoading, draft, refetch, update } = controller;
  if (!controller.bookingId || !draft) return null;

  if (isError && !status) {
    return (
      <div
        role="alert"
        className="bg-red-50 border border-red-200 rounded-3xl p-4 flex items-center gap-3"
        data-testid="booking-review-read-failed"
      >
        <AlertCircle size={18} className="text-red-500 flex-shrink-0" aria-hidden="true" />
        <p className="flex-1 text-red-700" style={{ fontSize: '13px' }}>
          {copy.readFailed}
        </p>
        <button
          type="button"
          onClick={() => void refetch()}
          className="min-h-[44px] px-3 rounded-2xl text-red-700 underline"
          style={{ fontSize: '13px', fontWeight: 700 }}
        >
          {copy.retry}
        </button>
      </div>
    );
  }
  if (isLoading || !status) return null;

  return (
    <>
      {/* Announced once, when a submission from this visit is acknowledged. */}
      <p
        className="sr-only"
        role="status"
        aria-live="polite"
        data-testid="booking-review-announcement"
      >
        {draft.justSaved && status.review ? copy.saved : ''}
      </p>

      {status.review ? (
        <>
          {draft.justSaved && (
            <div
              className="bg-green-50 border border-green-200 rounded-3xl p-4 flex items-center gap-3"
              data-testid="booking-review-thanks"
            >
              <CheckCircle2 size={20} className="text-green-500" aria-hidden="true" />
              <p className="text-green-700" style={{ fontSize: '13px', fontWeight: 600 }}>
                {copy.saved}
              </p>
            </div>
          )}
          <SavedReview review={status.review} lang={lang} reveal={draft.justSaved} />
        </>
      ) : status.eligibility === 'ELIGIBLE' ? (
        <button
          ref={triggerRef}
          type="button"
          onClick={() => update({ open: true })}
          data-testid="booking-review-open"
          className="bg-gradient-to-r from-amber-500 to-orange-500 rounded-3xl p-4 flex items-center gap-3 active:scale-95 transition-all"
        >
          <span className="w-10 h-10 rounded-2xl bg-white/20 flex items-center justify-center flex-shrink-0">
            <ThumbsUp size={18} className="text-white" aria-hidden="true" />
          </span>
          <span className="flex-1 text-start">
            <span className="block text-white" style={{ fontSize: '14px', fontWeight: 800 }}>
              {copy.promptTitle}
            </span>
            <span className="block text-white/80" style={{ fontSize: '12px' }}>
              {copy.promptBody}
            </span>
          </span>
          <ChevronRight size={18} className="text-white/60 rtl:rotate-180" aria-hidden="true" />
        </button>
      ) : null}
    </>
  );
}

/** The rating sheet. A modal dialog: it takes focus, keeps it, and gives it
 *  back to the button that opened it. */
export function BookingReviewSheet({
  controller,
  lang,
  providerName,
  providerInitials,
  triggerRef,
}: {
  controller: BookingReviewController;
  lang: Lang;
  providerName: string;
  providerInitials: string;
  triggerRef: React.RefObject<HTMLButtonElement>;
}) {
  const copy = COPY[lang];
  const { draft, status, submission, update, send, dismissError } = controller;
  const titleId = useId();
  const hintId = useId();
  const commentId = useId();
  const errorId = useId();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const starRefs = useRef<Array<HTMLButtonElement | null>>([]);

  // Open only while the server still says this booking can be reviewed. Once
  // a review exists, or the booking changes, the sheet is simply not there.
  const open = Boolean(draft?.open) && status?.eligibility === 'ELIGIBLE' && !status.review;
  const sending = submission.kind === 'sending';

  const close = useCallback(() => {
    if (sending) return;
    dismissError();
    update({ open: false });
  }, [dismissError, sending, update]);

  // Focus goes in when the sheet opens, and back to the button that opened
  // it when the sheet closes.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open && !wasOpen.current) {
      const selected = draft && draft.rating > 0 ? draft.rating - 1 : 0;
      // The sheet is on screen by construction; focusing must not scroll
      // whatever is behind it.
      starRefs.current[selected]?.focus({ preventScroll: true });
    }
    if (!open && wasOpen.current) triggerRef.current?.focus();
    wasOpen.current = open;
  }, [open, draft, triggerRef]);

  if (!open || !draft) return null;

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      close();
      return;
    }
    if (event.key !== 'Tab') return;
    // Keep focus inside the sheet.
    const focusable = panelRef.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), textarea:not([disabled])',
    );
    if (!focusable || focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const choose = (rating: number) => {
    update({ rating });
    starRefs.current[rating - 1]?.focus();
  };
  const onStarKey = (event: React.KeyboardEvent<HTMLButtonElement>, star: number) => {
    const forward = lang === 'ar' ? 'ArrowLeft' : 'ArrowRight';
    const back = lang === 'ar' ? 'ArrowRight' : 'ArrowLeft';
    if (event.key === forward || event.key === 'ArrowUp') {
      event.preventDefault();
      choose(Math.min(5, Math.max(draft.rating, star) + 1));
    } else if (event.key === back || event.key === 'ArrowDown') {
      event.preventDefault();
      choose(Math.max(1, (draft.rating || star) - 1));
    }
  };

  return (
    <div className="absolute inset-0 z-30 flex flex-col justify-end" onKeyDown={onKeyDown}>
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={close} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid="booking-review-sheet"
        className="relative bg-white rounded-t-3xl px-6 py-6 max-h-full overflow-y-auto"
      >
        <div className="w-10 h-1 rounded-full bg-slate-200 mx-auto mb-5" aria-hidden="true" />
        <div className="flex flex-col items-center text-center gap-2 mb-5">
          <div
            className="w-16 h-16 rounded-2xl bg-amber-100 flex items-center justify-center mb-2"
            aria-hidden="true"
          >
            <span className="text-amber-700" style={{ fontSize: '20px', fontWeight: 800 }}>
              {providerInitials}
            </span>
          </div>
          <h2 id={titleId} className="text-slate-900" style={{ fontSize: '18px', fontWeight: 800 }}>
            {copy.sheetTitle(providerName)}
          </h2>
          <p id={hintId} className="text-slate-500" style={{ fontSize: '13px' }}>
            {copy.ratingHint}
          </p>
        </div>

        {/* One choice of five. Each star says what it is and whether it is the
            one chosen; the arrow keys move the choice. */}
        <div
          role="radiogroup"
          aria-label={copy.ratingLabel}
          aria-describedby={hintId}
          className="flex justify-center gap-1 mb-5"
          data-testid="booking-review-stars"
        >
          {[1, 2, 3, 4, 5].map((star) => {
            const chosen = draft.rating === star;
            const tabbable = draft.rating === 0 ? star === 1 : chosen;
            return (
              <button
                key={star}
                ref={(node) => {
                  starRefs.current[star - 1] = node;
                }}
                type="button"
                role="radio"
                aria-checked={chosen}
                aria-label={copy.star(star)}
                tabIndex={tabbable ? 0 : -1}
                disabled={sending}
                onClick={() => choose(star)}
                onKeyDown={(event) => onStarKey(event, star)}
                data-testid={`booking-review-star-${star}`}
                className="w-12 h-12 flex items-center justify-center rounded-2xl active:scale-90 transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500"
              >
                <svg
                  width="36"
                  height="36"
                  viewBox="0 0 24 24"
                  fill={star <= draft.rating ? '#F59E0B' : 'none'}
                  stroke={star <= draft.rating ? '#F59E0B' : '#94A3B8'}
                  strokeWidth="1.5"
                  aria-hidden="true"
                >
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                </svg>
              </button>
            );
          })}
        </div>

        <div className="mb-3">
          <label
            htmlFor={commentId}
            className="block text-slate-700 mb-1.5"
            style={{ fontSize: '13px', fontWeight: 600 }}
          >
            {copy.commentLabel}
          </label>
          <textarea
            id={commentId}
            value={draft.comment}
            onChange={(event) => update({ comment: event.target.value })}
            maxLength={REVIEW_COMMENT_MAX_LENGTH}
            disabled={sending}
            placeholder={copy.commentPlaceholder}
            rows={3}
            // Typed text takes its own direction. Empty, the placeholder
            // follows the page, so its ellipsis lands on the right side.
            dir={draft.comment ? 'auto' : undefined}
            data-testid="booking-review-comment"
            className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 text-slate-700 placeholder-slate-400 resize-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-500"
            style={{ fontSize: '16px' }}
          />
          <p className="text-slate-500 mt-1" style={{ fontSize: '12px' }}>
            {copy.final}
          </p>
        </div>

        {submission.kind === 'failed' && (
          <p
            id={errorId}
            role="alert"
            className="flex items-start gap-2 text-red-700 mb-3"
            style={{ fontSize: '13px' }}
            data-testid="booking-review-error"
            data-error={submission.error}
          >
            <AlertCircle size={16} className="mt-0.5 flex-shrink-0" aria-hidden="true" />
            {copy.errors[submission.error]}
          </p>
        )}

        <div className="flex gap-3">
          <button
            type="button"
            onClick={close}
            disabled={sending}
            data-testid="booking-review-close"
            className="min-h-[52px] px-5 rounded-2xl border border-slate-200 text-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500"
            style={{ fontSize: '15px', fontWeight: 700 }}
          >
            {copy.close}
          </button>
          <button
            type="button"
            onClick={() => void send()}
            disabled={draft.rating === 0 || sending}
            aria-busy={sending}
            aria-describedby={submission.kind === 'failed' ? errorId : undefined}
            data-testid="booking-review-submit"
            className={`flex-1 min-h-[52px] rounded-2xl transition-all active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500 ${
              draft.rating > 0 && !sending
                ? 'bg-amber-500 text-white shadow-md shadow-amber-200'
                : 'bg-slate-100 text-slate-500'
            }`}
            style={{ fontSize: '15px', fontWeight: 700 }}
          >
            {sending ? copy.sending : copy.submit}
          </button>
        </div>
      </div>
    </div>
  );
}
