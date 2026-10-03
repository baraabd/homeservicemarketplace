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

  it('renders the persisted avatar URL and exposes no fake Change Photo control', async () => {
    mock.onGet('/v1/auth/me').reply(200, MOCK_ME_ADA);
    mock.onGet('/v1/me/profile').reply(200, {
      profile: { ...MOCK_PROFILE, avatarUrl: 'https://cdn.example.test/avatars/ada.png' },
    });

    renderEdit();
    const image = await screen.findByTestId('profile-avatar-image');
    expect(image).toHaveAttribute('src', 'https://cdn.example.test/avatars/ada.png');
    expect(screen.queryByRole('button', { name: /change photo|تغيير الصورة/i })).toBeNull();
  });

  it('falls back to persisted initials when the profile has no avatar URL', async () => {
    mock.onGet('/v1/auth/me').reply(200, MOCK_ME_ADA);
    mock.onGet('/v1/me/profile').reply(200, { profile: MOCK_PROFILE });

    renderEdit();
    // The fallback shell mounts before the profile request resolves. Wait for
    // the server-projected initials instead of treating the initial empty shell
    // as the final rendered state.
    await waitFor(() =>
      expect(screen.getByTestId('profile-avatar-fallback')).toHaveTextContent('AL'),
    );
    expect(screen.queryByText(/change photo|تغيير الصورة/i)).toBeNull();
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
// A late answer from the server must not overwrite what the person typed.
//
// The form re-seeds when the profile's `updatedAt` changes. A background
// refetch that lands AFTER the fields were edited carried a newer `updatedAt`
// (registration and email verification both touch the row), re-seeded the
// name, phone and city with the stored values, and Save then sent the old
// values back with a 200. The R05 real-browser acceptance failed on exactly
// this, about one run in five.
describe('EditProfilePage — a late refetch does not overwrite edits', () => {
  it('keeps the typed name, phone and city, and saves them', async () => {
    mock.onGet('/v1/auth/me').reply(200, MOCK_ME_ADA);
    let served = { ...MOCK_PROFILE, phoneNumber: '+1 555 0000', city: 'London' };
    mock.onGet('/v1/me/profile').reply(() => [200, { profile: served }]);
    let postedBody: Record<string, unknown> = {};
    mock.onPatch('/v1/me/profile').reply((config) => {
      postedBody = JSON.parse(config.data as string) as Record<string, unknown>;
      return [200, { profile: { ...served, displayName: 'Grace Hopper' } }];
    });

    renderEdit();
    await waitFor(() => expect(screen.getByDisplayValue('Ada Lovelace')).toBeInTheDocument());

    fireEvent.change(screen.getByDisplayValue('Ada Lovelace'), {
      target: { value: 'Grace Hopper' },
    });
    fireEvent.change(screen.getByDisplayValue('+1 555 0000'), {
      target: { value: '+1 555 0100' },
    });
    fireEvent.change(screen.getByDisplayValue('London'), { target: { value: 'Palo Alto' } });

    // The server answers again, with the same stored values and a newer stamp.
    served = { ...served, updatedAt: '2026-05-01T00:00:00.000Z' };
    await qc.invalidateQueries();
    await waitFor(() =>
      expect(mock.history.get.filter((r) => r.url === '/v1/me/profile').length).toBeGreaterThan(1),
    );
    // Let the refetched data reach the component.
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(screen.getByDisplayValue('Grace Hopper')).toBeInTheDocument();
    expect(screen.getByDisplayValue('+1 555 0100')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Palo Alto')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /save changes|حفظ التغييرات/i }));
    await waitFor(() => expect(postedBody.firstName).toBe('Grace'));
    expect(postedBody).toMatchObject({
      lastName: 'Hopper',
      phoneNumber: '+1 555 0100',
      city: 'Palo Alto',
    });
  });

  it('still takes a newer server value for a field the person has not touched', async () => {
    mock.onGet('/v1/auth/me').reply(200, MOCK_ME_ADA);
    let served = { ...MOCK_PROFILE, city: 'London' };
    mock.onGet('/v1/me/profile').reply(() => [200, { profile: served }]);

    renderEdit();
    await waitFor(() => expect(screen.getByDisplayValue('Ada Lovelace')).toBeInTheDocument());
    fireEvent.change(screen.getByDisplayValue('Ada Lovelace'), {
      target: { value: 'Grace Hopper' },
    });

    served = { ...served, city: 'Cambridge', updatedAt: '2026-05-01T00:00:00.000Z' };
    await qc.invalidateQueries();

    // The untouched city follows the server; the edited name does not.
    await waitFor(() => expect(screen.getByDisplayValue('Cambridge')).toBeInTheDocument());
    expect(screen.getByDisplayValue('Grace Hopper')).toBeInTheDocument();
  });

  it('follows the server again after a successful save', async () => {
    mock.onGet('/v1/auth/me').reply(200, MOCK_ME_ADA);
    let served = { ...MOCK_PROFILE };
    mock.onGet('/v1/me/profile').reply(() => [200, { profile: served }]);
    mock.onPatch('/v1/me/profile').reply(() => {
      // The server normalises what it stores.
      served = {
        ...served,
        displayName: 'Grace B. Hopper',
        updatedAt: '2026-05-02T00:00:00.000Z',
      };
      return [200, { profile: served }];
    });

    renderEdit();
    await waitFor(() => expect(screen.getByDisplayValue('Ada Lovelace')).toBeInTheDocument());
    fireEvent.change(screen.getByDisplayValue('Ada Lovelace'), {
      target: { value: 'Grace Hopper' },
    });
    fireEvent.click(screen.getByRole('button', { name: /save changes|حفظ التغييرات/i }));

    // Once saved, the field shows what the server holds, not what was typed.
    await waitFor(() => expect(screen.getByDisplayValue('Grace B. Hopper')).toBeInTheDocument());
  });
});

// Every ordering of "the person edits" against "the server answers", driven
// explicitly rather than hoped for: each test decides when a response lands.
describe('EditProfilePage — form state belongs to the person until a save is acknowledged', () => {
  const STORED = {
    ...MOCK_PROFILE,
    phoneNumber: '+1 555 0000',
    city: 'London',
    bio: 'Analyst.',
  };
  const T2 = '2026-05-02T00:00:00.000Z';
  const T3 = '2026-05-03T00:00:00.000Z';
  const saveButton = () => screen.getByRole('button', { name: /save changes|حفظ التغييرات/i });
  const nameField = () => screen.getByLabelText(/full name|الاسم الكامل/i) as HTMLInputElement;
  const phoneField = () =>
    (screen.getAllByRole('textbox') as HTMLInputElement[]).find((i) => i.type === 'tel')!;
  const savedBanner = () => screen.queryByText(/Saved successfully|تم الحفظ بنجاح/);

  /** A response the test releases when it chooses. */
  function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => {
      resolve = done;
    });
    return { promise, resolve };
  }
  const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

  async function open(profile: typeof STORED = STORED) {
    mock.onGet('/v1/auth/me').reply(200, MOCK_ME_ADA);
    renderEdit();
    await waitFor(() => expect(screen.getByDisplayValue(profile.displayName)).toBeInTheDocument());
  }

  it('C — a field cleared on purpose stays cleared, and is saved as null', async () => {
    let served = STORED;
    mock.onGet('/v1/me/profile').reply(() => [200, { profile: served }]);
    let body: Record<string, unknown> = {};
    mock.onPatch('/v1/me/profile').reply((config) => {
      body = JSON.parse(config.data as string) as Record<string, unknown>;
      return [200, { profile: { ...served, phoneNumber: null, bio: null, updatedAt: T3 } }];
    });
    await open();

    fireEvent.change(phoneField(), { target: { value: '' } });
    fireEvent.change(screen.getByDisplayValue('Analyst.'), { target: { value: '' } });

    // A refetch lands carrying the stored, non-empty values.
    served = { ...served, updatedAt: T2 };
    await qc.invalidateQueries();
    await settle();

    // Empty is an answer, not a gap to fill from the server.
    expect(phoneField().value).toBe('');
    expect(screen.queryByDisplayValue('Analyst.')).toBeNull();

    fireEvent.click(saveButton());
    await waitFor(() => expect(body.firstName).toBe('Ada'));
    expect(body).toMatchObject({ phoneNumber: null, bio: null, city: 'London' });
  });

  it('D — a save acknowledged while the cached GET is still old does not put the old value back', async () => {
    let gets = 0;
    const refetch = deferred<[number, unknown]>();
    mock.onGet('/v1/me/profile').reply(() => {
      gets += 1;
      // The first load answers; the refetch after the save is held back.
      return gets === 1 ? [200, { profile: STORED }] : refetch.promise;
    });
    const acknowledged = { ...STORED, displayName: 'Grace Hopper', updatedAt: T2 };
    mock.onPatch('/v1/me/profile').reply(200, { profile: acknowledged });
    await open();

    fireEvent.change(nameField(), { target: { value: 'Grace Hopper' } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(savedBanner()).toBeInTheDocument());

    // The refetch has not returned. The form shows the acknowledged value.
    await settle();
    expect(gets).toBeGreaterThan(1);
    expect(nameField().value).toBe('Grace Hopper');

    refetch.resolve([200, { profile: acknowledged }]);
    await settle();
    expect(nameField().value).toBe('Grace Hopper');
  });

  it('E — an answer older than the acknowledged save cannot restore stale values', async () => {
    mock.onGet('/v1/me/profile').reply(200, { profile: STORED });
    const acknowledged = { ...STORED, displayName: 'Grace Hopper', updatedAt: T3 };
    mock.onPatch('/v1/me/profile').reply(200, { profile: acknowledged });
    await open();

    fireEvent.change(nameField(), { target: { value: 'Grace Hopper' } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(savedBanner()).toBeInTheDocument());

    // A read that began before the save arrives after it, with the name the
    // row held then and a stamp older than the acknowledged one.
    qc.setQueryData(['seeker', 'profile', 'get'], { profile: { ...STORED, updatedAt: T2 } });
    await settle();
    expect(nameField().value).toBe('Grace Hopper');
  });

  it('F — something typed while a save is in flight survives that save completing', async () => {
    let served = STORED;
    mock.onGet('/v1/me/profile').reply(() => [200, { profile: served }]);
    const patches: Array<Record<string, unknown>> = [];
    const firstSave = deferred<[number, unknown]>();
    mock.onPatch('/v1/me/profile').reply((config) => {
      patches.push(JSON.parse(config.data as string) as Record<string, unknown>);
      if (patches.length === 1) return firstSave.promise;
      return [200, { profile: { ...served, displayName: 'Grace B. Hopper', updatedAt: T3 } }];
    });
    await open();

    fireEvent.change(nameField(), { target: { value: 'Grace Hopper' } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(patches).toHaveLength(1));

    // The inputs are not disabled during a save, so the person keeps typing.
    fireEvent.change(nameField(), { target: { value: 'Grace B. Hopper' } });
    fireEvent.change(phoneField(), { target: { value: '+1 555 0100' } });

    served = { ...STORED, displayName: 'Grace Hopper', updatedAt: T2 };
    firstSave.resolve([200, { profile: served }]);
    await waitFor(() => expect(savedBanner()).toBeInTheDocument());
    await settle();

    // The first save acknowledged "Grace Hopper". What is on screen is newer.
    expect(nameField().value).toBe('Grace B. Hopper');
    expect(phoneField().value).toBe('+1 555 0100');

    // ...and it is what the next save sends. The button shows its success
    // label for a moment before it offers Save again.
    await waitFor(() => expect(saveButton()).toBeInTheDocument(), { timeout: 4_000 });
    fireEvent.click(saveButton());
    await waitFor(() => expect(patches).toHaveLength(2));
    expect(patches[0]).toMatchObject({ firstName: 'Grace', lastName: 'Hopper' });
    expect(patches[1]).toMatchObject({
      firstName: 'Grace',
      lastName: 'B. Hopper',
      phoneNumber: '+1 555 0100',
    });
  });

  it('G — a failed save keeps the edit, shows no success, and a later refetch still cannot overwrite it', async () => {
    let served = STORED;
    mock.onGet('/v1/me/profile').reply(() => [200, { profile: served }]);
    mock.onPatch('/v1/me/profile').reply(500, { error: { code: 'INTERNAL_ERROR' } });
    await open();

    fireEvent.change(nameField(), { target: { value: 'Grace Hopper' } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(savedBanner()).toBeNull();
    expect(nameField().value).toBe('Grace Hopper');

    served = { ...served, updatedAt: T2 };
    await qc.invalidateQueries();
    await settle();
    expect(nameField().value).toBe('Grace Hopper');
  });

  it('H — one account’s unsaved edits are not carried into another account’s form', async () => {
    mock.onGet('/v1/me/profile').reply(200, { profile: STORED });
    await open();
    fireEvent.change(nameField(), { target: { value: 'Unsaved Edit' } });
    fireEvent.change(phoneField(), { target: { value: '+1 555 9999' } });

    // The same mounted form is handed a different person's profile.
    qc.setQueryData(['seeker', 'profile', 'get'], {
      profile: {
        ...MOCK_PROFILE,
        email: 'grace@example.com',
        displayName: 'Grace Hopper',
        phoneNumber: null,
        // Older than anything the first account saw: identity, not time,
        // decides that this is a fresh form.
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    });

    await waitFor(() => expect(nameField().value).toBe('Grace Hopper'));
    expect(phoneField().value).toBe('');
    expect(screen.queryByDisplayValue('Unsaved Edit')).toBeNull();
  });
});

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
      // Approved (i.e. actually held): plumbing only.
      serviceCategories: [
        { id: 'cat-plumbing', slug: 'plumbing', labelEn: 'Plumbing', labelAr: 'سباكة', icon: '🔧' },
      ],
      // Sprint 2 — awaiting an admin decision. Always present on the wire,
      // empty array included.
      pendingCategories: [],
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

  // ── Sprint 2 — adding a skill is an application, removing is an edit ──────
  //
  // This replaces the previous "toggles a skill pill and posts categoryIds"
  // test, which asserted the defect: it pinned the UI sending a brand-new
  // category in the profile PATCH, which the backend used to accept and now
  // answers 403 to. The pill still toggles; where the toggle GOES is what
  // changed.
  it('ticking a new skill posts an APPLICATION, not a profile category', async () => {
    mockProviderRoute();
    let providerBody: Record<string, unknown> | null = null;
    let seekerBody: Record<string, unknown> | null = null;
    let applicationBody: Record<string, unknown> | null = null;
    mock.onPatch('/v1/me/profile').reply((cfg) => {
      seekerBody = JSON.parse(cfg.data as string) as Record<string, unknown>;
      return [200, { profile: { ...MOCK_PROFILE, city: 'Riyadh' } }];
    });
    mock.onPatch('/v1/me/provider/profile').reply((cfg) => {
      providerBody = JSON.parse(cfg.data as string) as Record<string, unknown>;
      return [200, PROVIDER_PROFILE_ROW];
    });
    mock.onPost('/v1/me/provider/categories/applications').reply((cfg) => {
      applicationBody = JSON.parse(cfg.data as string) as Record<string, unknown>;
      return [
        201,
        {
          application: {
            id: 'app-1',
            status: 'PENDING',
            category: SERVICES[1],
            createdAt: '2026-08-22T00:00:00.000Z',
            updatedAt: '2026-08-22T00:00:00.000Z',
            supersededAt: null,
          },
        },
      ];
    });

    renderEdit('provider');
    await waitFor(() => expect(screen.getByTestId('skill-pill-electrical')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('skill-pill-electrical'));
    expect(screen.getByTestId('skill-pill-electrical').getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: /save changes|حفظ التغييرات/i }));

    await waitFor(() => expect(applicationBody).not.toBeNull());

    // The new category went out as an application...
    expect(applicationBody).toEqual({ categoryId: 'cat-electrical' });

    // ...and NOT in the profile PATCH, which carries only what the provider
    // already holds. Sending it there would be a 403 from the API.
    expect(providerBody).toMatchObject({
      serviceAreaCity: 'Riyadh',
      categoryIds: ['cat-plumbing'],
    });
    expect((providerBody as { categoryIds: string[] }).categoryIds).not.toContain('cat-electrical');
    expect(seekerBody).toMatchObject({ city: 'Riyadh' });
  });

  it('un-ticking a held skill removes it through the profile PATCH', async () => {
    mockProviderRoute();
    let providerBody: Record<string, unknown> | null = null;
    let applicationHits = 0;
    mock.onPatch('/v1/me/profile').reply(200, { profile: MOCK_PROFILE });
    mock.onPatch('/v1/me/provider/profile').reply((cfg) => {
      providerBody = JSON.parse(cfg.data as string) as Record<string, unknown>;
      return [200, PROVIDER_PROFILE_ROW];
    });
    mock.onPost('/v1/me/provider/categories/applications').reply(() => {
      applicationHits += 1;
      return [201, {}];
    });

    renderEdit('provider');
    await waitFor(() => expect(screen.getByTestId('skill-pill-plumbing')).toBeInTheDocument());

    // Plumbing is held; un-tick it.
    fireEvent.click(screen.getByTestId('skill-pill-plumbing'));
    fireEvent.click(screen.getByRole('button', { name: /save changes|حفظ التغييرات/i }));

    await waitFor(() => expect(providerBody).not.toBeNull());
    expect(providerBody).toMatchObject({ categoryIds: [] });
    // Removal is not an application — nothing should have been queued.
    expect(applicationHits).toBe(0);
  });

  it('a pending skill renders as pending and cannot be toggled', async () => {
    // The provider has applied for electrical; an admin has not decided.
    mock.onGet('/v1/me/provider/profile').reply(200, {
      profile: {
        ...PROVIDER_PROFILE_ROW.profile,
        pendingCategories: [SERVICES[1]],
      },
    });
    mock.onGet('/v1/services').reply(200, { items: SERVICES });
    mock.onGet('/v1/me/profile').reply(200, { profile: MOCK_PROFILE });
    let applicationHits = 0;
    mock.onPost('/v1/me/provider/categories/applications').reply(() => {
      applicationHits += 1;
      return [201, {}];
    });
    mock.onPatch('/v1/me/profile').reply(200, { profile: MOCK_PROFILE });
    mock.onPatch('/v1/me/provider/profile').reply(200, PROVIDER_PROFILE_ROW);

    renderEdit('provider');
    await waitFor(() => expect(screen.getByTestId('skill-pill-electrical')).toBeInTheDocument());

    const pill = screen.getByTestId('skill-pill-electrical');
    expect(pill.getAttribute('data-pending')).toBe('true');
    expect((pill as HTMLButtonElement).disabled).toBe(true);
    // Pending reads as "in flight", not as a skill the provider has.
    expect(pill.textContent).toMatch(/pending review|قيد المراجعة/i);

    // Clicking it does nothing, and saving does not re-apply for something
    // already sitting in the queue.
    fireEvent.click(pill);
    fireEvent.click(screen.getByRole('button', { name: /save changes|حفظ التغييرات/i }));
    await waitFor(() => expect(screen.queryByText(/saving/i)).not.toBeInTheDocument());
    expect(applicationHits).toBe(0);
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

  // ── I: the provider half of the form follows the same ownership rule ─────

  it('a late provider refetch does not swap the city or the pin under a typed city', async () => {
    mock.onGet('/v1/auth/me').reply(200, PROVIDER_ME);
    mock.onGet('/v1/me/profile').reply(200, {
      profile: { ...MOCK_PROFILE, displayName: 'Omar Al-Khalid', city: 'Riyadh' },
    });
    let providerRow = PROVIDER_PROFILE_ROW.profile;
    mock.onGet('/v1/me/provider/profile').reply(() => [200, { profile: providerRow }]);
    mock.onGet('/v1/services').reply(200, { items: SERVICES });
    mock.onPatch('/v1/me/profile').reply(200, { profile: MOCK_PROFILE });
    let providerBody: Record<string, unknown> | null = null;
    mock.onPatch('/v1/me/provider/profile').reply((cfg) => {
      providerBody = JSON.parse(cfg.data as string) as Record<string, unknown>;
      return [200, PROVIDER_PROFILE_ROW];
    });

    renderEdit('provider');
    await waitFor(() => expect(screen.getByDisplayValue('Riyadh')).toBeInTheDocument());
    fireEvent.change(screen.getByDisplayValue('Riyadh'), { target: { value: 'Jeddah' } });

    // The provider profile answers again: the stored city, and a stored pin.
    providerRow = {
      ...providerRow,
      serviceAreaLat: 24.7 as unknown as null,
      serviceAreaLng: 46.7 as unknown as null,
      updatedAt: '2026-05-01T00:00:00.000Z',
    };
    await qc.invalidateQueries();
    await waitFor(() =>
      expect(
        mock.history.get.filter((r) => r.url === '/v1/me/provider/profile').length,
      ).toBeGreaterThan(1),
    );
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(screen.getByDisplayValue('Jeddah')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /save changes|حفظ التغييرات/i }));
    await waitFor(() => expect(providerBody).not.toBeNull());
    expect(providerBody).toMatchObject({ serviceAreaCity: 'Jeddah' });
    // The Riyadh pin did not ride along with the typed Jeddah.
    expect(providerBody).not.toHaveProperty('serviceAreaLat');
    expect(providerBody).not.toHaveProperty('serviceAreaLng');
  });

  it('does not report the form saved when the provider half fails, and keeps the edits', async () => {
    mockProviderRoute();
    mock.onPatch('/v1/me/profile').reply(200, {
      profile: {
        ...MOCK_PROFILE,
        displayName: 'Omar Al-Khalid',
        city: 'Jeddah',
        updatedAt: '2026-05-02T00:00:00.000Z',
      },
    });
    mock.onPatch('/v1/me/provider/profile').reply(500, { error: { code: 'INTERNAL_ERROR' } });

    renderEdit('provider');
    await waitFor(() => expect(screen.getByDisplayValue('Riyadh')).toBeInTheDocument());
    fireEvent.change(screen.getByDisplayValue('Riyadh'), { target: { value: 'Jeddah' } });
    fireEvent.click(screen.getByRole('button', { name: /save changes|حفظ التغييرات/i }));

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    // One request succeeded and one failed: that is not "saved".
    expect(screen.queryByText(/Saved successfully|تم الحفظ بنجاح/)).toBeNull();
    // The provider city is the one that failed; the edit is still on screen.
    expect(screen.getByDisplayValue('Jeddah')).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// R05 recovery — edits made BEFORE the first profile answer arrives.
//
// The form is editable while GET /v1/me/profile is still in flight. The first
// answer must seed only the fields the person has not touched, exactly like a
// later refetch does. It must not be mistaken for a switch to another account
// (test H above pins that a real switch still clears unsaved edits).
// ─────────────────────────────────────────────────────────────────────────────
describe('EditProfilePage — edits made before the first profile answer', () => {
  const STORED = {
    ...MOCK_PROFILE,
    phoneNumber: '+1 555 0000',
    city: 'London',
    bio: 'Analyst.',
  };
  const nameField = () => screen.getByLabelText(/full name|الاسم الكامل/i) as HTMLInputElement;
  const phoneField = () =>
    (screen.getAllByRole('textbox') as HTMLInputElement[]).find((i) => i.type === 'tel')!;
  const saveButton = () => screen.getByRole('button', { name: /save changes|حفظ التغييرات/i });

  function held<T>() {
    let release!: (value: T) => void;
    const promise = new Promise<T>((done) => {
      release = done;
    });
    return { promise, release };
  }

  /** The session is known (as it always is once the app shows this page); the profile is not. */
  const signedIn = () =>
    waitFor(() =>
      expect(qc.getQueryData(['auth', 'me'])).toMatchObject({ email: 'ada@example.com' }),
    );

  it('I — a name typed before the first answer is kept, and saved', async () => {
    mock.onGet('/v1/auth/me').reply(200, MOCK_ME_ADA);
    const first = held<[number, unknown]>();
    mock.onGet('/v1/me/profile').replyOnce(() => first.promise);
    mock.onPatch('/v1/me/profile').reply((config) => [
      200,
      {
        profile: {
          ...STORED,
          ...JSON.parse(config.data as string),
          updatedAt: '2026-05-09T00:00:00.000Z',
        },
      },
    ]);
    renderEdit();
    await signedIn();

    // Typed while the profile is still loading.
    fireEvent.change(nameField(), { target: { value: 'Typed Early' } });
    expect(nameField().value).toBe('Typed Early');

    // The first answer arrives.
    first.release([200, { profile: STORED }]);
    // Untouched fields follow the server…
    await waitFor(() => expect(phoneField().value).toBe('+1 555 0000'));
    // …the typed one does not.
    expect(nameField().value).toBe('Typed Early');

    fireEvent.click(saveButton());
    await waitFor(() => expect(mock.history.patch).toHaveLength(1));
    expect(JSON.parse(mock.history.patch[0].data as string)).toMatchObject({
      firstName: 'Typed',
      lastName: 'Early',
      phoneNumber: '+1 555 0000',
    });
  });

  it('J — a field cleared before the first answer stays cleared', async () => {
    mock.onGet('/v1/auth/me').reply(200, MOCK_ME_ADA);
    const first = held<[number, unknown]>();
    mock.onGet('/v1/me/profile').replyOnce(() => first.promise);
    renderEdit();
    await signedIn();
    fireEvent.change(phoneField(), { target: { value: 'x' } });
    fireEvent.change(phoneField(), { target: { value: '' } });
    first.release([200, { profile: STORED }]);
    await waitFor(() => expect(nameField().value).toBe('Ada Lovelace'));
    expect(phoneField().value).toBe('');
  });
});

describe('EditProfilePage — first answer versus a different account', () => {
  const STORED = { ...MOCK_PROFILE, phoneNumber: '+1 555 0000', city: 'London', bio: 'Analyst.' };
  const GRACE_ME = { ...MOCK_ME_ADA, id: 'u2', email: 'grace@example.com', firstName: 'Grace' };
  const GRACE = {
    ...MOCK_PROFILE,
    email: 'grace@example.com',
    displayName: 'Grace Hopper',
    phoneNumber: '+1 555 7777',
  };
  const nameField = () => screen.getByLabelText(/full name|الاسم الكامل/i) as HTMLInputElement;
  const phoneField = () =>
    (screen.getAllByRole('textbox') as HTMLInputElement[]).find((i) => i.type === 'tel')!;
  function held<T>() {
    let release!: (value: T) => void;
    const promise = new Promise<T>((done) => {
      release = done;
    });
    return { promise, release };
  }

  it('K — an edit made before the session is known is not kept', async () => {
    const me = held<[number, unknown]>();
    mock.onGet('/v1/auth/me').replyOnce(() => me.promise);
    mock.onGet('/v1/me/profile').reply(200, { profile: STORED });
    renderEdit();
    // Nobody is known to be signed in yet.
    fireEvent.change(nameField(), { target: { value: 'Whose Edit' } });
    me.release([200, MOCK_ME_ADA]);
    await waitFor(() => expect(nameField().value).toBe('Ada Lovelace'));
    expect(screen.queryByDisplayValue('Whose Edit')).toBeNull();
  });

  it('L — edits made under one account are not kept when the first answer is another account’s', async () => {
    mock.onGet('/v1/auth/me').reply(200, MOCK_ME_ADA);
    const first = held<[number, unknown]>();
    mock.onGet('/v1/me/profile').replyOnce(() => first.promise);
    renderEdit();
    await waitFor(() =>
      expect(qc.getQueryData(['auth', 'me'])).toMatchObject({ email: 'ada@example.com' }),
    );
    fireEvent.change(nameField(), { target: { value: 'Ada Typed' } });
    fireEvent.change(phoneField(), { target: { value: '+1 555 1234' } });
    // The session becomes Grace's, and Grace's profile is the first answer.
    qc.setQueryData(['auth', 'me'], GRACE_ME);
    first.release([200, { profile: GRACE }]);
    await waitFor(() => expect(nameField().value).toBe('Grace Hopper'));
    expect(phoneField().value).toBe('+1 555 7777');
    expect(screen.queryByDisplayValue('Ada Typed')).toBeNull();
  });

  it('M — a former session’s late answer does not keep that session’s edits', async () => {
    mock.onGet('/v1/auth/me').reply(200, MOCK_ME_ADA);
    const first = held<[number, unknown]>();
    mock.onGet('/v1/me/profile').replyOnce(() => first.promise);
    renderEdit();
    await waitFor(() =>
      expect(qc.getQueryData(['auth', 'me'])).toMatchObject({ email: 'ada@example.com' }),
    );
    fireEvent.change(nameField(), { target: { value: 'Ada Typed' } });
    // Ada signs out and Grace signs in before Ada's profile answer lands.
    qc.setQueryData(['auth', 'me'], GRACE_ME);
    first.release([200, { profile: STORED }]);
    await waitFor(() => expect(nameField().value).toBe('Ada Lovelace'));
    expect(screen.queryByDisplayValue('Ada Typed')).toBeNull();
  });
});
