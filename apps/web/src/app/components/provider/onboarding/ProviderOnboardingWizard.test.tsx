import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import MockAdapter from 'axios-mock-adapter';
import type { QueryClient } from '@tanstack/react-query';
import type { ProviderOnboardingDraftView } from '@homeservicemarketplace/contracts';

import { api } from '../../../../lib/api';
import { AuthProvider, createAuthQueryClient } from '../../../../lib/auth-provider';
import { LanguageProvider } from '../../../i18n/LanguageContext';
import { ProviderOnboardingWizard } from './ProviderOnboardingWizard';

// ─────────────────────────────────────────────────────────────────────────────
// Sprint 8 — the provider onboarding wizard.
//
// What these tests are actually protecting:
//
//   1. THE SERVER DECIDES. Progress, completeness, and the Submit button's
//      enabled state are RENDERED from the response, never recomputed. A
//      client with its own copy of the rules is how a Submit button ends up
//      enabled and then 422-ing.
//
//   2. SUBMISSION IS NOT APPROVAL. The screen a provider sees after submitting
//      must not say, imply, or look like approval — the server moved them to
//      DOCUMENTS_REQUIRED and granted nothing.
//
//   3. NOTHING IS LOST. Autosave states, offline hold, retry, refresh resume,
//      and unsaved-change protection all exist so a provider never watches
//      their own answers disappear.
//
//   4. IT WORKS IN ARABIC. EN and AR, LTR and RTL, dark and light.
// ─────────────────────────────────────────────────────────────────────────────

const MOCK_ME = {
  id: 'u-1',
  email: 'grace@example.com',
  firstName: 'Grace',
  lastName: 'Hopper',
  status: 'ACTIVE' as const,
  emailVerifiedAt: '2026-04-29T00:00:00.000Z',
  mfaEnabled: false,
  roles: ['customer' as const, 'provider' as const],
};

/** A draft with everything answered, so a test can break exactly one thing. */
function completeView(
  over: Partial<ProviderOnboardingDraftView> = {},
): ProviderOnboardingDraftView {
  const steps = [
    'PROVIDER_TYPE',
    'IDENTITY',
    'LOCATION',
    'SPECIALTIES',
    'EXPERIENCE',
    'AVAILABILITY',
    'PROFILE',
    'CONSENT',
    'REVIEW',
  ] as const;

  return {
    state: 'DRAFT',
    currentStep: 'REVIEW',
    steps: steps.map((step) => ({ step, complete: true, issues: [] })),
    completedSteps: [...steps],
    percentComplete: 100,
    nextAction: { kind: 'SUBMIT' },
    complete: true,
    missing: [],
    version: 3,
    policyVersion: 'v3',
    lastSavedAt: '2026-08-24T10:00:00.000Z',
    editable: true,
    data: {
      providerType: 'INDIVIDUAL',
      legalBusinessName: null,
      displayName: 'Grace Hopper',
      profileImageUrl: null,
      phoneNumber: '+46701234567',
      phoneVerified: true,
      serviceAreaCity: 'Gothenburg',
      serviceAreaCountry: 'Sweden',
      serviceAreaLat: null,
      serviceAreaLng: null,
      serviceAreaRadiusKm: 25,
      serviceAreaIds: [],
      workshopAddressLine: null,
      workshopLat: null,
      workshopLng: null,
      primaryGroupIds: [],
      specialtyLeafIds: ['cat-leaf-1'],
      pendingSpecialtyIds: [],
      yearsOfExperience: 10,
      professionSince: null,
      equipmentCodes: [],
      transportMode: 'VAN',
      availability: [
        {
          id: 'iv-1',
          dayOfWeek: 1,
          startMinute: 540,
          endMinute: 1020,
          timezone: 'Europe/Stockholm',
        },
      ],
      timezone: 'Europe/Stockholm',
      headline: 'Certified electrician, 10 years',
      bio: 'I handle residential and light commercial electrical work, including fault finding.',
      additionalInformation: null,
      acceptedConsentVersion: 'v3',
      consentAcceptedAt: '2026-08-23T00:00:00.000Z',
    },
    ...over,
  };
}

