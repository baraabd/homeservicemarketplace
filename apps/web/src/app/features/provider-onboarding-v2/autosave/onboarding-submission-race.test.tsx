import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, Outlet, RouterProvider, useLocation } from 'react-router';
import MockAdapter from 'axios-mock-adapter';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { api } from '../../../../lib/api';
import { providerQueryKeys } from '../../../../lib/provider/query-keys';
import { LanguageProvider } from '../../../i18n/LanguageContext';
import { OnboardingTaskScreen } from '../components/OnboardingTaskScreen';
import { ProviderOnboardingAutosaveProvider } from './ProviderOnboardingAutosaveProvider';

// Sprint 09B.29 Phase 4 — SUBMISSION MUST NOT OVERTAKE AN OUTSTANDING EDIT.
//
// `ReviewTaskScreen` calls neither `flushAll()` nor anything that awaits the
// coordinator. It refetches the review read-model and submits the
// `draftVersion` that comes back. On its own that would be a race: an edit
// resting in the 900ms debounce would still be unwritten when the application
// was handed in, and would then land on a SUBMITTED draft that the server's
// edit lock refuses.
//
// It is NOT a race today, and this file exists to say WHY and to keep it that
// way. The protection is structural rather than local: every task, review
// included, is rendered by `OnboardingTaskScreen`, which mounts
// `useOnboardingExit`, which arms a router blocker for as long as there is
// unwritten work. Reaching the review screen is a router navigation, so the
// blocker flushes the draft before the review screen ever mounts.
//
// That means the invariant depends on something a future refactor could remove
// without touching the review screen at all — moving review off the shared
// task route, or rendering it outside the coordinator, would silently
// reintroduce the race. These tests fail if that happens.

const HUB_URL = '/v1/me/provider/onboarding/hub';
const PATCH = /\/v1\/me\/provider\/onboarding\/steps\/([A-Z_]+)$/;
const SUBMIT_URL = '/v1/me/provider/onboarding/submit';

const hubTask = (id: string, group: string) => ({
  id,
  group,
  status: 'AVAILABLE',
  title: id,
  description: id,
});

const HUB = {
  tasks: [hubTask('BASICS_IDENTITY', 'BASICS'), hubTask('REVIEW_SUBMISSION', 'REVIEW')],
  progress: { complete: 1, total: 2 },
  nextAction: { kind: 'COMPLETE_TASK', taskId: 'BASICS_IDENTITY' },
  status: 'DRAFT',
};

const DRAFT = (version: number, displayName = 'Pat Provider') => ({
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
    displayName,
    profileImageUrl: null,
    phoneNumber: null,
  },
});

/** `draftVersion` is what the submit echoes back, so it is the whole point of
 *  the assertion below. */
const REVIEW = (draftVersion: number) => ({
  groups: [],
  canSubmit: true,
  blockedReason: null,
  terms: { version: 'terms-1', accepted: true, acceptedVersion: 'terms-1', body: 'x' },
  draftVersion,
  lifecycleState: 'DRAFT',
  canWithdraw: false,
});

let mock: MockAdapter;
/** Server-side truth, so the review read-model and the submit agree with the
 *  writes that actually landed rather than with a fixture. */
let serverVersion: number;

