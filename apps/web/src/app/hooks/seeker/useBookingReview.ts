import { useCallback, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  BookingReviewStatusResponse,
  BookingReviewView,
} from '@homeservicemarketplace/contracts';

import { getBookingReview, submitBookingReview } from '../../../lib/seeker/reviews-api';
import { seekerQueryKeys } from '../../../lib/seeker/query-keys';

// R11 — the review of one booking: what the server says about it, and one
// submission at a time.
//
// EVERYTHING HERE IS SCOPED TO A BOOKING, AND TO A SESSION.
//
// The profile editor once lost typed fields to a late response (the R05
// repair). The same shape of mistake here would be worse: a late answer for
// booking A marking booking B reviewed, or one person's answer landing in the
// next person's cache. So:
//
//   - the server state lives under a key that contains the booking id;
//   - a submission remembers which booking and which signed-in user it was
//     made for, and its result is applied only to that booking's key, and
//     only if the same user is still signed in;
//   - what the form shows as "sending" or "failed" belongs to one booking and
//     is ignored for any other.
//
// "Reviewed" is never a local flag. It is the server's answer.

export function useBookingReview(bookingId: string | null | undefined) {
  return useQuery<BookingReviewStatusResponse>({
    queryKey: bookingId
      ? seekerQueryKeys.bookings.review(bookingId)
      : seekerQueryKeys.bookings.root,
    queryFn: () => getBookingReview(bookingId as string),
    enabled: typeof bookingId === 'string' && bookingId.length > 0,
    staleTime: 30 * 1000,
  });
}

export type ReviewSubmissionError =
  /** Nothing reached the server, or no answer came back. */
  | 'NETWORK'
  /** The session is gone. */
  | 'SESSION'
  /** The server refused the content (rating or comment). */
  | 'INVALID'
  /** A different review already exists for this booking. */
  | 'ALREADY_REVIEWED'
  /** The booking cannot be reviewed (not completed, or not found). */
  | 'NOT_REVIEWABLE'
  | 'UNKNOWN';

export type ReviewSubmission =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'failed'; error: ReviewSubmissionError };

interface Scoped {
  bookingId: string;
  submission: ReviewSubmission;
}

function classify(error: unknown): ReviewSubmissionError {
  const response = (error as { response?: { status?: number; data?: unknown } } | undefined)
    ?.response;
  if (!response) return 'NETWORK';
  const reason = (response.data as { error?: { details?: { reason?: string } } } | undefined)?.error
    ?.details?.reason;
  if (response.status === 401 || response.status === 403) return 'SESSION';
  if (response.status === 400) return 'INVALID';
  if (response.status === 409) {
    return reason === 'REVIEW_ALREADY_SUBMITTED' ? 'ALREADY_REVIEWED' : 'NOT_REVIEWABLE';
  }
  if (response.status === 404) return 'NOT_REVIEWABLE';
  return 'UNKNOWN';
}

const signedInUserId = (qc: ReturnType<typeof useQueryClient>): string | null =>
  (qc.getQueryData(['auth', 'me']) as { id?: string } | null | undefined)?.id ?? null;

export function useSubmitBookingReview(bookingId: string | null | undefined) {
  const qc = useQueryClient();
  const [scoped, setScoped] = useState<Scoped | null>(null);
  // Which attempt is the latest for each booking, so an older attempt's
  // outcome cannot overwrite a newer one's.
  const attempts = useRef(new Map<string, number>());

  // The submission state for THIS booking only.
  const submission: ReviewSubmission =
    scoped && scoped.bookingId === bookingId ? scoped.submission : { kind: 'idle' };

  const submit = useCallback(
    async (input: { rating: number; comment: string }): Promise<BookingReviewView | null> => {
      if (!bookingId) return null;
      const target = bookingId;
      const madeBy = signedInUserId(qc);
      const attempt = (attempts.current.get(target) ?? 0) + 1;
      attempts.current.set(target, attempt);
      const stillLatest = () => attempts.current.get(target) === attempt;
      // The outcome belongs to the booking it was sent for. If the form has
      // since moved to another booking, `scoped.bookingId` no longer matches
      // and nothing is shown for it there.
      const show = (next: ReviewSubmission) => {
        if (stillLatest()) setScoped({ bookingId: target, submission: next });
      };

      show({ kind: 'sending' });
      try {
        const comment = input.comment.trim();
        const acknowledged = await submitBookingReview(target, {
          rating: input.rating,
          ...(comment.length > 0 ? { comment } : {}),
        });
        // Another person has signed in since: this answer is not theirs.
        if (signedInUserId(qc) !== madeBy) return null;
        // A read of this booking's review that was asked BEFORE this answer
        // may still be on its way, carrying "not reviewed yet". Left alone it
        // would land after the acknowledgement and put the prompt back.
        await qc.cancelQueries({ queryKey: seekerQueryKeys.bookings.review(target) });
        if (signedInUserId(qc) !== madeBy) return null;
        // The acknowledgement IS the server's state, so the cache takes it
        // for the booking it was sent for, whichever booking is on screen.
        qc.setQueryData<BookingReviewStatusResponse>(seekerQueryKeys.bookings.review(target), {
          bookingId: target,
          eligibility: 'ALREADY_REVIEWED',
          review: acknowledged.review,
        });
        // The provider's rating on the booking card changed with it.
        void qc.invalidateQueries({ queryKey: seekerQueryKeys.bookings.detail(target) });
        show({ kind: 'idle' });
        return acknowledged.review;
      } catch (error) {
        if (signedInUserId(qc) !== madeBy) return null;
        const kind = classify(error);
        // No answer does not mean no review: the server may have saved it and
        // the reply been lost. Ask it, rather than guess either way.
        if (kind === 'NETWORK' || kind === 'ALREADY_REVIEWED' || kind === 'NOT_REVIEWABLE') {
          void qc.invalidateQueries({ queryKey: seekerQueryKeys.bookings.review(target) });
        }
        show({ kind: 'failed', error: kind });
        return null;
      }
    },
    [bookingId, qc],
  );

  const dismissError = useCallback(() => {
    if (bookingId) setScoped({ bookingId, submission: { kind: 'idle' } });
  }, [bookingId]);

  return { submission, submit, dismissError };
}