/** An empty draft, resuming at the first step. */
function emptyView(over: Partial<ProviderOnboardingDraftView> = {}): ProviderOnboardingDraftView {
  const base = completeView();
  return {
    ...base,
    currentStep: 'PROVIDER_TYPE',
    percentComplete: 0,
    complete: false,
    completedSteps: [],
    nextAction: { kind: 'COMPLETE_STEP', step: 'PROVIDER_TYPE' },
    missing: [{ field: 'providerType', code: 'REQUIRED' }],
    steps: base.steps.map((s) => ({
      ...s,
      complete: false,
      issues:
        s.step === 'PROVIDER_TYPE'
          ? [{ field: 'providerType' as const, code: 'REQUIRED' as const }]
          : [],
    })),
    data: { ...base.data, providerType: null },
    ...over,
  };
}

let mock: MockAdapter;
let qc: QueryClient;

function renderWizard() {
  return render(
    <MemoryRouter>
      <AuthProvider client={qc}>
        <LanguageProvider>
          <ProviderOnboardingWizard />
        </LanguageProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
}

function mockCatalog() {
  mock.onGet('/v1/auth/me').reply(200, MOCK_ME);
  mock.onGet('/v1/services').reply(200, {
    items: [
      {
        id: 'cat-root-1',
        slug: 'plumbing',
        labelEn: 'Plumbing',
        labelAr: 'سباكة',
        icon: 'droplet',
        sortOrder: 0,
        parentId: null,
        isLeaf: false,
      },
      {
        id: 'cat-leaf-1',
        slug: 'boiler-repair',
        labelEn: 'Boiler repair',
        labelAr: 'إصلاح السخان',
        icon: 'flame',
        sortOrder: 1,
        parentId: 'cat-root-1',
        isLeaf: true,
      },
    ],
  });
  mock.onGet('/v1/services/equipment').reply(200, {
    items: [
      {
        id: 'eq-1',
        code: 'LADDER',
        labelEn: 'Ladder',
        labelAr: 'سلم',
        categoryId: null,
        sortOrder: 0,
      },
    ],
  });
}

beforeEach(() => {
  mock = new MockAdapter(api);
  qc = createAuthQueryClient();
  vi.useRealTimers();
});

afterEach(() => {
  mock.restore();
  window.localStorage.removeItem('hsm.lang');
  vi.restoreAllMocks();
});

// ── loading, error, unauthorized ────────────────────────────────────────────

describe('the wizard shell — loading, error, unauthorized', () => {
  it('shows a loading state before the draft arrives', async () => {
    mockCatalog();
    // Slow, not hung. A never-resolving reply would leave a pending handle
    // that keeps the worker alive after the suite finishes.
    mock
      .onGet('/v1/me/provider/onboarding/draft')
      .reply(
        () => new Promise((resolve) => setTimeout(() => resolve([200, completeView()]), 3000)),
      );
    renderWizard();

    expect(await screen.findByText(/loading your application/i)).toBeInTheDocument();
  });

  it('shows a retryable error when the draft cannot be loaded', async () => {
    mockCatalog();
    mock.onGet('/v1/me/provider/onboarding/draft').reply(500, {});
    renderWizard();

    expect(await screen.findByText(/could not load your application/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retry/i })).toBeEnabled();
  });

  it('names the actual problem when the account is not a provider', async () => {
    // A 403 is not "something went wrong" — it is a specific, explicable
    // state, and "please try again" sends someone retrying a thing that
    // cannot work.
    //
    // A 401 is deliberately NOT tested here, because it never reaches this
    // component: the api client fires auth:session-expired and the auth layer
    // routes to login. Asserting a signed-out state on this screen would be
    // pinning behaviour the app does not have.
    mockCatalog();
    mock.onGet('/v1/me/provider/onboarding/draft').reply(403, {});
    renderWizard();

    expect(await screen.findByText(/not set up as a provider/i)).toBeInTheDocument();
  });
});

