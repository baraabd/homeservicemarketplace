import { useCallback, useState } from 'react';

import { useBookingReview, useSubmitBookingReview } from './useBookingReview';

// R11 — what the job screen holds for one booking's review: the server's
// answer, the unsent draft, and the one submission in flight.

interface Draft {
  bookingId: string;
  open: boolean;
  rating: number;
  comment: string;
  /** Set when a submission for this booking was acknowledged in this visit. */
  justSaved: boolean;
}

const emptyDraft = (bookingId: string): Draft => ({
  bookingId,
  open: false,
  rating: 0,
  comment: '',
  justSaved: false,
});

/**
 * One booking's review: the server's answer, the unsent draft, and the one
 * submission in flight.
 *
 * The draft carries the id of the booking it was written for. Handed another
 * booking, the same mounted screen starts from an empty draft instead of
 * showing the first booking's stars over the second.
 */
export function useBookingReviewController(bookingId: string | null) {
  const query = useBookingReview(bookingId);
  const { submission, submit, dismissError } = useSubmitBookingReview(bookingId);
  const [stored, setStored] = useState<Draft | null>(null);
  const draft: Draft | null = bookingId
    ? stored && stored.bookingId === bookingId
      ? stored
      : emptyDraft(bookingId)
    : null;

  const update = useCallback(
    (patch: Partial<Omit<Draft, 'bookingId'>>) => {
      if (!bookingId) return;
      setStored((current) => ({
        ...(current && current.bookingId === bookingId ? current : emptyDraft(bookingId)),
        ...patch,
      }));
    },
    [bookingId],
  );

  const send = useCallback(async () => {
    if (!bookingId || !draft || draft.rating === 0 || submission.kind === 'sending') return;
    const target = bookingId;
    const saved = await submit({ rating: draft.rating, comment: draft.comment });
    if (!saved) return;
    // Applied to the booking that was sent, and only if it is still the one
    // this draft belongs to.
    setStored((current) =>
      current && current.bookingId === target
        ? { ...emptyDraft(target), justSaved: true }
        : current,
    );
  }, [bookingId, draft, submission.kind, submit]);

  return {
    bookingId,
    status: query.data && query.data.bookingId === bookingId ? query.data : null,
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
    draft,
    update,
    submission,
    dismissError,
    send,
  };
}

export type BookingReviewController = ReturnType<typeof useBookingReviewController>;
