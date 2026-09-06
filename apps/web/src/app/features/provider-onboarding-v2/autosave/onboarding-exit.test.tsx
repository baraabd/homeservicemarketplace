import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, Outlet, RouterProvider, useLocation } from 'react-router';
import MockAdapter from 'axios-mock-adapter';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { api } from '../../../../lib/api';
import { providerQueryKeys } from '../../../../lib/provider/query-keys';
import { LanguageProvider } from '../../../i18n/LanguageContext';
import { OnboardingTaskScreen } from '../components/OnboardingTaskScreen';
import { ProviderOnboardingAutosaveProvider } from './ProviderOnboardingAutosaveProvider';
import { EXIT_COPY } from '../copy/exit-copy';

// Sprint 9B.28 — every exit control flushes.
//
// docs/sprint-09b28/PROVIDER_ONBOARDING_PERSISTENCE_MOBILE_FIRST.md
//
// This is the file that would have caught the original bug, and the reason the
// previous suites did not is worth stating: they asserted the CHIP. A test
// that waits for "Saved" and then clicks Close passes on the broken build,
// because the chip was left over from an earlier write and the click navigated
// before the debounce fired. So nothing here reads a label. Each case makes an
// edit, leaves IMMEDIATELY — inside the debounce window, with no waiting — and
// asserts against `mock.history.patch`: what actually reached the wire, and
// that it reached it BEFORE the route changed.

const HUB_URL = '/v1/me/provider/onboarding/hub';
const PATCH = /\/v1\/me\/provider\/onboarding\/steps\/([A-Z_]+)$/;

const hubTask = (id: string, group: string) => ({
  id,
  group,
  status: 'AVAILABLE',
  title: id,
  description: id,
});

const HUB = {
  tasks: [
    hubTask('BASICS_IDENTITY', 'BASICS'),
    hubTask('SERVICES_EXPERIENCE', 'SERVICES'),
    hubTask('WORK_AREA', 'COVERAGE'),
    hubTask('WORKING_HOURS', 'COVERAGE'),
    hubTask('PORTFOLIO', 'PROFILE'),
  ],
  progress: { complete: 0, total: 6 },
  nextAction: { kind: 'COMPLETE_TASK', taskId: 'BASICS_IDENTITY' },
  status: 'DRAFT',
};

const DRAFT = (version = 3) => ({
  state: 'DRAFT',
  currentStep: 'IDENTITY',
  steps: [],
  completedSteps: [],
  percentComplete: 0,
  nextAction: { kind: 'COMPLETE_STEP', step: 'IDENTITY' },
  complete: false,
  missing: [],
  version,
  policyVersion: 'p',
  lastSavedAt: null,
  editable: true,
  data: {
    providerType: 'INDIVIDUAL',
    legalBusinessName: null,
    displayName: 'Pat Provider',
    profileImageUrl: null,
    phoneNumber: null,
    headline: null,
    bio: null,
    serviceAreaCity: null,
    serviceAreaCountry: null,
    serviceAreaRadiusKm: null,
    serviceAreaLat: null,
    serviceAreaLng: null,
    availability: [],
    timezone: null,
    yearsOfExperience: null,
    specialties: [],
    serviceCategoryIds: [],
    serviceAreaCountryCode: null,
    radiusPolicy: { suggestedKm: 25, minKm: 1, maxKm: 100, basedOn: 'CAR' },
    serviceAreaExpansion: {
      show: false,
      allowedMaxKm: 100,
      baseMaxKm: 100,
      currentTier: null,
      nextTier: null,
      progress: [],
      reasonCodes: ['FEATURE_DISABLED'],
      policyVersion: null,
    },
    resolvedTimezone: { resolved: null, display: null, needsConfirmation: false },
  },
});

/** The public projection the portfolio screen previews. Served by the SERVER,
 *  so it has to be mocked as its own resource rather than derived here. */
const PREVIEW = {
  profile: {
    displayName: 'Pat Provider',
    initials: 'PP',
    avatarUrl: null,
    about: { headline: null, bio: null },
    area: { city: 'Damascus', country: 'Syria' },
    standing: { ratingAvg: null, reviewCount: 0, completedJobs: 0, verified: false },
    portfolio: [],
    services: [],
  },
  awaitingReviewCount: 0,
  publicProfileRouteAvailable: false,
  moderationReviewAvailable: false,
};

let mock: MockAdapter;

beforeEach(() => {
  mock = new MockAdapter(api);
  mock.onGet(HUB_URL).reply(200, HUB);
  mock.onGet(/\/onboarding\/draft$/).reply(200, DRAFT());
  mock.onGet(/\/onboarding\/review/).reply(200, { sections: [], blockers: [], canSubmit: false });
  mock.onGet(/\/service-categories|\/equipment/).reply(200, []);
  // The side resources the portfolio screen needs. Given their REAL shapes:
  // a blanket `{}` satisfies the request and then crashes the component that
  // destructures the response, which looks like a component bug.
  mock.onGet(/\/public-profile\/preview/).reply(200, PREVIEW);
  mock.onGet(/\/portfolio/).reply(200, { items: [], remainingSlots: 10, maxItems: 10 });
  mock.onPatch(PATCH).reply(200, DRAFT(4));
});

