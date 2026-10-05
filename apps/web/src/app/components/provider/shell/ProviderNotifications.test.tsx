import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import MockAdapter from 'axios-mock-adapter';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { api } from '../../../../lib/api';
import { LanguageProvider } from '../../../i18n/LanguageContext';
import {
  ProviderNotificationsBellButton,
  ProviderNotificationsDrawer,
} from './ProviderNotifications';

// R17-B — the provider drawer and bell (docs/production-readiness/r17/R17_B_NOTIFICATIONS.md).

function renderWith(node: React.ReactNode) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <LanguageProvider>{node}</LanguageProvider>
    </QueryClientProvider>,
  );
}

const row = (id: string, title: string, readAt: string | null = null) => ({
  id,
  type: 'BID_ACCEPTED',
  title,
  body: `${title} body`,
  resourceType: 'BID',
  resourceId: 'bid-1',
  deepLink: `/provider/bids/${id}`,
  metadata: null,
  readAt,
  createdAt: '2026-10-05T10:00:00.000Z',
});

let mock: MockAdapter;
beforeEach(() => {
  mock = new MockAdapter(api);
});
afterEach(() => mock.restore());

describe('ProviderNotificationsDrawer — R17-B', () => {
  it('B-2: read-all names exactly the unread notifications on screen, in the provider experience', async () => {
    mock.onGet('/v1/me/notifications').reply(200, {
      items: [
        row('p-1', 'Unread one'),
        row('p-2', 'Unread two'),
        row('p-3', 'Old', '2026-10-05T11:00:00.000Z'),
      ],
      nextCursor: null,
    });
    let sent: unknown = null;
    mock.onPost('/v1/me/notifications/read-all').reply((config) => {
      sent = { params: config.params, body: JSON.parse(config.data as string) };
      return [200, { updatedCount: 2 }];
    });

    renderWith(<ProviderNotificationsDrawer onClose={() => {}} />);
    await screen.findByText('Unread two');
    fireEvent.click(screen.getByRole('button', { name: 'Mark all read' }));

    await waitFor(() => expect(sent).not.toBeNull());
    expect(sent).toEqual({ params: { experience: 'provider' }, body: { ids: ['p-1', 'p-2'] } });
  });

  it('B-5: a failed load says so instead of showing an empty inbox', async () => {
    mock.onGet('/v1/me/notifications').reply(503, {});
    renderWith(<ProviderNotificationsDrawer onClose={() => {}} />);
    expect(await screen.findByText('Could not load notifications.')).toBeInTheDocument();
    expect(screen.queryByText('No notifications yet.')).toBeNull();
  });
});

describe('ProviderNotificationsBellButton — R17-B', () => {
  it('B-5: an unreadable count is announced as unavailable, not as nothing unread', async () => {
    mock.onGet('/v1/me/notifications/unread-count').reply(503, {});
    renderWith(<ProviderNotificationsBellButton onOpen={() => {}} />);
    expect(
      await screen.findByRole('button', {
        name: 'Open notifications, unread count couldn’t be loaded',
      }),
    ).toBeInTheDocument();
  });

  it('B-9: shows the server count, capped only for display', async () => {
    mock.onGet('/v1/me/notifications/unread-count').reply(200, { count: 130 });
    renderWith(<ProviderNotificationsBellButton onOpen={() => {}} />);
    const bell = await screen.findByRole('button', { name: 'Open notifications, 130 unread' });
    expect(bell).toHaveTextContent('99+');
  });
});