// ── the server decides ──────────────────────────────────────────────────────

describe('progress comes from the server, not the client', () => {
  it('renders the percentage the server reported', async () => {
    mockCatalog();
    // A deliberately odd number the client could not have computed from the
    // step list, so passing means it came from the response.
    mock
      .onGet('/v1/me/provider/onboarding/draft')
      .reply(200, completeView({ percentComplete: 67, complete: false }));
    renderWizard();

    const bar = await screen.findByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '67');
    expect(screen.getByText(/67% complete/i)).toBeInTheDocument();
  });

  it('resumes at the step the server named', async () => {
    mockCatalog();
    mock
      .onGet('/v1/me/provider/onboarding/draft')
      .reply(200, emptyView({ currentStep: 'AVAILABILITY' }));
    renderWizard();

    expect(await screen.findByRole('heading', { name: /your hours/i })).toBeInTheDocument();
  });

  it('disables Submit when the server says the application is incomplete', async () => {
    mockCatalog();
    mock.onGet('/v1/me/provider/onboarding/draft').reply(
      200,
      completeView({
        currentStep: 'REVIEW',
        complete: false,
        missing: [{ field: 'bio', code: 'REQUIRED' }],
      }),
    );
    renderWizard();

    const submit = await screen.findByRole('button', { name: /send application/i });
    expect(submit).toBeDisabled();
  });

  it('spells out WHY Submit is disabled rather than leaving a grey button', async () => {
    mockCatalog();
    mock.onGet('/v1/me/provider/onboarding/draft').reply(
      200,
      completeView({
        currentStep: 'REVIEW',
        complete: false,
        missing: [{ field: 'bio', code: 'REQUIRED' }],
      }),
    );
    renderWizard();

    expect(await screen.findByText(/add a short description of your work/i)).toBeInTheDocument();
  });

  it('enables Submit when the server says the application is complete', async () => {
    mockCatalog();
    mock.onGet('/v1/me/provider/onboarding/draft').reply(200, completeView());
    renderWizard();

    expect(await screen.findByRole('button', { name: /send application/i })).toBeEnabled();
  });
});

// ── submission is not approval ──────────────────────────────────────────────