afterEach(() => {
  mock.restore();
  window.localStorage.clear();
  vi.useRealTimers();
});

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

function renderTask(taskId: string, lang: 'en' | 'ar' = 'en') {
  window.localStorage.setItem('hsm.lang', lang);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(providerQueryKeys.onboarding.draft(), DRAFT());
  const router = createMemoryRouter(
    [
      {
        path: '/provider/onboarding',
        element: (
          <ProviderOnboardingAutosaveProvider>
            <Outlet />
          </ProviderOnboardingAutosaveProvider>
        ),
        children: [
          { index: true, element: <LocationProbe /> },
          { path: ':taskId', element: <OnboardingTaskScreen /> },
        ],
      },
      { path: '*', element: <LocationProbe /> },
    ],
    { initialEntries: [`/provider/onboarding/${taskId}`] },
  );
  render(
    <QueryClientProvider client={client}>
      <LanguageProvider>
        <RouterProvider router={router} />
      </LanguageProvider>
    </QueryClientProvider>,
  );
  return { client };
}

const patchesFor = (step: string) =>
  mock.history.patch.filter((r) => (r.url ?? '').endsWith(`/steps/${step}`));

const onHub = () => screen.queryByTestId('location')?.textContent === '/provider/onboarding';

/** Each task, the control that edits it, and the step that edit belongs to.
 *
 *  The controls are the REAL ones — `field-displayName`, `radius-slider`,
 *  `title-input` — committed the way the screen commits them (blur for text,
 *  change for the slider). A synthetic control here would prove the
 *  coordinator works and leave the screens' own exit wiring untested, which is
 *  the gap that let this ship. */
const TASKS = [
  {
    id: 'BASICS_IDENTITY',
    step: 'IDENTITY',
    edit: async () => {
      const field = await screen.findByTestId('field-displayName');
      fireEvent.change(field, { target: { value: 'Edited Immediately' } });
      fireEvent.blur(field);
    },
  },
  {
    id: 'WORK_AREA',
    step: 'LOCATION',
    edit: async () => {
      const radius = await screen.findByTestId('radius-slider');
      fireEvent.change(radius, { target: { value: '12' } });
      // The slider commits on release, not on every intermediate value — a
      // save per pixel dragged would be a save per pixel dragged.
      fireEvent.blur(radius);
    },
  },
  {
    id: 'PORTFOLIO',
    step: 'PROFILE',
    edit: async () => {
      const title = await screen.findByTestId('title-input');
      fireEvent.change(title, { target: { value: 'Master electrician' } });
      fireEvent.blur(title);
    },
  },
] as const;

describe('leaving a task never loses the edit that was still resting', () => {
  for (const t of TASKS) {
    it(`${t.id}: header Close flushes ${t.step} BEFORE navigating`, async () => {
      renderTask(t.id);
      await screen.findByTestId(`task-screen-${t.id}`);
      await t.edit();

      // No waiting. This is the whole point — the debounce is 900ms and the
      // provider is leaving now.
      expect(patchesFor(t.step)).toHaveLength(0);
      fireEvent.click(screen.getByTestId('onboarding-v2-close'));

      await waitFor(() => expect(patchesFor(t.step).length).toBeGreaterThan(0));
      await waitFor(() => expect(onHub()).toBe(true));
    });

    it(`${t.id}: "Back to tasks" flushes ${t.step} BEFORE navigating`, async () => {
      renderTask(t.id);
      await screen.findByTestId(`task-screen-${t.id}`);
      await t.edit();

      const back = screen.getByRole('button', { name: /back to tasks/i });
      fireEvent.click(back);

      await waitFor(() => expect(patchesFor(t.step).length).toBeGreaterThan(0));
      await waitFor(() => expect(onHub()).toBe(true));
    });
  }
});