beforeEach(() => {
  serverVersion = 3;
  mock = new MockAdapter(api);
  mock.onGet(HUB_URL).reply(200, HUB);
  mock.onGet(/\/onboarding\/draft$/).reply(() => [200, DRAFT(serverVersion)]);
  mock.onGet(/\/onboarding\/review/).reply(() => [200, REVIEW(serverVersion)]);
  mock.onPatch(PATCH).reply(() => {
    serverVersion += 1;
    return [200, DRAFT(serverVersion, 'Patricia')];
  });
  mock.onPost(SUBMIT_URL).reply(() => [200, DRAFT(serverVersion)]);
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

// Sprint 09B.29 Phase 5A — the review task is THREE approved screens, and
// the submit lives on the second of them (`#terms`). The invariant under test
// is unchanged and so is the protection: reaching either half is a router
// navigation through `useOnboardingExit`, which flushes first.
function renderAt(taskId: string, hash = '') {
  window.localStorage.setItem('hsm.lang', 'en');
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(providerQueryKeys.onboarding.draft(), DRAFT(3));
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
    { initialEntries: [`/provider/onboarding/${taskId}${hash}`] },
  );
  render(
    <QueryClientProvider client={client}>
      <LanguageProvider>
        <RouterProvider router={router} />
      </LanguageProvider>
    </QueryClientProvider>,
  );
  return router;
}

describe('Phase 4 — submission cannot overtake an outstanding autosave', () => {
  it('the route is HELD on the task until the edit is written — not merely written eventually', async () => {
    // The PATCH is held open by this test, which is what makes the assertion
    // an ORDERING proof rather than a timing coincidence.
    //
    // Without it, `waitFor` outlives the 900ms debounce, so the write appears
    // on the wire whether or not anything flushed it and the test passes on a
    // build with no flush at all. Measured: disarming the router blocker left
    // an earlier version of this file fully green. Holding the request means
    // the only way the route can still be on the task is that something is
    // waiting for the write.
    let release!: () => void;
    const held = new Promise<void>((r) => {
      release = r;
    });
    mock.onPatch(PATCH).reply(async () => {
      await held;
      serverVersion += 1;
      return [200, DRAFT(serverVersion, 'Patricia')];
    });

    const router = renderAt('BASICS_IDENTITY');
    await waitFor(() => expect(screen.getByTestId('field-displayName')).toBeInTheDocument());

    // Type and leave immediately — inside the debounce, with no waiting. This
    // is the shape of every real "I'm done, submit it" moment.
    fireEvent.change(screen.getByTestId('field-displayName'), {
      target: { value: 'Patricia' },
    });
    expect(mock.history.patch).toHaveLength(0);

    router.navigate('/provider/onboarding/REVIEW_SUBMISSION#terms');

    // The write is issued...
    await waitFor(() => expect(mock.history.patch).toHaveLength(1));
    const body = JSON.parse(String(mock.history.patch[0].data)) as {
      displayName: string;
      version: number;
    };
    expect(body.displayName).toBe('Patricia');
    expect(body.version).toBe(3);

    // ...and while it is still open, the provider has NOT arrived at review.
    // This is the assertion the debounce cannot satisfy on its own.
    expect(router.state.location.pathname).toBe('/provider/onboarding/BASICS_IDENTITY');

    release();
    await waitFor(() =>
      expect(router.state.location.pathname).toBe('/provider/onboarding/REVIEW_SUBMISSION'),
    );
  });

  it('the submitted draftVersion is the one the edit produced, not the one it replaced', async () => {
    const router = renderAt('BASICS_IDENTITY');
    await waitFor(() => expect(screen.getByTestId('field-displayName')).toBeInTheDocument());

    fireEvent.change(screen.getByTestId('field-displayName'), {
      target: { value: 'Patricia' },
    });
    router.navigate('/provider/onboarding/REVIEW_SUBMISSION#terms');

    await waitFor(() => expect(mock.history.patch).toHaveLength(1));
    await waitFor(() => expect(screen.getByTestId('review-submit')).toBeEnabled());

    fireEvent.click(screen.getByTestId('review-submit'));

    await waitFor(() =>
      expect(mock.history.post.filter((r) => r.url === SUBMIT_URL)).toHaveLength(1),
    );
    const submitted = JSON.parse(
      String(mock.history.post.filter((r) => r.url === SUBMIT_URL)[0].data),
    ) as { version: number };

    // 4, not 3. Submitting the pre-edit token would hand the server a version
    // it has already moved past, and the provider would see a 409 for an edit
    // they watched succeed.
    expect(submitted.version).toBe(4);
  });

  it('submitting twice files one application, not two', async () => {
    renderAt('REVIEW_SUBMISSION', '#terms');
    await waitFor(() => expect(screen.getByTestId('review-submit')).toBeEnabled());

    const button = screen.getByTestId('review-submit');
    fireEvent.click(button);
    fireEvent.click(button);

    await waitFor(() =>
      expect(mock.history.post.filter((r) => r.url === SUBMIT_URL).length).toBeGreaterThan(0),
    );
    // The button disables itself on `submitPending`, and the refetch it awaits
    // keeps it disabled across the gap. A second application is not something
    // the server should have to de-duplicate for us.
    expect(mock.history.post.filter((r) => r.url === SUBMIT_URL)).toHaveLength(1);
  });
});
