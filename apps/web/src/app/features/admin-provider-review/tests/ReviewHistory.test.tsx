import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import MockAdapter from 'axios-mock-adapter';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AdminProviderReviewHistoryItem } from '@homeservicemarketplace/contracts';
import { api } from '../../../../lib/api';
import { ReviewHistory } from '../components/ReviewHistory';

let mock: MockAdapter;
const PATH = '/v1/admin/providers/provider-1/review/history';
const event: AdminProviderReviewHistoryItem = {
  id: 'event-1',
  kind: 'CHANGES_REQUESTED',
  occurredAt: '2026-09-15T12:00:00Z',
  actor: { id: 'admin-1', displayName: 'Reviewer One' },
  submission: {
    id: 'submission-1',
    submittedAt: '2026-09-14T12:00:00Z',
    policyVersion: 'policy-v1',
    reviewedRevision: 'a'.repeat(64),
  },
  subject: null,
  contentRevision: null,
  reason: null,
  privateNote: 'Internal only',
  feedback: {
    requestedAt: '2026-09-15T12:00:00Z',
    items: [
      {
        id: 'f1',
        taskId: 'WORK_AREA',
        field: 'serviceAreaCity',
        reasonCode: 'INFORMATION_INCORRECT',
        providerMessage: 'Confirm the city.',
      },
    ],
  },
};
function setup() {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <ReviewHistory providerId="provider-1" lang="en" />
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  mock = new MockAdapter(api);
});
afterEach(() => {
  mock.restore();
});

describe('unified review history', () => {
  it.each([401, 403, 404])(
    'hides cached private history when a refresh denies access with %s',
    async (status) => {
      mock.onGet(PATH).replyOnce(200, { items: [event], nextCursor: null });
      mock.onGet(PATH).reply(status);
      setup();
      expect(await screen.findByText('Internal only')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
      await waitFor(() => expect(screen.queryByText('Internal only')).not.toBeInTheDocument());
      expect(screen.queryByText('Reviewer One')).not.toBeInTheDocument();
      expect(screen.queryByText('Confirm the city.')).not.toBeInTheDocument();
      expect(screen.getByRole('alert')).toBeInTheDocument();
    },
  );
  it('shows the reviewer, recorded submission, private context and targeted provider instructions', async () => {
    mock.onGet(PATH).reply(200, { items: [event], nextCursor: null });
    setup();
    expect(await screen.findByText('Reviewer One')).toBeInTheDocument();
    expect(screen.getByText('policy-v1')).toBeInTheDocument();
    expect(screen.getByText('submission-1')).toBeInTheDocument();
    expect(screen.getByText('Internal only')).toBeInTheDocument();
    expect(screen.getByText('Confirm the city.')).toBeInTheDocument();
    expect(screen.getByText(/City and service area/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Load earlier events' })).not.toBeInTheDocument();
  });
  it('loads subsequent pages with the server cursor and keeps independent decisions independent', async () => {
    mock.onGet(PATH).reply((config) =>
      config.params.cursor
        ? [
            200,
            {
              items: [
                {
                  ...event,
                  id: 'event-2',
                  kind: 'IDENTITY_APPROVED',
                  submission: null,
                  feedback: null,
                  privateNote: null,
                },
              ],
              nextCursor: null,
            },
          ]
        : [200, { items: [event], nextCursor: 'event-1' }],
    );
    setup();
    fireEvent.click(await screen.findByRole('button', { name: 'Load earlier events' }));
    expect(await screen.findByText('Identity verified')).toBeInTheDocument();
    expect(screen.getAllByText('Reviewed submission')).toHaveLength(1);
    expect(mock.history.get[1].params.cursor).toBe('event-1');
  });
  it('offers retry after a failed page without claiming the history is empty', async () => {
    mock.onGet(PATH).replyOnce(503);
    mock.onGet(PATH).reply(200, { items: [event], nextCursor: null });
    setup();
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load history');
    expect(screen.queryByText('No decision has been recorded.')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(screen.getByText('Reviewer One')).toBeInTheDocument());
  });
});
