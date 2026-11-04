import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import MockAdapter from 'axios-mock-adapter';
import type { SupportTicketDetailView } from '@homeservicemarketplace/contracts';

import { api } from '../../lib/api';
import { LanguageProvider } from '../i18n/LanguageContext';
import { SupportPage } from './SupportPage';

// K06 — support is a routed surface in both apps, so a notification can link
// to one ticket and a provider whose workspace is denied can still reach it.

const TICKET: SupportTicketDetailView = {
  id: 'ticket-1',
  subject: 'Work access question',
  status: 'OPEN',
  createdAt: '2026-11-03T08:00:00.000Z',
  updatedAt: '2026-11-03T08:05:00.000Z',
  closedAt: null,
  lastMessageAt: '2026-11-03T08:05:00.000Z',
  messages: [
    {
      id: 'm-1',
      authorRole: 'REQUESTER',
      body: 'Why is my access paused?',
      createdAt: '2026-11-03T08:00:00.000Z',
    },
    {
      id: 'm-2',
      authorRole: 'SUPPORT',
      body: 'We are checking your application.',
      createdAt: '2026-11-03T08:05:00.000Z',
    },
  ],
};

let mock: MockAdapter;
beforeEach(() => {
  mock = new MockAdapter(api);
  mock.onGet('/v1/me/support/tickets').reply(200, { items: [], nextCursor: null });
});
afterEach(() => {
  mock.restore();
  window.localStorage.removeItem('hsm.lang');
});

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <LanguageProvider>
        <Routes>
          <Route path="/provider/support" element={<SupportPage experience="provider" />} />
          <Route path="/home/support" element={<SupportPage experience="seeker" />} />
          <Route path="/provider" element={<h1>Provider workspace</h1>} />
          <Route path="/home/profile" element={<h1>Customer profile</h1>} />
        </Routes>
      </LanguageProvider>
    </MemoryRouter>,
  );
}

describe('SupportPage', () => {
  it('opens the ticket named by a notification link', async () => {
    mock.onGet('/v1/me/support/tickets/ticket-1').reply(200, TICKET);
    renderAt('/provider/support?ticket=ticket-1');
    expect(await screen.findByText('We are checking your application.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Work access question' })).toBeInTheDocument();
  });

  it('formats ticket timestamps in the active language', async () => {
    window.localStorage.setItem('hsm.lang', 'ar');
    mock.onGet('/v1/me/support/tickets/ticket-1').reply(200, TICKET);
    renderAt('/provider/support?ticket=ticket-1');
    await screen.findByText('We are checking your application.');
    const times = document.querySelectorAll('time');
    expect(times).toHaveLength(2);
    // Same process, same ICU: the expectation is the product's own formatter.
    const expected = new Intl.DateTimeFormat('ar', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(TICKET.messages[1].createdAt));
    expect(times[1]).toHaveAttribute('dateTime', TICKET.messages[1].createdAt);
    expect(times[1].textContent).toBe(expected);
    expect(times[1].textContent).not.toBe(new Date(TICKET.messages[1].createdAt).toLocaleString());
  });

  it('reports a ticket it cannot load and keeps the support home usable', async () => {
    mock.onGet('/v1/me/support/tickets/missing').reply(404, { code: 'NOT_FOUND' });
    renderAt('/home/support?ticket=missing');
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load support');
    expect(screen.getByRole('button', { name: 'Create ticket' })).toBeInTheDocument();
  });

  it.each([
    ['/provider/support', 'provider', 'Provider workspace'],
    ['/home/support', 'seeker', 'Customer profile'],
  ])(
    '%s records its experience on create and returns to its app',
    async (url, experience, home) => {
      let posted: Record<string, unknown> | null = null;
      mock.onPost('/v1/me/support/tickets').reply((config) => {
        posted = JSON.parse(config.data as string);
        return [201, { ticket: { ...TICKET, messages: [TICKET.messages[0]] }, replayed: false }];
      });
      renderAt(url);
      await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
      fireEvent.change(screen.getByLabelText('Subject'), { target: { value: 'Help' } });
      fireEvent.change(screen.getByLabelText('Describe the problem or question'), {
        target: { value: 'Please check my account.' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Create ticket' }));
      await waitFor(() => expect(posted).not.toBeNull());
      expect(posted).toMatchObject({ subject: 'Help', experience });

      // Back from the ticket returns to the list; back again leaves support.
      fireEvent.click(await screen.findByRole('button', { name: 'Back' }));
      fireEvent.click(screen.getByRole('button', { name: 'Back' }));
      expect(await screen.findByRole('heading', { name: home })).toBeInTheDocument();
    },
  );
});
