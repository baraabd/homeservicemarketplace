import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import MockAdapter from 'axios-mock-adapter';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { api } from '../../../../lib/api';
import { LanguageProvider } from '../../../i18n/LanguageContext';
import { BookingActions } from './BookingActions';

// R17-E (E-4) — booking actions say what the server did, and only that.

const START = '/v1/provider/bookings/bk-1/start';
const COMPLETE = '/v1/provider/bookings/bk-1/complete';
const CANCEL = '/v1/provider/bookings/bk-1/cancel';
const booking = (status: string) => ({ booking: { id: 'bk-1', status } });

let mock: MockAdapter;
let qc: QueryClient;
beforeEach(() => {
  mock = new MockAdapter(api, { delayResponse: 20 });
  qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  window.localStorage.removeItem('hsm.lang');
});
afterEach(() => {
  mock.restore();
  qc.clear();
});

function renderActions(status: 'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED') {
  return render(
    <QueryClientProvider client={qc}>
      <LanguageProvider>
        <BookingActions bookingId="bk-1" status={status} />
      </LanguageProvider>
    </QueryClientProvider>,
  );
}

describe('BookingActions', () => {
  it('offers exactly the transitions of each state', () => {
    const { unmount } = renderActions('SCHEDULED');
    expect(screen.getByTestId('provider-booking-start-bk-1')).toBeInTheDocument();
    expect(screen.getByTestId('provider-booking-cancel-bk-1')).toBeInTheDocument();
    expect(screen.queryByTestId('provider-booking-complete-bk-1')).toBeNull();
    unmount();
    renderActions('IN_PROGRESS');
    expect(screen.getByTestId('provider-booking-complete-bk-1')).toBeInTheDocument();
    expect(screen.queryByTestId('provider-booking-cancel-bk-1')).toBeNull();
  });

  it.each(['COMPLETED', 'CANCELLED'] as const)('offers nothing for a %s booking', (status) => {
    renderActions(status);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('shows "Starting…" while in flight and "Job started" only after the server confirmed', async () => {
    mock.onPost(START).reply(200, booking('IN_PROGRESS'));
    renderActions('SCHEDULED');
    fireEvent.click(screen.getByTestId('provider-booking-start-bk-1'));
    expect(await screen.findByText('Starting…')).toBeInTheDocument();
    expect(screen.queryByTestId('provider-booking-action-done-bk-1')).toBeNull();
    // Both actions are locked while one is in flight.
    expect(screen.getByTestId('provider-booking-cancel-bk-1')).toBeDisabled();
    expect(await screen.findByTestId('provider-booking-action-done-bk-1')).toHaveTextContent(
      'Job started.',
    );
    expect(mock.history.post.filter((r) => r.url === START)).toHaveLength(1);
  });

  it.each([
    [403, 'FORBIDDEN', /can’t make this change/],
    [404, 'NOT_FOUND', /isn’t available to you/],
    [409, 'CONFLICT', /changed in the meantime/],
    [500, 'UNKNOWN', /didn’t work/],
  ])('HTTP %s is reported as %s, never as success', async (status, kind, text) => {
    mock.onPost(COMPLETE).reply(status, { error: { code: 'X', message: 'PrismaClient secret' } });
    renderActions('IN_PROGRESS');
    fireEvent.click(screen.getByTestId('provider-booking-complete-bk-1'));
    const error = await screen.findByTestId('provider-booking-action-error-bk-1');
    expect(error).toHaveAttribute('data-error', kind);
    expect(error).toHaveTextContent(text);
    expect(error).toHaveAttribute('role', 'alert');
    expect(screen.queryByTestId('provider-booking-action-done-bk-1')).toBeNull();
    expect(screen.queryByText(/PrismaClient/)).toBeNull();
  });

  it('a lost response says the change may not have been saved, and does not retry', async () => {
    mock.onPost(START).networkError();
    renderActions('SCHEDULED');
    fireEvent.click(screen.getByTestId('provider-booking-start-bk-1'));
    expect(await screen.findByTestId('provider-booking-action-error-bk-1')).toHaveAttribute(
      'data-error',
      'NETWORK',
    );
    expect(mock.history.post.filter((r) => r.url === START)).toHaveLength(1);
  });

  it('any outcome re-reads the bookings and bids from the server', async () => {
    mock.onPost(START).reply(409, { error: { code: 'CONFLICT' } });
    const invalidated: unknown[] = [];
    const original = qc.invalidateQueries.bind(qc);
    qc.invalidateQueries = ((filters: { queryKey?: unknown }) => {
      invalidated.push(filters?.queryKey);
      return original(filters as never);
    }) as typeof qc.invalidateQueries;
    renderActions('SCHEDULED');
    fireEvent.click(screen.getByTestId('provider-booking-start-bk-1'));
    await screen.findByTestId('provider-booking-action-error-bk-1');
    await waitFor(() => {
      expect(invalidated).toContainEqual(['provider', 'bookings']);
      expect(invalidated).toContainEqual(['provider', 'bids']);
    });
  });

  it('cancel asks first: keeping the booking sends nothing; confirming sends one cancel', async () => {
    mock.onPost(CANCEL).reply(200, booking('CANCELLED'));
    renderActions('SCHEDULED');
    const trigger = screen.getByTestId('provider-booking-cancel-bk-1');
    fireEvent.click(trigger);
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('Cancel this booking?');
    // The safe choice holds focus first.
    await waitFor(() =>
      expect(screen.getByTestId('provider-booking-cancel-dialog-bk-1-keep')).toHaveFocus(),
    );
    fireEvent.click(screen.getByTestId('provider-booking-cancel-dialog-bk-1-keep'));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(mock.history.post).toHaveLength(0);
    // Focus returns to the control that opened the dialog.
    await waitFor(() => expect(trigger).toHaveFocus());

    fireEvent.click(trigger);
    fireEvent.click(await screen.findByTestId('provider-booking-cancel-dialog-bk-1-confirm'));
    expect(await screen.findByTestId('provider-booking-action-done-bk-1')).toHaveTextContent(
      'Booking cancelled.',
    );
    expect(mock.history.post.filter((r) => r.url === CANCEL)).toHaveLength(1);
  });

  it('Escape closes the cancel dialog without cancelling', async () => {
    renderActions('SCHEDULED');
    fireEvent.click(screen.getByTestId('provider-booking-cancel-bk-1'));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(mock.history.post).toHaveLength(0);
  });

  it('speaks Arabic, with the dialog in RTL', async () => {
    window.localStorage.setItem('hsm.lang', 'ar');
    renderActions('SCHEDULED');
    expect(screen.getByTestId('provider-booking-start-bk-1')).toHaveTextContent('ابدأ العمل');
    fireEvent.click(screen.getByTestId('provider-booking-cancel-bk-1'));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveAttribute('dir', 'rtl');
    expect(dialog).toHaveTextContent('إلغاء هذا الحجز؟');
  });
});
