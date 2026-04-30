import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import MockAdapter from 'axios-mock-adapter';
import { api } from '../../../lib/api';
import { AuthProvider, queryClient } from '../../../lib/auth-provider';
import { LanguageProvider } from '../../i18n/LanguageContext';
import { EditProfilePage } from './EditProfilePage';

// ─────────────────────────────────────────────────────────────────────────────
// Stabilization fix (defect #2): EditProfilePage seeded the form with
// hardcoded "Ahmed Al-Khalid / +966 50 123 4567 / ahmed@fixnow.app /
// Riyadh / AK" placeholders. We now derive name + email + initials
// from the authenticated user via useAuthIdentity. Phone / city / bio
// start empty until a Profile API ships.
// ─────────────────────────────────────────────────────────────────────────────

function renderEdit() {
  return render(
    <AuthProvider>
      <LanguageProvider>
        <EditProfilePage onBack={() => {}} />
      </LanguageProvider>
    </AuthProvider>,
  );
}

let mock: MockAdapter;
beforeEach(() => {
  mock = new MockAdapter(api);
  queryClient.clear();
});
afterEach(() => {
  mock.restore();
  document.cookie.split(';').forEach((c) => {
    const name = c.split('=')[0]?.trim();
    if (name) document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/`;
  });
});

const MOCK_ME_ADA = {
  id: 'u1',
  email: 'ada@example.com',
  firstName: 'Ada',
  lastName: 'Lovelace',
  status: 'ACTIVE' as const,
  emailVerifiedAt: '2026-04-19T00:00:00.000Z',
  mfaEnabled: false,
  roles: ['customer' as const],
};

describe('EditProfilePage — defect #2', () => {
  it('renders the authenticated user name + email, not hardcoded placeholders', async () => {
    mock.onGet('/v1/auth/me').reply(200, MOCK_ME_ADA);

    renderEdit();

    await waitFor(() => {
      // Real name in the Full Name input.
      const nameField = screen.getByDisplayValue('Ada Lovelace');
      expect(nameField).toBeInTheDocument();
    });
    // Real email in the Email field.
    expect(screen.getByDisplayValue('ada@example.com')).toBeInTheDocument();
    // Real initials in the avatar tile.
    expect(screen.getByText('AL')).toBeInTheDocument();

    // None of the legacy hardcoded values appear.
    expect(screen.queryByDisplayValue('Ahmed Al-Khalid')).toBeNull();
    expect(screen.queryByDisplayValue('ahmed@fixnow.app')).toBeNull();
    expect(screen.queryByDisplayValue('+966 50 123 4567')).toBeNull();
    expect(screen.queryByDisplayValue('Riyadh')).toBeNull();
    expect(screen.queryByText('AK')).toBeNull();
  });

  it('phone / city / bio start empty (no fake +966 / Riyadh fallbacks)', async () => {
    mock.onGet('/v1/auth/me').reply(200, MOCK_ME_ADA);

    renderEdit();

    await waitFor(() => expect(screen.getByDisplayValue('Ada Lovelace')).toBeInTheDocument());

    // Phone + city inputs start empty — there is no /v1/auth/me
    // payload field for these yet, and we never inject the slice-2
    // hardcoded placeholders.
    expect(screen.queryByDisplayValue(/\+966/)).toBeNull();
    expect(screen.queryByDisplayValue(/Riyadh|الرياض/)).toBeNull();
  });
});
