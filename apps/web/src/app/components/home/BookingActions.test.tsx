import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import MockAdapter from 'axios-mock-adapter';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { api } from '../../../lib/api';
import { LanguageProvider } from '../../i18n/LanguageContext';
import { EcosystemProvider } from '../../context/EcosystemContext';
import { JobDetailView, type JobDetailSource } from './JobDetailView';

// ─────────────────────────────────────────────────────────────────────────────
// R12 — Message, Call and Progress on the seeker's booking screen.
//
// Message asks the server for this booking's conversation and opens what the
// server answers. The ORDERING tests hold that answer open and release it after
// the screen has moved on: to another booking, to nothing, or to another
// person. Nothing here waits on a timer to make a race come out one way.
// ─────────────────────────────────────────────────────────────────────────────

function booking(id: string, displayName = 'Omar Al-Khalid') {
  return {
    id,
    requestId: `req-${id}`,
    bidId: `bid-${id}`,
    status: 'SCHEDULED' as const,
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
      completedJobs: 0,
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

/** The server's answer. Its names differ from the booking card's on purpose:
 *  what opens must be the server's conversation, not the screen's guess. */
const conversation = (bookingId: string) => ({
  conversation: {
    id: `conv-${bookingId}`,
    bookingId,
    requestId: `req-${bookingId}`,
    otherParticipant: { displayName: `Server name ${bookingId}`, initials: 'SN', avatarUrl: null },
    lastMessageBody: null,
    lastMessageAt: null,
    unreadCount: 0,
    createdAt: '2026-10-03T10:00:00.000Z',
    updatedAt: '2026-10-03T10:00:00.000Z',
  },
});

function held<T>() {
  let release!: (value: T) => void;
  const promise = new Promise<T>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

let mock: MockAdapter;
let qc: QueryClient;
let onOpenChat: ReturnType<typeof vi.fn>;

function tree(source: JobDetailSource) {
  return (
    <QueryClientProvider client={qc}>
      <LanguageProvider>
        <EcosystemProvider>
          <JobDetailView source={source} isVisible onBack={() => {}} onOpenChat={onOpenChat} />
        </EcosystemProvider>
      </LanguageProvider>
    </QueryClientProvider>
  );
}

function mockBooking(id: string) {
  mock.onGet(`/v1/me/bookings/${id}`).reply(200, booking(id));
  mock.onGet(`/v1/me/bookings/${id}/timeline`).reply(200, { items: [] });
}

const creates = () => mock.history.post.filter((r) => r.url === '/v1/me/conversations');

async function messageButton() {
  return screen.findByTestId('booking-action-message');
}

beforeEach(() => {
  window.localStorage.clear();
  mock = new MockAdapter(api);
  qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  onOpenChat = vi.fn();
});
afterEach(() => {
  mock.restore();
  qc.clear();
});

describe('Message', () => {
  it('asks the server for this booking’s conversation and opens what it answers', async () => {
    mockBooking('bk-1');
    mock.onPost('/v1/me/conversations').reply(200, conversation('bk-1'));
    render(tree({ kind: 'booking', id: 'bk-1' }));
    fireEvent.click(await messageButton());
    await waitFor(() => expect(onOpenChat).toHaveBeenCalledTimes(1));
    // The booking id, and nothing that names a person.
    expect(JSON.parse(creates()[0].data as string)).toEqual({ bookingId: 'bk-1' });
    expect(onOpenChat).toHaveBeenCalledWith({
      conversationId: 'conv-bk-1',
      name: 'Server name bk-1',
      initials: 'SN',
    });
  });

  it('sends one request however many times it is pressed', async () => {
    mockBooking('bk-1');
    const answer = held<[number, unknown]>();
    mock.onPost('/v1/me/conversations').reply(() => answer.promise);
    render(tree({ kind: 'booking', id: 'bk-1' }));
    const button = await messageButton();
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(button).toHaveAttribute('aria-busy', 'true'));
    expect(button).toBeDisabled();
    expect(button).toHaveTextContent('Opening…');
    await act(async () => {
      answer.release([200, conversation('bk-1')]);
    });
    await waitFor(() => expect(onOpenChat).toHaveBeenCalledTimes(1));
    expect(creates()).toHaveLength(1);
    expect(button).not.toHaveAttribute('aria-busy', 'true');
  });

  it('says what went wrong, opens nothing, and works when pressed again', async () => {
    mockBooking('bk-1');
    mock
      .onPost('/v1/me/conversations')
      .networkErrorOnce()
      .onPost('/v1/me/conversations')
      .reply(200, conversation('bk-1'));
    render(tree({ kind: 'booking', id: 'bk-1' }));
    fireEvent.click(await messageButton());
    const error = await screen.findByTestId('booking-action-message-error');
    expect(error).toHaveAttribute('role', 'alert');
    expect(error).toHaveAttribute('data-error', 'NETWORK');
    expect(onOpenChat).not.toHaveBeenCalled();
    fireEvent.click(await messageButton());
    await waitFor(() => expect(onOpenChat).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('booking-action-message-error')).toBeNull();
  });

  it.each([
    [401, 'SESSION'],
    [403, 'SESSION'],
    [404, 'NOT_FOUND'],
    [500, 'UNKNOWN'],
  ] as const)('a %i is reported as %s', async (status, kind) => {
    mockBooking('bk-1');
    mock.onPost('/v1/me/conversations').reply(status, { error: { code: 'X' } });
    render(tree({ kind: 'booking', id: 'bk-1' }));
    fireEvent.click(await messageButton());
    expect(await screen.findByTestId('booking-action-message-error')).toHaveAttribute(
      'data-error',
      kind,
    );
    expect(onOpenChat).not.toHaveBeenCalled();
  });
});

describe('Message — ordering', () => {
  it('an answer for booking A, arriving while booking B is shown, opens nothing', async () => {
    mockBooking('bk-a');
    mockBooking('bk-b');
    const answerA = held<[number, unknown]>();
    mock.onPost('/v1/me/conversations').reply(() => answerA.promise);
    const view = render(tree({ kind: 'booking', id: 'bk-a' }));
    fireEvent.click(await messageButton());
    await waitFor(() => expect(creates()).toHaveLength(1));

    view.rerender(tree({ kind: 'booking', id: 'bk-b' }));
    await screen.findByText('Leaky tap');
    await waitFor(() =>
      expect(mock.history.get.some((r) => r.url === '/v1/me/bookings/bk-b')).toBe(true),
    );
    // B is not "opening" on A's behalf.
    const buttonB = await messageButton();
    expect(buttonB).not.toHaveAttribute('aria-busy', 'true');
    expect(buttonB).toBeEnabled();

    await act(async () => {
      answerA.release([200, conversation('bk-a')]);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(onOpenChat).not.toHaveBeenCalled();
    expect(screen.queryByTestId('booking-action-message-error')).toBeNull();
  });

  it('B pressed after A: only B’s answer opens, whichever arrives first', async () => {
    mockBooking('bk-a');
    mockBooking('bk-b');
    const answers: Record<string, ReturnType<typeof held<[number, unknown]>>> = {
      'bk-a': held(),
      'bk-b': held(),
    };
    mock.onPost('/v1/me/conversations').reply((config) => {
      const { bookingId } = JSON.parse(config.data as string) as { bookingId: string };
      return answers[bookingId].promise;
    });
    const view = render(tree({ kind: 'booking', id: 'bk-a' }));
    fireEvent.click(await messageButton());
    view.rerender(tree({ kind: 'booking', id: 'bk-b' }));
    await waitFor(() =>
      expect(mock.history.get.some((r) => r.url === '/v1/me/bookings/bk-b')).toBe(true),
    );
    fireEvent.click(await messageButton());
    await waitFor(() => expect(creates()).toHaveLength(2));

    // B answers first, then A.
    await act(async () => {
      answers['bk-b'].release([200, conversation('bk-b')]);
    });
    await waitFor(() => expect(onOpenChat).toHaveBeenCalledTimes(1));
    await act(async () => {
      answers['bk-a'].release([200, conversation('bk-a')]);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(onOpenChat).toHaveBeenCalledTimes(1);
    expect(onOpenChat).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: 'conv-bk-b' }),
    );
  });

  it('an answer that arrives after the screen closed opens nothing', async () => {
    mockBooking('bk-1');
    const answer = held<[number, unknown]>();
    mock.onPost('/v1/me/conversations').reply(() => answer.promise);
    const view = render(tree({ kind: 'booking', id: 'bk-1' }));
    fireEvent.click(await messageButton());
    await waitFor(() => expect(creates()).toHaveLength(1));
    view.unmount();
    await act(async () => {
      answer.release([200, conversation('bk-1')]);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(onOpenChat).not.toHaveBeenCalled();
  });

  it('an answer that arrives after another person signed in is not given to them', async () => {
    qc.setQueryData(['auth', 'me'], { id: 'user-1' });
    mockBooking('bk-1');
    const answer = held<[number, unknown]>();
    mock.onPost('/v1/me/conversations').reply(() => answer.promise);
    render(tree({ kind: 'booking', id: 'bk-1' }));
    const button = await messageButton();
    fireEvent.click(button);
    await waitFor(() => expect(creates()).toHaveLength(1));
    act(() => {
      qc.setQueryData(['auth', 'me'], { id: 'user-2' });
    });
    await act(async () => {
      answer.release([200, conversation('bk-1')]);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(onOpenChat).not.toHaveBeenCalled();
    // And the button does not stay stuck on "opening".
    expect(button).not.toHaveAttribute('aria-busy', 'true');
  });

  it('a failure for booking A is not shown on booking B', async () => {
    mockBooking('bk-a');
    mockBooking('bk-b');
    mock.onPost('/v1/me/conversations').reply(500);
    const view = render(tree({ kind: 'booking', id: 'bk-a' }));
    fireEvent.click(await messageButton());
    await screen.findByTestId('booking-action-message-error');
    view.rerender(tree({ kind: 'booking', id: 'bk-b' }));
    await waitFor(() =>
      expect(mock.history.get.some((r) => r.url === '/v1/me/bookings/bk-b')).toBe(true),
    );
    await waitFor(() => expect(screen.queryByTestId('booking-action-message-error')).toBeNull());
  });
});

describe('Call and Progress', () => {
  it('Call is not available and says so; no number appears', async () => {
    mockBooking('bk-1');
    render(tree({ kind: 'booking', id: 'bk-1' }));
    const call = await screen.findByTestId('booking-action-call');
    expect(call).toBeDisabled();
    expect(call).toHaveAccessibleDescription(
      'Calls aren’t available in the app. Use Message to reach your pro.',
    );
    expect(document.querySelector('a[href^="tel:"]')).toBeNull();
  });

  it('Progress brings the recorded timeline into focus', async () => {
    mockBooking('bk-1');
    render(tree({ kind: 'booking', id: 'bk-1' }));
    fireEvent.click(await screen.findByTestId('booking-action-progress'));
    expect(document.activeElement).toBe(screen.getByTestId('booking-progress'));
    expect(screen.getByTestId('booking-progress')).toHaveAccessibleName('Booking progress');
  });

  it('reads naturally in Arabic', async () => {
    window.localStorage.setItem('hsm.lang', 'ar');
    mockBooking('bk-1');
    render(tree({ kind: 'booking', id: 'bk-1' }));
    expect(await screen.findByRole('button', { name: 'رسالة' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'التقدّم' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'اتصال' })).toHaveAccessibleDescription(
      'المكالمات غير متاحة في التطبيق. استخدم الرسائل للتواصل مع المحترف.',
    );
  });
});

describe('Progress — the status the booking has reached', () => {
  const withStatus = (id: string, status: 'SCHEDULED' | 'IN_PROGRESS') => {
    mock.onGet(`/v1/me/bookings/${id}`).reply(200, { ...booking(id), status });
    mock.onGet(`/v1/me/bookings/${id}/timeline`).reply(200, { items: [] });
  };

  it('a scheduled booking is scheduled, with the pro assigned and nothing started', async () => {
    withStatus('bk-1', 'SCHEDULED');
    render(tree({ kind: 'booking', id: 'bk-1' }));
    expect(await screen.findByText('Scheduled')).toBeInTheDocument();
    const assigned = await screen.findByTestId('progress-step-2');
    expect(assigned).toHaveAttribute('data-done', 'true');
    expect(assigned).toHaveAttribute('data-current', 'true');
    const started = screen.getByTestId('progress-step-3');
    expect(started).toHaveAttribute('data-done', 'false');
    expect(started).toHaveAttribute('data-current', 'false');
  });

  it('a started booking is in progress', async () => {
    withStatus('bk-1', 'IN_PROGRESS');
    render(tree({ kind: 'booking', id: 'bk-1' }));
    const started = await screen.findByTestId('progress-step-3');
    await waitFor(() => expect(started).toHaveAttribute('data-current', 'true'));
    expect(screen.getByTestId('progress-step-4')).toHaveAttribute('data-done', 'false');
    expect(screen.queryByText('Scheduled')).toBeNull();
  });
});
