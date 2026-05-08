import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import MockAdapter from 'axios-mock-adapter';
import type { QueryClient } from '@tanstack/react-query';
import { api } from '../../../lib/api';
import { AuthProvider, createAuthQueryClient } from '../../../lib/auth-provider';
import { LanguageProvider } from '../../i18n/LanguageContext';
import { EditProfilePage } from './EditProfilePage';

// ─────────────────────────────────────────────────────────────────────────────
// Profile persistence stabilization: EditProfilePage now loads from
// /v1/me/profile and persists via PATCH /v1/me/profile. The legacy
// hardcoded "Ahmed Al-Khalid / +966 / Riyadh / AK" + 1.4s setTimeout
// fake save are gone.
// ─────────────────────────────────────────────────────────────────────────────

function renderEdit(appContext: 'seeker' | 'provider' = 'seeker') {
  return render(
    <AuthProvider client={qc}>
      <LanguageProvider>
        <EditProfilePage onBack={() => {}} appContext={appContext} />
      </LanguageProvider>
    </AuthProvider>,
  );
}

let mock: MockAdapter;
let qc: QueryClient;
beforeEach(() => {
  mock = new MockAdapter(api);
  qc = createAuthQueryClient();
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

// Phase 6 Step 2 — provider-only skills picker + dual-save flow.
describe('EditProfilePage — provider skills + serviceAreaCity', () => {
  const PROVIDER_ME = {
    id: 'u-prov-1',
    email: 'omar@example.com',
    firstName: 'Omar',
    lastName: 'Al-Khalid',
    status: 'ACTIVE' as const,
    emailVerifiedAt: '2026-04-19T00:00:00.000Z',
    mfaEnabled: false,
    roles: ['customer' as const, 'provider' as const],
  };
  const PROVIDER_PROFILE_ROW = {
    profile: {
      id: 'pp-omar',
      displayName: 'Omar Al-Khalid',
      initials: 'OK',
      avatarUrl: null,
      bio: null,
      headline: null,
      phoneNumber: null,
      ratingAvg: 4.9,
      reviewCount: 0,
      completedJobs: 0,
      verified: true,
      topPro: false,
      availability: 'OFFLINE' as const,
      status: 'ACTIVE' as const,
      serviceAreaCity: 'Riyadh',
      serviceAreaCountry: 'Saudi Arabia',
      serviceAreaLat: null,
      serviceAreaLng: null,
      serviceAreaRadiusKm: null,
      // Currently selected: plumbing only.
      serviceCategories: [
        { id: 'cat-plumbing', slug: 'plumbing', labelEn: 'Plumbing', labelAr: 'سباكة', icon: '🔧' },
      ],
      updatedAt: '2026-04-30T00:00:00.000Z',
    },
  };
  const SERVICES = [
    {
      id: 'cat-plumbing',
      slug: 'plumbing',
      labelEn: 'Plumbing',
      labelAr: 'سباكة',
      icon: '🔧',
      sortOrder: 0,
    },
    {
      id: 'cat-electrical',
      slug: 'electrical',
      labelEn: 'Electrical',
      labelAr: 'كهرباء',
      icon: '⚡',
      sortOrder: 1,
    },
  ];

  function mockProviderRoute(): void {
    mock.onGet('/v1/auth/me').reply(200, PROVIDER_ME);
    mock.onGet('/v1/me/profile').reply(200, {
      profile: { ...MOCK_PROFILE, displayName: 'Omar Al-Khalid', city: 'Riyadh' },
    });
    mock.onGet('/v1/me/provider/profile').reply(200, PROVIDER_PROFILE_ROW);
    mock.onGet('/v1/services').reply(200, { items: SERVICES });
  }

  it('renders the skills picker with the provider catalog and seeds the current selection (provider context)', async () => {
    mockProviderRoute();
    renderEdit('provider');

    // Catalog lands → both pills are rendered.
    await waitFor(() => {
      expect(screen.getByTestId('skill-pill-plumbing')).toBeInTheDocument();
      expect(screen.getByTestId('skill-pill-electrical')).toBeInTheDocument();
    });
    // Plumbing is currently selected (aria-pressed=true); electrical is not.
    expect(screen.getByTestId('skill-pill-plumbing').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('skill-pill-electrical').getAttribute('aria-pressed')).toBe('false');
  });

  it('does NOT render the skills picker in seeker context, even when the user has the provider role (regression for dual-role bleed)', async () => {
    // PROVIDER_ME has BOTH customer + provider roles. Pre-fix, the
    // page gated skills on roles.includes('provider') — which meant
    // /home → Edit Profile would show Skills + the blue tone for any
    // dual-role account. With context-based gating, Seeker context
    // must hide Skills regardless of role.
    mockProviderRoute();
    renderEdit('seeker');

    await waitFor(() => expect(screen.getByDisplayValue('Omar Al-Khalid')).toBeInTheDocument());
    expect(screen.queryByTestId('edit-profile-skills')).toBeNull();
    expect(screen.queryByTestId('skill-pill-plumbing')).toBeNull();
    expect(screen.queryByTestId('skill-pill-electrical')).toBeNull();
  });

  it('does NOT render the skills picker in seeker context for users without a provider role', async () => {
    mock.onGet('/v1/auth/me').reply(200, MOCK_ME_ADA);
    mock.onGet('/v1/me/profile').reply(200, { profile: MOCK_PROFILE });
    mock.onGet('/v1/me/provider/profile').reply(403, {
      error: { code: 'FORBIDDEN', message: 'forbidden' },
    });
    mock.onGet('/v1/services').reply(200, { items: SERVICES });
    renderEdit('seeker');

    await waitFor(() => expect(screen.getByDisplayValue('Ada Lovelace')).toBeInTheDocument());
    expect(screen.queryByTestId('edit-profile-skills')).toBeNull();
  });

  it('toggles a skill pill and posts categoryIds + serviceAreaCity in provider context', async () => {
    mockProviderRoute();
    let providerBody: Record<string, unknown> | null = null;
    let seekerBody: Record<string, unknown> | null = null;
    mock.onPatch('/v1/me/profile').reply((cfg) => {
      seekerBody = JSON.parse(cfg.data as string) as Record<string, unknown>;
      return [200, { profile: { ...MOCK_PROFILE, city: 'Riyadh' } }];
    });
    mock.onPatch('/v1/me/provider/profile').reply((cfg) => {
      providerBody = JSON.parse(cfg.data as string) as Record<string, unknown>;
      return [200, PROVIDER_PROFILE_ROW];
    });

    renderEdit('provider');

    await waitFor(() => expect(screen.getByTestId('skill-pill-electrical')).toBeInTheDocument());

    // Add electrical to the existing plumbing selection.
    fireEvent.click(screen.getByTestId('skill-pill-electrical'));
    expect(screen.getByTestId('skill-pill-electrical').getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: /save changes|حفظ التغييرات/i }));

    await waitFor(() => {
      expect(providerBody).not.toBeNull();
      expect(seekerBody).not.toBeNull();
    });
    expect(providerBody).toMatchObject({
      serviceAreaCity: 'Riyadh',
      categoryIds: expect.arrayContaining(['cat-plumbing', 'cat-electrical']),
    });
    // Seeker save still fires in parallel — name + city + bio path
    // is unchanged from the pre-Phase-6 contract.
    expect(seekerBody).toMatchObject({ city: 'Riyadh' });
  });

  it('seeker context does NOT post to /v1/me/provider/profile, even for a dual-role user', async () => {
    mockProviderRoute();
    let providerHits = 0;
    let seekerBody: Record<string, unknown> | null = null;
    mock.onPatch('/v1/me/profile').reply((cfg) => {
      seekerBody = JSON.parse(cfg.data as string) as Record<string, unknown>;
      return [200, { profile: { ...MOCK_PROFILE, city: 'Jeddah' } }];
    });
    mock.onPatch('/v1/me/provider/profile').reply(() => {
      providerHits += 1;
      return [200, PROVIDER_PROFILE_ROW];
    });

    renderEdit('seeker');

    await waitFor(() => expect(screen.getByDisplayValue('Omar Al-Khalid')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /save changes|حفظ التغييرات/i }));

    await waitFor(() => expect(seekerBody).not.toBeNull());
    // The provider PATCH must NEVER fire from the Seeker context.
    expect(providerHits).toBe(0);
  });
});