describe('after submitting', () => {
  it('submits with the version the client last read', async () => {
    mockCatalog();
    mock.onGet('/v1/me/provider/onboarding/draft').reply(200, completeView({ version: 7 }));
    mock
      .onPost('/v1/me/provider/onboarding/submit')
      .reply(200, completeView({ state: 'DOCUMENTS_REQUIRED', editable: false }));
    renderWizard();

    fireEvent.click(await screen.findByRole('button', { name: /send application/i }));

    await waitFor(() => {
      const posted = mock.history.post.find((r) => r.url?.includes('/onboarding/submit'));
      expect(posted).toBeDefined();
      expect(JSON.parse(posted?.data ?? '{}')).toMatchObject({ version: 7 });
    });
  });

  it('does NOT tell the provider they are approved', async () => {
    // The server moved them to DOCUMENTS_REQUIRED and granted nothing. A
    // screen that said "approved" would be the client making a claim the
    // server explicitly refused to make.
    mockCatalog();
    mock.onGet('/v1/me/provider/onboarding/draft').reply(200, completeView());
    mock
      .onPost('/v1/me/provider/onboarding/submit')
      .reply(200, completeView({ state: 'DOCUMENTS_REQUIRED', editable: false }));
    renderWizard();

    fireEvent.click(await screen.findByRole('button', { name: /send application/i }));

    await screen.findByText(/application received/i);
    expect(screen.queryByText(/approved/i)).toBeNull();
    expect(screen.queryByText(/verified/i)).toBeNull();
  });

  it('says out loud that this is not approval yet', async () => {
    mockCatalog();
    mock
      .onGet('/v1/me/provider/onboarding/draft')
      .reply(200, completeView({ state: 'DOCUMENTS_REQUIRED', editable: false }));
    renderWizard();

    expect(await screen.findByText(/this is not approval yet/i)).toBeInTheDocument();
    expect(screen.getByText(/check your identity documents/i)).toBeInTheDocument();
  });

  it('makes a submitted application read-only rather than showing a dead form', async () => {
    // Leaving the editable form behind a disabled Submit invites a provider to
    // change something and wonder why it did not save.
    mockCatalog();
    mock
      .onGet('/v1/me/provider/onboarding/draft')
      .reply(200, completeView({ state: 'DOCUMENTS_REQUIRED', editable: false }));
    renderWizard();

    await screen.findByText(/application received/i);
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('offers a way back out of the queue', async () => {
    // Blocking edits on a submitted application is only reasonable if there is
    // a visible way out; otherwise a provider who spots a typo waits for a
    // rejection.
    mockCatalog();
    mock
      .onGet('/v1/me/provider/onboarding/draft')
      .reply(200, completeView({ state: 'DOCUMENTS_REQUIRED', editable: false }));
    mock.onPost('/v1/me/provider/onboarding/withdraw').reply(200, completeView());
    renderWizard();

    fireEvent.click(await screen.findByRole('button', { name: /withdraw application/i }));

    await waitFor(() =>
      expect(mock.history.post.some((r) => r.url?.includes('/onboarding/withdraw'))).toBe(true),
    );
  });

  it('shows a waiting state, not a documents state, while merely SUBMITTED', async () => {
    mockCatalog();
    mock
      .onGet('/v1/me/provider/onboarding/draft')
      .reply(200, completeView({ state: 'SUBMITTED', editable: false }));
    renderWizard();

    expect(await screen.findByText(/with our team/i)).toBeInTheDocument();
    expect(screen.queryByText(/this is not approval yet/i)).toBeNull();
  });
});

// ── autosave ────────────────────────────────────────────────────────────────

describe('autosave', () => {
  it('patches the step the provider is on, with the current version', async () => {
    mockCatalog();
    mock.onGet('/v1/me/provider/onboarding/draft').reply(200, emptyView({ version: 4 }));
    mock.onPatch(/\/onboarding\/steps\//).reply(200, emptyView({ version: 5 }));
    renderWizard();

    await screen.findByRole('heading', { name: /account type/i });
    fireEvent.click(screen.getByRole('radio', { name: /individual/i }));

    await waitFor(
      () => {
        const patched = mock.history.patch.at(-1);
        expect(patched?.url).toContain('/onboarding/steps/PROVIDER_TYPE');
        expect(JSON.parse(patched?.data ?? '{}')).toMatchObject({
          providerType: 'INDIVIDUAL',
          version: 4,
        });
      },
      { timeout: 3000 },
    );
  });

  it('shows Saved after a successful write', async () => {
    mockCatalog();
    mock.onGet('/v1/me/provider/onboarding/draft').reply(200, emptyView());
    mock.onPatch(/\/onboarding\/steps\//).reply(200, emptyView({ version: 5 }));
    renderWizard();

    await screen.findByRole('heading', { name: /account type/i });
    fireEvent.click(screen.getByRole('radio', { name: /individual/i }));

    expect(await screen.findByText(/^saved$/i, {}, { timeout: 3000 })).toBeInTheDocument();
  });

  it('offers a retry when a save fails', async () => {
    mockCatalog();
    mock.onGet('/v1/me/provider/onboarding/draft').reply(200, emptyView());
    mock.onPatch(/\/onboarding\/steps\//).reply(500, {});
    renderWizard();

    await screen.findByRole('heading', { name: /account type/i });
    fireEvent.click(screen.getByRole('radio', { name: /individual/i }));

    expect(await screen.findByText(/could not save/i, {}, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retry/i })).toBeEnabled();
  });

  it('retries successfully after a transient failure', async () => {
    mockCatalog();
    mock.onGet('/v1/me/provider/onboarding/draft').reply(200, emptyView());
    let attempts = 0;
    mock.onPatch(/\/onboarding\/steps\//).reply(() => {
      attempts += 1;
      return attempts === 1 ? [500, {}] : [200, emptyView({ version: 5 })];
    });
    renderWizard();

    await screen.findByRole('heading', { name: /account type/i });
    fireEvent.click(screen.getByRole('radio', { name: /individual/i }));
    await screen.findByRole('button', { name: /retry/i }, { timeout: 3000 });

    fireEvent.click(screen.getByRole('button', { name: /retry/i }));

    expect(await screen.findByText(/^saved$/i, {}, { timeout: 3000 })).toBeInTheDocument();
  });

  it('HOLDS an edit while offline rather than failing it', async () => {
    // The edit is still in memory; a provider in a basement does not lose a
    // screen because the connection dropped for ten seconds.
    mockCatalog();
    mock.onGet('/v1/me/provider/onboarding/draft').reply(200, emptyView());
    mock.onPatch(/\/onboarding\/steps\//).reply(200, emptyView({ version: 5 }));
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    renderWizard();

    await screen.findByRole('heading', { name: /account type/i });
    fireEvent.click(screen.getByRole('radio', { name: /individual/i }));

    expect(await screen.findByText(/offline/i, {}, { timeout: 3000 })).toBeInTheDocument();
    expect(mock.history.patch).toHaveLength(0);
  });

  it('writes the held edit when the connection returns', async () => {
    mockCatalog();
    mock.onGet('/v1/me/provider/onboarding/draft').reply(200, emptyView());
    mock.onPatch(/\/onboarding\/steps\//).reply(200, emptyView({ version: 5 }));
    const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    renderWizard();

    await screen.findByRole('heading', { name: /account type/i });
    fireEvent.click(screen.getByRole('radio', { name: /individual/i }));
    await screen.findByText(/offline/i, {}, { timeout: 3000 });

    onLine.mockReturnValue(true);
    fireEvent(window, new Event('online'));

    await waitFor(() => expect(mock.history.patch.length).toBeGreaterThan(0), { timeout: 3000 });
  });

  it('shows a conflict, and offers reload, when another tab won', async () => {
    // Overwriting would silently discard the other tab's work, so the UI does
    // not retry — it tells the provider and offers to reload.
    mockCatalog();
    mock.onGet('/v1/me/provider/onboarding/draft').reply(200, emptyView({ version: 4 }));
    mock
      .onPatch(/\/onboarding\/steps\//)
      .reply(409, { details: { expectedVersion: 9, receivedVersion: 4 } });
    renderWizard();

    await screen.findByRole('heading', { name: /account type/i });
    fireEvent.click(screen.getByRole('radio', { name: /individual/i }));

    expect(
      await screen.findByText(/changed in another tab/i, {}, { timeout: 3000 }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reload/i })).toBeEnabled();
  });
});

// ── resume ──────────────────────────────────────────────────────────────────

describe('resume', () => {
  it('opens at the first gap, not the furthest step reached', async () => {
    // A provider who skipped step 2 and filled step 5 is blocked by step 2, so
    // that is where a refresh has to take them.
    mockCatalog();
    mock
      .onGet('/v1/me/provider/onboarding/draft')
      .reply(200, emptyView({ currentStep: 'LOCATION' }));
    renderWizard();

    expect(await screen.findByRole('heading', { name: /where you work/i })).toBeInTheDocument();
  });

  it('renders the values already saved on the server', async () => {
    mockCatalog();
    mock
      .onGet('/v1/me/provider/onboarding/draft')
      .reply(200, completeView({ currentStep: 'PROFILE' }));
    renderWizard();

    const headline = (await screen.findByLabelText(/headline/i)) as HTMLInputElement;
    expect(headline.value).toBe('Certified electrician, 10 years');
  });

  it('does not jump the provider when the server moves the resume point mid-edit', async () => {
    // The server recomputes currentStep on every autosave. Following it live
    // would move the screen out from under someone who just finished a field.
    mockCatalog();
    mock
      .onGet('/v1/me/provider/onboarding/draft')
      .reply(200, emptyView({ currentStep: 'PROFILE' }));
    mock
      .onPatch(/\/onboarding\/steps\//)
      .reply(200, emptyView({ currentStep: 'CONSENT', version: 5 }));
    renderWizard();

    const headline = await screen.findByLabelText(/headline/i);
    fireEvent.change(headline, { target: { value: 'Electrician' } });

    await waitFor(() => expect(mock.history.patch.length).toBeGreaterThan(0), { timeout: 3000 });
    // Still on PROFILE, even though the server now says CONSENT.
    expect(screen.getByRole('heading', { name: /your profile/i })).toBeInTheDocument();
  });
});

// ── the category-approval boundary, on screen ───────────────────────────────

describe('specialties', () => {
  it('says out loud that choosing a group grants nothing', async () => {
    mockCatalog();
    mock
      .onGet('/v1/me/provider/onboarding/draft')
      .reply(200, emptyView({ currentStep: 'SPECIALTIES' }));
    renderWizard();

    expect(
      await screen.findByText(/choosing a group does not grant anything/i),
    ).toBeInTheDocument();
  });

  it('sends only the group when a group is ticked, never the leaves under it', async () => {
    // The client-side half of the bypass the server also refuses. Expanding a
    // group into leaf selections here would file applications the provider
    // never chose to make.
    mockCatalog();
    mock
      .onGet('/v1/me/provider/onboarding/draft')
      .reply(200, emptyView({ currentStep: 'SPECIALTIES' }));
    mock.onPatch(/\/onboarding\/steps\//).reply(200, emptyView({ version: 5 }));
    renderWizard();

    fireEvent.click(await screen.findByRole('button', { name: /^plumbing$/i }));

    await waitFor(
      () => {
        const body = JSON.parse(mock.history.patch.at(-1)?.data ?? '{}');
        expect(body.primaryGroupIds).toEqual(['cat-root-1']);
        expect(body.specialtyLeafIds).toBeUndefined();
      },
      { timeout: 3000 },
    );
  });

  it('marks an approved specialty differently from one awaiting review', async () => {
    // "Selected" and "you may work in this" are different facts, and a
    // provider who cannot tell them apart will take a job they are not
    // approved for.
    mockCatalog();
    mock.onGet('/v1/me/provider/onboarding/draft').reply(
      200,
      completeView({
        currentStep: 'SPECIALTIES',
        data: {
          ...completeView().data,
          primaryGroupIds: ['cat-root-1'],
          specialtyLeafIds: [],
          pendingSpecialtyIds: ['cat-leaf-1'],
        },
      }),
    );
    renderWizard();

    const chip = await screen.findByRole('button', { name: /boiler repair/i });
    expect(within(chip).getByText(/awaiting review/i)).toBeInTheDocument();
  });
});

// ── availability ────────────────────────────────────────────────────────────

describe('availability', () => {
  it('flags overlapping windows in place', async () => {
    mockCatalog();
    mock.onGet('/v1/me/provider/onboarding/draft').reply(
      200,
      completeView({
        currentStep: 'AVAILABILITY',
        data: {
          ...completeView().data,
          availability: [
            { id: 'a', dayOfWeek: 1, startMinute: 540, endMinute: 720, timezone: 'UTC' },
            { id: 'b', dayOfWeek: 1, startMinute: 600, endMinute: 780, timezone: 'UTC' },
          ],
        },
      }),
    );
    mock.onPatch(/\/onboarding\/steps\//).reply(200, completeView());
    renderWizard();

    // Rendered on load, before any edit: the provider sees the problem where
    // they made it rather than after a round-trip.
    const alerts = await screen.findAllByText(/overlap/i);
    expect(alerts.length).toBeGreaterThan(0);
  });

  it('does not send a known-bad set to the server', async () => {
    // The server would reject it, the save indicator would go red, and the
    // provider would see an error for a problem the inline highlight is
    // already showing them.
    mockCatalog();
    mock.onGet('/v1/me/provider/onboarding/draft').reply(
      200,
      completeView({
        currentStep: 'AVAILABILITY',
        data: { ...completeView().data, availability: [] },
      }),
    );
    mock.onPatch(/\/onboarding\/steps\//).reply(200, completeView());
    renderWizard();

    // Two default windows on the same day overlap exactly.
    const add = await screen.findByRole('button', { name: /add hours/i });
    fireEvent.click(add);
    fireEvent.click(add);

    await waitFor(() => expect(screen.getAllByText(/overlap/i).length).toBeGreaterThan(0));
    const availabilityPatches = mock.history.patch.filter(
      (r) => JSON.parse(r.data ?? '{}').availability?.length === 2,
    );
    expect(availabilityPatches).toHaveLength(0);
  });
});

// ── accessibility ───────────────────────────────────────────────────────────

describe('accessibility', () => {
  it('gives every field a real label', async () => {
    mockCatalog();
    mock
      .onGet('/v1/me/provider/onboarding/draft')
      .reply(200, completeView({ currentStep: 'IDENTITY' }));
    renderWizard();

    expect(await screen.findByLabelText(/name seekers see/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/phone number/i)).toBeInTheDocument();
  });

  it('marks an invalid field as invalid and links it to its error', async () => {
    mockCatalog();
    mock.onGet('/v1/me/provider/onboarding/draft').reply(
      200,
      emptyView({
        currentStep: 'PROFILE',
        steps: emptyView().steps.map((s) =>
          s.step === 'PROFILE' ? { ...s, issues: [{ field: 'bio', code: 'REQUIRED' }] } : s,
        ),
      }),
    );
    renderWizard();

    const bio = await screen.findByLabelText(/about your work/i);
    expect(bio).toHaveAttribute('aria-invalid', 'true');
    expect(bio.getAttribute('aria-describedby')).toContain('bio-error');
  });

  it('moves focus to the step heading when the step changes', async () => {
    // Without it a keyboard user who presses Next lands back at the top of the
    // document and tabs through the whole rail again to reach the form.
    mockCatalog();
    mock
      .onGet('/v1/me/provider/onboarding/draft')
      .reply(200, completeView({ currentStep: 'IDENTITY' }));
    mock.onPatch(/\/onboarding\/steps\//).reply(200, completeView());
    renderWizard();

    await screen.findByRole('heading', { name: /about you/i });
    fireEvent.click(screen.getByRole('button', { name: /^next$/i }));

    await waitFor(() => {
      const heading = screen.getByRole('heading', { name: /where you work/i });
      expect(document.activeElement).toBe(heading);
    });
  });

  it('announces the progress bar with its value', async () => {
    mockCatalog();
    mock
      .onGet('/v1/me/provider/onboarding/draft')
      .reply(200, completeView({ percentComplete: 44 }));
    renderWizard();

    const bar = await screen.findByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuemin', '0');
    expect(bar).toHaveAttribute('aria-valuemax', '100');
    expect(bar).toHaveAttribute('aria-valuenow', '44');
  });

  it('marks the current step for assistive technology', async () => {
    mockCatalog();
    mock
      .onGet('/v1/me/provider/onboarding/draft')
      .reply(200, completeView({ currentStep: 'LOCATION' }));
    renderWizard();

    const current = await screen.findByRole('button', { current: 'step' });
    expect(current).toHaveTextContent(/where you work/i);
  });
});

// ── the review screen ───────────────────────────────────────────────────────

describe('the review screen', () => {
  it('links every section back to the step that owns it', async () => {
    // A read-only summary with no way to fix what it shows is a dead end.
    mockCatalog();
    mock.onGet('/v1/me/provider/onboarding/draft').reply(200, completeView());
    mock.onPatch(/\/onboarding\/steps\//).reply(200, completeView());
    renderWizard();

    await screen.findByText(/here is everything you have told us/i);
    const rows = screen.getAllByRole('button', { name: /edit/i });
    expect(rows.length).toBe(8);

    fireEvent.click(rows[0]);
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /account type/i })).toBeInTheDocument(),
    );
  });

  it('shows the first outstanding issue against its section', async () => {
    mockCatalog();
    mock.onGet('/v1/me/provider/onboarding/draft').reply(
      200,
      completeView({
        complete: false,
        missing: [{ field: 'bio', code: 'REQUIRED' }],
        steps: completeView().steps.map((s) =>
          s.step === 'PROFILE'
            ? { ...s, complete: false, issues: [{ field: 'bio', code: 'REQUIRED' }] }
            : s,
        ),
      }),
    );
    renderWizard();

    expect(await screen.findAllByText(/add a short description of your work/i)).not.toHaveLength(0);
  });
});

// ── Arabic, RTL, dark ───────────────────────────────────────────────────────

describe('Arabic and RTL', () => {
  it('renders the wizard in Arabic', async () => {
    window.localStorage.setItem('hsm.lang', 'ar');
    mockCatalog();
    mock.onGet('/v1/me/provider/onboarding/draft').reply(200, emptyView());
    renderWizard();

    expect(await screen.findByText(/إعداد حساب مزوّد الخدمة/)).toBeInTheDocument();
    // Awaited separately: the shell heading paints while the draft is still
    // loading, so asserting the STEP heading synchronously after it would
    // read the loading state.
    expect(await screen.findByRole('heading', { name: /نوع الحساب/ })).toBeInTheDocument();
  });

  it('sets RTL direction on the document for Arabic', async () => {
    window.localStorage.setItem('hsm.lang', 'ar');
    mockCatalog();
    mock.onGet('/v1/me/provider/onboarding/draft').reply(200, emptyView());
    renderWizard();

    await screen.findByText(/إعداد حساب مزوّد الخدمة/);
    expect(document.documentElement.getAttribute('dir')).toBe('rtl');
  });

  it('renders LTR for English', async () => {
    mockCatalog();
    mock.onGet('/v1/me/provider/onboarding/draft').reply(200, emptyView());
    renderWizard();

    await screen.findByText(/set up your provider account/i);
    expect(document.documentElement.getAttribute('dir')).toBe('ltr');
  });

  it('translates the outstanding requirements, not just the chrome', async () => {
    // The chrome being Arabic while the actual blockers stay English is the
    // usual half-done translation, and the blockers are the part that matters.
    window.localStorage.setItem('hsm.lang', 'ar');
    mockCatalog();
    mock.onGet('/v1/me/provider/onboarding/draft').reply(
      200,
      completeView({
        currentStep: 'REVIEW',
        complete: false,
        missing: [{ field: 'bio', code: 'REQUIRED' }],
      }),
    );
    renderWizard();

    expect(await screen.findByText(/أضف وصفاً مختصراً لعملك/)).toBeInTheDocument();
  });

  it('translates the submitted state, including the not-approved warning', async () => {
    window.localStorage.setItem('hsm.lang', 'ar');
    mockCatalog();
    mock
      .onGet('/v1/me/provider/onboarding/draft')
      .reply(200, completeView({ state: 'DOCUMENTS_REQUIRED', editable: false }));
    renderWizard();

    expect(await screen.findByText(/تم استلام الطلب/)).toBeInTheDocument();
    expect(screen.getByText(/هذه ليست موافقة نهائية بعد/)).toBeInTheDocument();
  });
});

describe('dark mode', () => {
  it('carries dark variants on every surface it paints', async () => {
    // Not a visual assertion — a structural one. A card with no dark: class is
    // a white rectangle in a dark app, and that is how it ships unnoticed.
    mockCatalog();
    mock.onGet('/v1/me/provider/onboarding/draft').reply(200, emptyView());
    const { container } = renderWizard();

    await screen.findByRole('heading', { name: /account type/i });
    const cards = container.querySelectorAll('.rounded-3xl');
    expect(cards.length).toBeGreaterThan(0);
    cards.forEach((card) => {
      expect(card.className).toMatch(/dark:bg-slate-800/);
    });
  });
});
