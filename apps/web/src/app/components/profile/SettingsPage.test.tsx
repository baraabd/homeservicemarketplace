import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import MockAdapter from 'axios-mock-adapter';

import { api } from '../../../lib/api';
import { AuthProvider, createAuthQueryClient } from '../../../lib/auth-provider';
import { LanguageProvider } from '../../i18n/LanguageContext';
import { SettingsPage } from './SettingsPage';

// R17-B (B-8) — no notification switch may claim a channel or a saved choice
// that does not exist. docs/production-readiness/r17/R17_B_NOTIFICATION_POLICY.md

function renderSettings() {
  return render(
    <AuthProvider client={createAuthQueryClient()}>
      <LanguageProvider>
        <MemoryRouter>
          <SettingsPage onBack={() => {}} />
        </MemoryRouter>
      </LanguageProvider>
    </AuthProvider>,
  );
}

let mock: MockAdapter;
beforeEach(() => {
  mock = new MockAdapter(api);
  mock.onGet('/v1/auth/me').reply(401, {});
});
afterEach(() => mock.restore());

describe('SettingsPage — R17-B notification honesty', () => {
  it('offers no push, email, SMS or bid-alert switch, and says what is true', () => {
    renderSettings();
    for (const label of [
      'Push Notifications',
      'Email Notifications',
      'SMS Notifications',
      'New Bid Alerts',
    ]) {
      expect(screen.queryByText(label)).toBeNull();
    }
    const info = screen.getByTestId('settings-notifications-info');
    expect(info).toHaveTextContent('In-app notifications');
    expect(info).toHaveTextContent(
      'Choosing push, email or SMS notifications isn’t available yet, and the app sends none of them.',
    );
    expect(info.querySelector('button')).toBeNull();
  });
});
