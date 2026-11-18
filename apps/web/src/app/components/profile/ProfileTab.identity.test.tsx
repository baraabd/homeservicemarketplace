import { afterEach, beforeEach, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import MockAdapter from 'axios-mock-adapter';
import type { QueryClient } from '@tanstack/react-query';
import { api } from '../../../lib/api';
import { AuthProvider, createAuthQueryClient } from '../../../lib/auth-provider';
import { LanguageProvider } from '../../i18n/LanguageContext';
import { ProfileTab } from './ProfileTab';

await Promise.all([import('./SettingsPage'), import('./AccountSignInSettings')]);

let mock: MockAdapter;
let client: QueryClient;
beforeEach(() => {
  mock = new MockAdapter(api);
  client = createAuthQueryClient();
});

it('opens sign-in contact linking from the customer profile Settings entry', async () => {
  mock.onGet('/v1/auth/me').reply(200, {
    id: 'email-customer',
    email: 'layla@example.test',
    firstName: 'Layla',
    lastName: 'Mansour',
    status: 'ACTIVE',
    phoneNumber: null,
    phoneVerifiedAt: null,
    emailVerifiedAt: '2026-11-18T00:00:00.000Z',
    mfaEnabled: false,
    roles: ['customer'],
  });
  mock.onGet('/v1/auth/config').reply(200, { otpChannel: 'whatsapp', whatsappAvailable: true });
  render(
    <MemoryRouter>
      <AuthProvider client={client}>
        <LanguageProvider>
          <ProfileTab
            notifications={[]}
            onMarkAllRead={() => {}}
            onMarkRead={() => {}}
            unreadCount={0}
          />
        </LanguageProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
  expect(await screen.findByRole('heading', { name: 'Sign-in methods' })).toBeInTheDocument();
  expect(await screen.findByLabelText('WhatsApp phone number')).toBeInTheDocument();
});
afterEach(() => {
  mock.restore();
  client.clear();
});

it('shows the authenticated phone number when the account has no email', async () => {
  mock.onGet('/v1/auth/me').reply(200, {
    id: 'phone-user',
    email: null,
    phoneNumber: '+963944123456',
    firstName: 'Layla',
    lastName: 'Mansour',
    status: 'ACTIVE',
    phoneVerifiedAt: '2026-11-18T00:00:00.000Z',
    emailVerifiedAt: null,
    mfaEnabled: false,
    roles: ['customer'],
  });
  render(
    <AuthProvider client={client}>
      <LanguageProvider>
        <ProfileTab
          notifications={[]}
          onMarkAllRead={() => {}}
          onMarkRead={() => {}}
          unreadCount={0}
        />
      </LanguageProvider>
    </AuthProvider>,
  );
  expect(await screen.findByText('+963944123456')).toHaveAttribute('dir', 'ltr');
  expect(screen.getByTestId('profile-hero-name')).toHaveTextContent('Layla Mansour');
  expect(screen.getByTestId('profile-hero-avatar')).toHaveTextContent('LM');
});
