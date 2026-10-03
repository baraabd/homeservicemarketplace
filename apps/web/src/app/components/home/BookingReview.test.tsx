import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import MockAdapter from 'axios-mock-adapter';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { api } from '../../../lib/api';
import { seekerQueryKeys } from '../../../lib/seeker/query-keys';
import { LanguageProvider } from '../../i18n/LanguageContext';
import { EcosystemProvider } from '../../context/EcosystemContext';
import { JobDetailView, type JobDetailSource } from './JobDetailView';

// ─────────────────────────────────────────────────────────────────────────────
// R11 — the review of a completed booking, on the real job screen.
//
// These tests drive JobDetailView itself, not the sheet in isolation: the
// defect being closed was a Submit button on this screen that sent nothing.
//
// The ORDERING tests hold responses open and release them in a chosen order.
// Nothing here waits on a timer to make a race come out one way.
// ─────────────────────────────────────────────────────────────────────────────

function booking(id: string, status: 'SCHEDULED' | 'COMPLETED', displayName = 'Omar Al-Khalid') {
  return {
    id,
    requestId: `req-${id}`,
    bidId: `bid-${id}`,
    status,
    scheduledAt: '2026-04-29T15:00:00.000Z',
    priceAmount: 35,
    currency: 'USD',
    pricingType: 'HOURLY' as const,
    createdAt: '2026-04-28T10:30:00.000Z',
    updatedAt: '2026-04-28T10:30:00.000Z',
    description: 'Leaky tap',
    bidNote: null,
    service: {
      categorySlug: 'plumbing',
      categoryLabelEn: 'Plumbing',
      categoryLabelAr: 'سباكة',
      customServiceText: null,
    },
    provider: {
      id: `pp-${id}`,
      displayName,
      initials: 'OK',
      avatarUrl: null,
      ratingAvg: 0,
      reviewCount: 0,
      completedJobs: 1,
      verified: true,
      topPro: false,
    },
    addressSnapshot: {
      label: 'Home',
      line1: '123 Main',
      city: 'Riyadh',
      country: 'SA',
      lat: null,
      lng: null,
    },
  };
}

const saved = (bookingId: string, rating: number, comment: string | null, state = 'PUBLISHED') => ({
  id: `rv-${bookingId}`,
  bookingId,
  rating,
  comment,
  state,
  createdAt: '2026-10-03T10:00:00.000Z',
});

const eligible = (bookingId: string) => ({ bookingId, eligibility: 'ELIGIBLE', review: null });
const reviewed = (bookingId: string, rating: number, comment: string | null, state?: string) => ({
  bookingId,
  eligibility: 'ALREADY_REVIEWED',
  review: saved(bookingId, rating, comment, state),
});

