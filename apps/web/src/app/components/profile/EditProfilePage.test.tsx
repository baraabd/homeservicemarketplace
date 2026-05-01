import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import MockAdapter from 'axios-mock-adapter';
import { api } from '../../../lib/api';
import { AuthProvider, queryClient } from '../../../lib/auth-provider';
import { LanguageProvider } from '../../i18n/LanguageContext';
import { EditProfilePage } from './EditProfilePage';

// ─────────────────────────────────────────────────────────────────────────────
// Profile persistence stabilization: EditProfilePage now loads from
// /v1/me/profile and persists via PATCH /v1/me/profile. The legacy
// hardcoded "Ahmed Al-Khalid / +966 / Riyadh / AK" + 1.4s setTimeout
// fake save are gone.
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

const MOCK_PROFILE = {
  firstName: 'Ada',
  lastName: 'Lovelace',
  displayName: 'Ada Lovelace',
  initials: 'AL',
  email: 'ada@example.com',
  phoneNumber: null,
  city: null,
  bio: null,
  avatarUrl: null,
  updatedAt: '2026-04-30T00:00:00.000Z',
};

describe('EditProfilePage — loads from API', () => {
  it('renders the profile fields from /v1/me/profile (no hardcoded fallbacks)', async () => {
    mock.onGet('/v1/auth/me').reply(200, MOCK_ME_ADA);
    mock.onGet('/v1/me/profile').reply(200, { profile: MOCK_PROFILE });

    renderEdit();

    await waitFor(() => {
      expect(screen.getByDisplayValue('Ada Lovelace')).toBeInTheDocument();
    });
    expect(screen.getByDisplayValue('ada@example.com')).toBeInTheDocument();
    expect(screen.getByText('AL')).toBeInTheDocument();

    // Legacy hardcoded values must never appear.
    expect(screen.queryByDisplayValue('Ahmed Al-Khalid')).toBeNull();
    expect(screen.queryByDisplayValue('ahmed@fixnow.app')).toBeNull();
    expect(screen.queryByDisplayValue('+966 50 123 4567')).toBeNull();
    expect(screen.queryByDisplayValue('Riyadh')).toBeNull();
    expect(screen.queryByText('AK')).toBeNull();
  });

  it('seeds phone / city / bio from the API response when they exist', async () => {
    mock.onGet('/v1/auth/me').reply(200, MOCK_ME_ADA);
    mock.onGet('/v1/me/profile').reply(200, {
      profile: {
        ...MOCK_PROFILE,
        phoneNumber: '+1 555 0100',
        city: 'Palo Alto',
        bio: 'Pioneer of computing.',
      },
    });

    renderEdit();

    await waitFor(() => {
      expect(screen.getByDisplayValue('+1 555 0100')).toBeInTheDocument();
    });
    expect(screen.getByDisplayValue('Palo Alto')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Pioneer of computing.')).toBeInTheDocument();
  });
});

describe('EditProfilePage — Save Changes persists', () => {
  it('Save button calls PATCH /v1/me/profile with the form values', async () => {
    mock.onGet('/v1/auth/me').reply(200, MOCK_ME_ADA);
    mock.onGet('/v1/me/profile').reply(200, { profile: MOCK_PROFILE });
    let postedBody: Record<string, unknown> = {};
    mock.onPatch('/v1/me/profile').reply((config) => {
      postedBody = JSON.parse(config.data as string) as Record<string, unknown>;
      return [
        200,
        {
          profile: {
            ...MOCK_PROFILE,
            firstName: 'Grace',
            lastName: 'Hopper',
            displayName: 'Grace Hopper',
            initials: 'GH',
            phoneNumber: '+1 555 0100',
            city: 'Palo Alto',
            bio: 'Compiler pioneer.',
          },
        },
      ];
    });

    renderEdit();
    await waitFor(() => expect(screen.getByDisplayValue('Ada Lovelace')).toBeInTheDocument());

    // Edit the form.
    fireEvent.change(screen.getByDisplayValue('Ada Lovelace'), {
      target: { value: 'Grace Hopper' },
    });
    // The phone / city / bio fields are empty initially. Find them
    // by their associated labels via the TextField placeholder/label
    // — easier to do via label text:
    const inputs = screen.getAllByRole('textbox') as HTMLInputElement[];
    const phoneInput = inputs.find((i) => i.type === 'tel');
    const cityInput = inputs.find((i) => i.type === 'text' && i.value === '' && i.tabIndex !== -1);
    if (phoneInput) fireEvent.change(phoneInput, { target: { value: '+1 555 0100' } });
    if (cityInput) fireEvent.change(cityInput, { target: { value: 'Palo Alto' } });

    // Click Save Changes.
    fireEvent.click(screen.getByRole('button', { name: /save changes|حفظ التغييرات/i }));

    await waitFor(() => expect(postedBody.firstName).toBe('Grace'));
    expect(postedBody.lastName).toBe('Hopper');
    // PATCH never carries email / userId / role / status.
    expect(postedBody).not.toHaveProperty('email');
    expect(postedBody).not.toHaveProperty('userId');
    expect(postedBody).not.toHaveProperty('role');
  });

  it('shows the success state ONLY after the backend returns 200 (no fake setTimeout)', async () => {
    mock.onGet('/v1/auth/me').reply(200, MOCK_ME_ADA);
    mock.onGet('/v1/me/profile').reply(200, { profile: MOCK_PROFILE });
    let resolveSave: ((v: [number, unknown]) => void) | null = null;
    const pending = new Promise<[number, unknown]>((r) => {
      resolveSave = r;
    });
    mock.onPatch('/v1/me/profile').reply(() => pending);

    renderEdit();
    await waitFor(() => expect(screen.getByDisplayValue('Ada Lovelace')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /save changes|حفظ التغييرات/i }));

    // While the PATCH is in flight, the success banner is NOT shown.
    expect(screen.queryByText(/Saved successfully|تم الحفظ بنجاح/)).toBeNull();

    // Resolve the backend → success appears.
    resolveSave?.([200, { profile: MOCK_PROFILE }]);
    await waitFor(() =>
      expect(screen.getByText(/Saved successfully|تم الحفظ بنجاح/)).toBeInTheDocument(),
    );
  });

  it('shows a safe error on 400 (no raw backend payload in DOM)', async () => {
    mock.onGet('/v1/auth/me').reply(200, MOCK_ME_ADA);
    mock.onGet('/v1/me/profile').reply(200, { profile: MOCK_PROFILE });
    mock.onPatch('/v1/me/profile').reply(400, {
      error: {
        code: 'VALIDATION_ERROR',
        message: 'PrismaClientKnownRequestError: bio too long',
      },
    });

    renderEdit();
    await waitFor(() => expect(screen.getByDisplayValue('Ada Lovelace')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /save changes|حفظ التغييرات/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
    // Friendly copy is shown.
    expect(screen.getByText(/Check your input|تحقق من البيانات/i)).toBeInTheDocument();
    // Raw backend message must NEVER reach the DOM.
    expect(screen.queryByText(/PrismaClient/i)).toBeNull();
    expect(screen.queryByText(/bio too long/i)).toBeNull();
  });

  it('email field stays read-only (legacy hardcoded address never appears)', async () => {
    mock.onGet('/v1/auth/me').reply(200, MOCK_ME_ADA);
    mock.onGet('/v1/me/profile').reply(200, { profile: MOCK_PROFILE });

    renderEdit();
    await waitFor(() => expect(screen.getByDisplayValue('ada@example.com')).toBeInTheDocument());
    // The email-cannot-be-changed hint is rendered next to the field.
    expect(screen.getByText(/Email cannot be changed|لا يمكن تغيير البريد/i)).toBeInTheDocument();
    // The legacy hardcoded address never appears.
    expect(screen.queryByDisplayValue('ahmed@fixnow.app')).toBeNull();
  });
});
