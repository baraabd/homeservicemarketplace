import { afterEach, beforeEach, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import MockAdapter from 'axios-mock-adapter';
import type { QueryClient } from '@tanstack/react-query';
import { api } from '../../../lib/api';
import { AuthProvider, createAuthQueryClient } from '../../../lib/auth-provider';
import { LanguageProvider } from '../../i18n/LanguageContext';
import { ProfileTab } from './ProfileTab';

let mock: MockAdapter;
let client: QueryClient;
beforeEach(() => {
  mock = new MockAdapter(api);
  client = createAuthQueryClient();
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