/** A response held open until the test releases it. */
function held<T>() {
  let release!: (value: T) => void;
  const promise = new Promise<T>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

let mock: MockAdapter;
let qc: QueryClient;

function tree(source: JobDetailSource) {
  return (
    <QueryClientProvider client={qc}>
      <LanguageProvider>
        <EcosystemProvider>
          <JobDetailView source={source} isVisible onBack={() => {}} onOpenChat={() => {}} />
        </EcosystemProvider>
      </LanguageProvider>
    </QueryClientProvider>
  );
}

function mockBooking(id: string, status: 'SCHEDULED' | 'COMPLETED' = 'COMPLETED') {
  mock.onGet(`/v1/me/bookings/${id}`).reply(200, booking(id, status));
  mock.onGet(`/v1/me/bookings/${id}/timeline`).reply(200, { items: [] });
}

const reviewUrl = (id: string) => `/v1/me/bookings/${id}/review`;
const posts = () => mock.history.post.filter((r) => r.url?.endsWith('/review'));

async function openSheet() {
  fireEvent.click(await screen.findByTestId('booking-review-open'));
  return screen.findByRole('dialog');
}

beforeEach(() => {
  window.localStorage.clear();
  mock = new MockAdapter(api);
  qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
});
afterEach(() => {
  mock.restore();
  qc.clear();
});

describe('booking review — what the screen shows', () => {
  it('asks nothing and offers nothing while the booking is not completed', async () => {
    mockBooking('bk-1', 'SCHEDULED');
    render(tree({ kind: 'booking', id: 'bk-1' }));
    await screen.findByText(/Assigned Professional/i);
    expect(screen.queryByTestId('booking-review-open')).toBeNull();
    expect(mock.history.get.some((r) => r.url === reviewUrl('bk-1'))).toBe(false);
  });

  it('offers the review when the server says the booking can be reviewed', async () => {
    mockBooking('bk-1');
    mock.onGet(reviewUrl('bk-1')).reply(200, eligible('bk-1'));
    render(tree({ kind: 'booking', id: 'bk-1' }));
    expect(await screen.findByTestId('booking-review-open')).toBeInTheDocument();
    expect(screen.queryByTestId('booking-review-saved')).toBeNull();
  });

  it('shows the saved review, and no prompt, when one already exists', async () => {
    mockBooking('bk-1');
    mock.onGet(reviewUrl('bk-1')).reply(200, reviewed('bk-1', 4, 'On time and tidy'));
    render(tree({ kind: 'booking', id: 'bk-1' }));
    const card = await screen.findByTestId('booking-review-saved');
    expect(card).toHaveTextContent('On time and tidy');
    expect(screen.getByTestId('booking-review-saved-rating')).toHaveAttribute('data-rating', '4');
    expect(screen.getByRole('img', { name: '4 stars out of 5' })).toBeInTheDocument();
    expect(screen.queryByTestId('booking-review-open')).toBeNull();
    // Nothing was submitted in this visit, so nothing claims to have just been saved.
    expect(screen.queryByTestId('booking-review-thanks')).toBeNull();
  });

  it('says so when the review was hidden', async () => {
    mockBooking('bk-1');
    mock.onGet(reviewUrl('bk-1')).reply(200, reviewed('bk-1', 1, 'x', 'HIDDEN'));
    render(tree({ kind: 'booking', id: 'bk-1' }));
    expect(await screen.findByTestId('booking-review-hidden')).toBeInTheDocument();
  });

  it('renders a comment as text, never as markup', async () => {
    const hostile = '<img src=x onerror="window.__r11 = 1"><script>window.__r11 = 1</script>';
    mockBooking('bk-1');
    mock.onGet(reviewUrl('bk-1')).reply(200, reviewed('bk-1', 5, hostile));
    render(tree({ kind: 'booking', id: 'bk-1' }));
    const comment = await screen.findByTestId('booking-review-saved-comment');
    expect(comment.textContent).toBe(hostile);
    expect(comment.querySelector('img, script')).toBeNull();
    expect((window as unknown as { __r11?: number }).__r11).toBeUndefined();
  });

  it('reports a failed read and reads again on request', async () => {
    mockBooking('bk-1');
    mock
      .onGet(reviewUrl('bk-1'))
      .replyOnce(500)
      .onGet(reviewUrl('bk-1'))
      .reply(200, eligible('bk-1'));
    render(tree({ kind: 'booking', id: 'bk-1' }));
    const failed = await screen.findByTestId('booking-review-read-failed');
    expect(failed).toHaveAttribute('role', 'alert');
    expect(screen.queryByTestId('booking-review-open')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByTestId('booking-review-open')).toBeInTheDocument();
  });

  it('shows no rating for a provider nobody has reviewed', async () => {
    mockBooking('bk-1');
    mock.onGet(reviewUrl('bk-1')).reply(200, eligible('bk-1'));
    render(tree({ kind: 'booking', id: 'bk-1' }));
    expect(await screen.findByTestId('provider-rating-none')).toHaveTextContent('No reviews yet');
    expect(screen.queryByText(/0\.0/)).toBeNull();
  });
});

describe('booking review — the sheet', () => {
  beforeEach(() => {
    mockBooking('bk-1');
    mock.onGet(reviewUrl('bk-1')).reply(200, eligible('bk-1'));
  });

  it('is a labelled modal dialog with a five-way choice and a labelled comment', async () => {
    render(tree({ kind: 'booking', id: 'bk-1' }));
    const dialog = await openSheet();
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleName('Rate your experience with O. Al-Khalid');
    expect(screen.getByRole('radiogroup', { name: 'Your rating' })).toBeInTheDocument();
    const stars = screen.getAllByRole('radio');
    expect(stars).toHaveLength(5);
    expect(stars.map((s) => s.getAttribute('aria-label'))).toEqual([
      '1 star out of 5',
      '2 stars out of 5',
      '3 stars out of 5',
      '4 stars out of 5',
      '5 stars out of 5',
    ]);
    stars.forEach((s) => expect(s).toHaveAttribute('aria-checked', 'false'));
    const comment = screen.getByLabelText('Comment (optional)');
    expect(comment).toHaveAttribute('maxlength', '1000');
    // Focus is inside the sheet as soon as it opens.
    expect(dialog.contains(document.activeElement)).toBe(true);
    // Nothing can be sent without a rating.
    expect(screen.getByTestId('booking-review-submit')).toBeDisabled();
  });

  it('moves the choice with the arrow keys', async () => {
    render(tree({ kind: 'booking', id: 'bk-1' }));
    await openSheet();
    fireEvent.click(screen.getByTestId('booking-review-star-3'));
    expect(screen.getByTestId('booking-review-star-3')).toHaveAttribute('aria-checked', 'true');
    fireEvent.keyDown(screen.getByTestId('booking-review-star-3'), { key: 'ArrowRight' });
    expect(screen.getByTestId('booking-review-star-4')).toHaveAttribute('aria-checked', 'true');
    expect(document.activeElement).toBe(screen.getByTestId('booking-review-star-4'));
    fireEvent.keyDown(screen.getByTestId('booking-review-star-4'), { key: 'ArrowLeft' });
    fireEvent.keyDown(screen.getByTestId('booking-review-star-3'), { key: 'ArrowLeft' });
    expect(screen.getByTestId('booking-review-star-2')).toHaveAttribute('aria-checked', 'true');
    // Only the chosen star is in the tab order.
    expect(screen.getByTestId('booking-review-star-2')).toHaveAttribute('tabindex', '0');
    expect(screen.getByTestId('booking-review-star-3')).toHaveAttribute('tabindex', '-1');
  });

  it('closes on Escape, returns focus to the prompt, and keeps the draft', async () => {
    render(tree({ kind: 'booking', id: 'bk-1' }));
    const dialog = await openSheet();
    fireEvent.click(screen.getByTestId('booking-review-star-2'));
    fireEvent.change(screen.getByTestId('booking-review-comment'), { target: { value: 'Late' } });
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(screen.getByTestId('booking-review-open'));
    expect(posts()).toHaveLength(0);
    await openSheet();
    expect(screen.getByTestId('booking-review-star-2')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('booking-review-comment')).toHaveValue('Late');
  });

  it('sends the rating and the comment for this booking and shows what the server saved', async () => {
    // The server's copy differs from what was typed (trimmed). The screen
    // must show the server's.
    mock
      .onPost(reviewUrl('bk-1'))
      .reply(201, { review: saved('bk-1', 5, 'Great work'), replayed: false });
    render(tree({ kind: 'booking', id: 'bk-1' }));
    await openSheet();
    fireEvent.click(screen.getByTestId('booking-review-star-5'));
    fireEvent.change(screen.getByTestId('booking-review-comment'), {
      target: { value: '  Great work  ' },
    });
    fireEvent.click(screen.getByTestId('booking-review-submit'));

    const card = await screen.findByTestId('booking-review-saved');
    expect(card).toHaveTextContent('Great work');
    expect(screen.getByTestId('booking-review-saved-rating')).toHaveAttribute('data-rating', '5');
    expect(screen.getByTestId('booking-review-thanks')).toBeInTheDocument();
    expect(screen.getByTestId('booking-review-announcement')).toHaveTextContent(
      'Your review was saved.',
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByTestId('booking-review-open')).toBeNull();

    expect(posts()).toHaveLength(1);
    expect(posts()[0].url).toBe(reviewUrl('bk-1'));
    // A rating and a comment. No reviewer, no provider, no state.
    expect(JSON.parse(posts()[0].data as string)).toEqual({ rating: 5, comment: 'Great work' });
  });

  it('omits an empty comment', async () => {
    mock.onPost(reviewUrl('bk-1')).reply(201, { review: saved('bk-1', 3, null), replayed: false });
    render(tree({ kind: 'booking', id: 'bk-1' }));
    await openSheet();
    fireEvent.click(screen.getByTestId('booking-review-star-3'));
    fireEvent.change(screen.getByTestId('booking-review-comment'), { target: { value: '   ' } });
    fireEvent.click(screen.getByTestId('booking-review-submit'));
    expect(await screen.findByTestId('booking-review-saved')).toHaveTextContent('No comment.');
    expect(JSON.parse(posts()[0].data as string)).toEqual({ rating: 3 });
  });

  it('sends once however many times Submit is pressed', async () => {
    const answer = held<[number, unknown]>();
    mock.onPost(reviewUrl('bk-1')).reply(() => answer.promise);
    render(tree({ kind: 'booking', id: 'bk-1' }));
    await openSheet();
    fireEvent.click(screen.getByTestId('booking-review-star-4'));
    const submit = screen.getByTestId('booking-review-submit');
    fireEvent.click(submit);
    fireEvent.click(submit);
    fireEvent.click(submit);
    await waitFor(() => expect(submit).toHaveAttribute('aria-busy', 'true'));
    expect(submit).toBeDisabled();
    // The sheet cannot be dismissed while the answer is outstanding.
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await act(async () => {
      answer.release([201, { review: saved('bk-1', 4, null), replayed: false }]);
    });
    await screen.findByTestId('booking-review-saved');
    expect(posts()).toHaveLength(1);
  });

  it('keeps the rating and the comment when sending fails, and sends them again on retry', async () => {
    mock
      .onPost(reviewUrl('bk-1'))
      .networkErrorOnce()
      .onPost(reviewUrl('bk-1'))
      .reply(201, { review: saved('bk-1', 2, 'Arrived late'), replayed: false });
    render(tree({ kind: 'booking', id: 'bk-1' }));
    await openSheet();
    fireEvent.click(screen.getByTestId('booking-review-star-2'));
    fireEvent.change(screen.getByTestId('booking-review-comment'), {
      target: { value: 'Arrived late' },
    });
    fireEvent.click(screen.getByTestId('booking-review-submit'));

    const error = await screen.findByTestId('booking-review-error');
    expect(error).toHaveAttribute('role', 'alert');
    expect(error).toHaveAttribute('data-error', 'NETWORK');
    // Not saved, and not shown as saved.
    expect(screen.queryByTestId('booking-review-saved')).toBeNull();
    expect(screen.getByTestId('booking-review-star-2')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('booking-review-comment')).toHaveValue('Arrived late');

    fireEvent.click(screen.getByTestId('booking-review-submit'));
    expect(await screen.findByTestId('booking-review-saved')).toHaveTextContent('Arrived late');
    expect(posts()).toHaveLength(2);
    expect(JSON.parse(posts()[1].data as string)).toEqual({ rating: 2, comment: 'Arrived late' });
  });

  it('shows the review the server already has when a different one is refused', async () => {
    mock.onPost(reviewUrl('bk-1')).reply(409, {
      error: { code: 'CONFLICT', details: { reason: 'REVIEW_ALREADY_SUBMITTED' } },
    });
    render(tree({ kind: 'booking', id: 'bk-1' }));
    await openSheet();
    // From here on the server reports the review that won.
    mock.onGet(reviewUrl('bk-1')).reply(200, reviewed('bk-1', 5, 'First one'));
    fireEvent.click(screen.getByTestId('booking-review-star-1'));
    fireEvent.click(screen.getByTestId('booking-review-submit'));
    const card = await screen.findByTestId('booking-review-saved');
    expect(card).toHaveTextContent('First one');
    expect(screen.getByTestId('booking-review-saved-rating')).toHaveAttribute('data-rating', '5');
    // The refused one is not presented as saved.
    expect(screen.queryByTestId('booking-review-thanks')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('names a lost session as a lost session', async () => {
    mock.onPost(reviewUrl('bk-1')).reply(401, { error: { code: 'UNAUTHENTICATED' } });
    render(tree({ kind: 'booking', id: 'bk-1' }));
    await openSheet();
    fireEvent.click(screen.getByTestId('booking-review-star-4'));
    fireEvent.click(screen.getByTestId('booking-review-submit'));
    expect(await screen.findByTestId('booking-review-error')).toHaveAttribute(
      'data-error',
      'SESSION',
    );
    expect(screen.queryByTestId('booking-review-saved')).toBeNull();
  });
});

describe('booking review — ordering', () => {
  it('a read asked before the acknowledgement cannot undo it', async () => {
    mockBooking('bk-1');
    mock.onGet(reviewUrl('bk-1')).replyOnce(200, eligible('bk-1'));
    render(tree({ kind: 'booking', id: 'bk-1' }));
    await openSheet();
    fireEvent.click(screen.getByTestId('booking-review-star-5'));

    // A second read starts and is held: it will answer "not reviewed yet".
    const staleRead = held<[number, unknown]>();
    mock.onGet(reviewUrl('bk-1')).reply(() => staleRead.promise);
    act(() => {
      void qc.refetchQueries({ queryKey: seekerQueryKeys.bookings.review('bk-1') });
    });
    await waitFor(() =>
      expect(mock.history.get.filter((r) => r.url === reviewUrl('bk-1'))).toHaveLength(2),
    );

    // The draft survives the refetch being in flight.
    expect(screen.getByTestId('booking-review-star-5')).toHaveAttribute('aria-checked', 'true');

    mock.onPost(reviewUrl('bk-1')).reply(201, { review: saved('bk-1', 5, null), replayed: false });
    fireEvent.click(screen.getByTestId('booking-review-submit'));
    await screen.findByTestId('booking-review-saved');

    // Now the older read answers.
    await act(async () => {
      staleRead.release([200, eligible('bk-1')]);
      await Promise.resolve();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(screen.getByTestId('booking-review-saved')).toBeInTheDocument();
    expect(screen.queryByTestId('booking-review-open')).toBeNull();
    expect(
      qc.getQueryData<{ eligibility: string }>(seekerQueryKeys.bookings.review('bk-1'))
        ?.eligibility,
    ).toBe('ALREADY_REVIEWED');
  });

  it('a refetch that answers while the sheet is open does not clear the draft', async () => {
    mockBooking('bk-1');
    mock.onGet(reviewUrl('bk-1')).reply(200, eligible('bk-1'));
    render(tree({ kind: 'booking', id: 'bk-1' }));
    await openSheet();
    fireEvent.click(screen.getByTestId('booking-review-star-3'));
    fireEvent.change(screen.getByTestId('booking-review-comment'), { target: { value: 'Fine' } });
    await act(async () => {
      await qc.refetchQueries({ queryKey: seekerQueryKeys.bookings.review('bk-1') });
    });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByTestId('booking-review-star-3')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('booking-review-comment')).toHaveValue('Fine');
  });

  it("booking A's answer, arriving while booking B is on screen, belongs to A alone", async () => {
    mockBooking('bk-a');
    mockBooking('bk-b');
    mock.onGet(reviewUrl('bk-a')).reply(200, eligible('bk-a'));
    mock.onGet(reviewUrl('bk-b')).reply(200, eligible('bk-b'));
    const answerA = held<[number, unknown]>();
    mock.onPost(reviewUrl('bk-a')).reply(() => answerA.promise);

    const view = render(tree({ kind: 'booking', id: 'bk-a' }));
    await openSheet();
    fireEvent.click(screen.getByTestId('booking-review-star-1'));
    fireEvent.change(screen.getByTestId('booking-review-comment'), { target: { value: 'For A' } });
    fireEvent.click(screen.getByTestId('booking-review-submit'));
    await waitFor(() => expect(posts()).toHaveLength(1));

    // The same mounted screen is handed booking B before A's answer arrives.
    view.rerender(tree({ kind: 'booking', id: 'bk-b' }));
    await screen.findByTestId('booking-review-open');
    // B has no sheet, no stars and no "sending" inherited from A.
    expect(screen.queryByRole('dialog')).toBeNull();
    await openSheet();
    screen.getAllByRole('radio').forEach((s) => expect(s).toHaveAttribute('aria-checked', 'false'));
    expect(screen.getByTestId('booking-review-comment')).toHaveValue('');
    expect(screen.getByTestId('booking-review-submit')).not.toHaveAttribute('aria-busy', 'true');

    await act(async () => {
      answerA.release([201, { review: saved('bk-a', 1, 'For A'), replayed: false }]);
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(
        qc.getQueryData<{ eligibility: string }>(seekerQueryKeys.bookings.review('bk-a'))
          ?.eligibility,
      ).toBe('ALREADY_REVIEWED'),
    );
    // B is still unreviewed, its sheet still open and empty.
    expect(screen.queryByTestId('booking-review-saved')).toBeNull();
    expect(screen.queryByTestId('booking-review-thanks')).toBeNull();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(
      qc.getQueryData<{ eligibility: string }>(seekerQueryKeys.bookings.review('bk-b'))
        ?.eligibility,
    ).toBe('ELIGIBLE');
    expect(posts().map((r) => r.url)).toEqual([reviewUrl('bk-a')]);

    // Back on A, the saved review is there.
    view.rerender(tree({ kind: 'booking', id: 'bk-a' }));
    expect(await screen.findByTestId('booking-review-saved')).toHaveTextContent('For A');
  });

  it('a screen mounted for another booking starts empty', async () => {
    mockBooking('bk-a');
    mockBooking('bk-b');
    mock.onGet(reviewUrl('bk-a')).reply(200, eligible('bk-a'));
    mock.onGet(reviewUrl('bk-b')).reply(200, eligible('bk-b'));
    const first = render(tree({ kind: 'booking', id: 'bk-a' }));
    await openSheet();
    fireEvent.click(screen.getByTestId('booking-review-star-4'));
    fireEvent.change(screen.getByTestId('booking-review-comment'), { target: { value: 'A' } });
    first.unmount();
    render(tree({ kind: 'booking', id: 'bk-b' }));
    await openSheet();
    screen.getAllByRole('radio').forEach((s) => expect(s).toHaveAttribute('aria-checked', 'false'));
    expect(screen.getByTestId('booking-review-comment')).toHaveValue('');
  });

  it('an answer that arrives after another person signed in is not given to them', async () => {
    qc.setQueryData(['auth', 'me'], { id: 'user-1' });
    mockBooking('bk-1');
    mock.onGet(reviewUrl('bk-1')).reply(200, eligible('bk-1'));
    const answer = held<[number, unknown]>();
    mock.onPost(reviewUrl('bk-1')).reply(() => answer.promise);
    render(tree({ kind: 'booking', id: 'bk-1' }));
    await openSheet();
    fireEvent.click(screen.getByTestId('booking-review-star-5'));
    fireEvent.click(screen.getByTestId('booking-review-submit'));
    await waitFor(() => expect(posts()).toHaveLength(1));

    // Sign-out and a different sign-in, before the answer.
    act(() => {
      qc.removeQueries({ queryKey: seekerQueryKeys.bookings.review('bk-1') });
      qc.setQueryData(['auth', 'me'], { id: 'user-2' });
    });
    await act(async () => {
      answer.release([201, { review: saved('bk-1', 5, null), replayed: false }]);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    // user-1's review was not written into the cache user-2 now reads.
    const cached = qc.getQueryData<{ review: unknown }>(seekerQueryKeys.bookings.review('bk-1'));
    expect(cached?.review ?? null).toBeNull();
    expect(screen.queryByTestId('booking-review-thanks')).toBeNull();
  });

  it('a sign-out before the answer leaves nothing behind', async () => {
    qc.setQueryData(['auth', 'me'], { id: 'user-1' });
    mockBooking('bk-1');
    mock.onGet(reviewUrl('bk-1')).replyOnce(200, eligible('bk-1'));
    const answer = held<[number, unknown]>();
    mock.onPost(reviewUrl('bk-1')).reply(() => answer.promise);
    const view = render(tree({ kind: 'booking', id: 'bk-1' }));
    await openSheet();
    fireEvent.click(screen.getByTestId('booking-review-star-2'));
    fireEvent.click(screen.getByTestId('booking-review-submit'));
    await waitFor(() => expect(posts()).toHaveLength(1));

    view.unmount();
    qc.setQueryData(['auth', 'me'], null);
    qc.removeQueries({ queryKey: seekerQueryKeys.bookings.root });
    await act(async () => {
      answer.release([201, { review: saved('bk-1', 2, null), replayed: false }]);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(qc.getQueryData(seekerQueryKeys.bookings.review('bk-1'))).toBeUndefined();
  });
});

describe('booking review — Arabic', () => {
  it('reads naturally in Arabic and keeps the same structure', async () => {
    window.localStorage.setItem('hsm.lang', 'ar');
    mockBooking('bk-1');
    mock.onGet(reviewUrl('bk-1')).reply(200, eligible('bk-1'));
    render(tree({ kind: 'booking', id: 'bk-1' }));
    const dialog = await openSheet();
    expect(dialog).toHaveAccessibleName(/كيف كانت تجربتك مع/);
    expect(screen.getByRole('radiogroup', { name: 'تقييمك' })).toBeInTheDocument();
    expect(screen.getByLabelText('تعليق (اختياري)')).toBeInTheDocument();
    expect(screen.getByTestId('booking-review-submit')).toHaveTextContent('إرسال التقييم');
    // In a right-to-left row the next star is to the left.
    fireEvent.click(screen.getByTestId('booking-review-star-2'));
    fireEvent.keyDown(screen.getByTestId('booking-review-star-2'), { key: 'ArrowLeft' });
    expect(screen.getByTestId('booking-review-star-3')).toHaveAttribute('aria-checked', 'true');
  });
});