describe('a failed flush keeps the provider on the task', () => {
  it('stays put, explains why, and does NOT claim the data is saved', async () => {
    mock.onPatch(PATCH).reply(500, { code: 'INTERNAL_ERROR' });
    renderTask('BASICS_IDENTITY');
    await screen.findByTestId('task-screen-BASICS_IDENTITY');

    const input = await screen.findByTestId('field-displayName');
    fireEvent.change(input, { target: { value: 'Will not save' } });
    fireEvent.blur(input);
    fireEvent.click(screen.getByTestId('onboarding-v2-close'));

    const notice = await screen.findByTestId('onboarding-exit-blocked');
    expect(notice).toHaveAttribute('data-reason', 'error');
    // Still on the task.
    expect(onHub()).toBe(false);
    expect(screen.getByTestId('task-screen-BASICS_IDENTITY')).toBeInTheDocument();
    // And the notice interrupts rather than waiting to be noticed.
    expect(notice).toHaveAttribute('role', 'alert');
  });

  it('offers Retry, and the retry completes the exit once the server recovers', async () => {
    // Re-register from scratch: axios-mock-adapter keeps the handler that
    // beforeEach installed for this same matcher, and a `replyOnce` added
    // afterwards never gets reached.
    mock.resetHandlers();
    mock.onGet(HUB_URL).reply(200, HUB);
    mock.onGet(/\/onboarding\/draft$/).reply(200, DRAFT());
    let attempt = 0;
    mock.onPatch(PATCH).reply(() => {
      attempt += 1;
      return attempt === 1 ? [500, { code: 'INTERNAL_ERROR' }] : [200, DRAFT(4)];
    });

    renderTask('BASICS_IDENTITY');
    await screen.findByTestId('task-screen-BASICS_IDENTITY');
    const input = await screen.findByTestId('field-displayName');
    fireEvent.change(input, { target: { value: 'Retried' } });
    fireEvent.blur(input);
    fireEvent.click(screen.getByTestId('onboarding-v2-close'));

    await screen.findByTestId('onboarding-exit-blocked');
    fireEvent.click(screen.getByTestId('onboarding-exit-retry'));

    await waitFor(() => expect(onHub()).toBe(true));
    // The value that finally landed is the one the provider typed.
    const last = patchesFor('IDENTITY').at(-1);
    expect(last?.data).toContain('Retried');
  });

  it('a 409 offers Reload, not Retry — retrying would overwrite the other writer', async () => {
    mock.onPatch(PATCH).reply(409, { code: 'CONFLICT', details: { expectedVersion: 9 } });
    renderTask('BASICS_IDENTITY');
    await screen.findByTestId('task-screen-BASICS_IDENTITY');
    const input = await screen.findByTestId('field-displayName');
    fireEvent.change(input, { target: { value: 'Conflicting' } });
    fireEvent.blur(input);
    fireEvent.click(screen.getByTestId('onboarding-v2-close'));

    const notice = await screen.findByTestId('onboarding-exit-blocked');
    expect(notice).toHaveAttribute('data-reason', 'conflict');
    expect(screen.getByTestId('onboarding-exit-reload')).toBeInTheDocument();
    expect(screen.queryByTestId('onboarding-exit-retry')).toBeNull();
    expect(onHub()).toBe(false);
  });

  it('"Keep editing" dismisses the notice and stays on the task', async () => {
    mock.onPatch(PATCH).reply(500);
    renderTask('BASICS_IDENTITY');
    await screen.findByTestId('task-screen-BASICS_IDENTITY');
    const input = await screen.findByTestId('field-displayName');
    fireEvent.change(input, { target: { value: 'x' } });
    fireEvent.blur(input);
    fireEvent.click(screen.getByTestId('onboarding-v2-close'));

    await screen.findByTestId('onboarding-exit-blocked');
    fireEvent.click(screen.getByTestId('onboarding-exit-stay'));
    await waitFor(() => expect(screen.queryByTestId('onboarding-exit-blocked')).toBeNull());
    expect(onHub()).toBe(false);
  });

  it('renders the blocked-exit reason in Arabic', async () => {
    mock.onPatch(PATCH).reply(500);
    renderTask('BASICS_IDENTITY', 'ar');
    await screen.findByTestId('task-screen-BASICS_IDENTITY');
    const input = await screen.findByTestId('field-displayName');
    fireEvent.change(input, { target: { value: 'x' } });
    fireEvent.blur(input);
    fireEvent.click(screen.getByTestId('onboarding-v2-close'));

    await screen.findByTestId('onboarding-exit-blocked');
    expect(screen.getByText(EXIT_COPY.ar.blockedTitle)).toBeInTheDocument();
  });
});

describe('repeated taps', () => {
  it('a second Close while the first is draining does not start a second write', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    mock.onPatch(PATCH).reply(async () => {
      await gate;
      return [200, DRAFT(4)];
    });

    renderTask('BASICS_IDENTITY');
    await screen.findByTestId('task-screen-BASICS_IDENTITY');
    const input = await screen.findByTestId('field-displayName');
    fireEvent.change(input, { target: { value: 'Once' } });
    fireEvent.blur(input);

    const close = screen.getByTestId('onboarding-v2-close');
    fireEvent.click(close);
    fireEvent.click(close);
    fireEvent.click(close);

    await waitFor(() => expect(patchesFor('IDENTITY').length).toBeGreaterThan(0));
    await act(async () => {
      release();
      await new Promise((r) => setTimeout(r, 20));
    });

    expect(patchesFor('IDENTITY')).toHaveLength(1);
    await waitFor(() => expect(onHub()).toBe(true));
  });
});
