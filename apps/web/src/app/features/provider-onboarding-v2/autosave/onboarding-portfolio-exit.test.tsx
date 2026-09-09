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

// Sprint 09B.29 Phase 4 — THE PORTFOLIO UPLOAD IS UNSAVED WORK TOO.
//
// The avatar was taught to register with the exit contract first; the
// portfolio was left behind, and it is the WORSE of the two. An avatar upload
// interrupted mid-flight loses a photo the provider can pick again. A
// portfolio upload interrupted between the PUT and the attach leaves an object
// in the bucket that no row references and, before the reservation ledger,
// nothing could ever find (O-4).
//
// The same six interruptions apply, and for the same reasons:
//
//   component unmount     leaving the task unmounts PortfolioSection
//   route navigation      unmounts the task; the exit path never waited
//   hard reload           `beforeunload` was armed from queued text only
//   tab close             same as reload
//   logout                purges caches and unmounts
//   network interruption  already handled — the PUT rejects and the section
//                         renders its own retryable failure
//
// These tests fail with `trackWork` removed from the PortfolioSection mount.

const HUB_URL = '/v1/me/provider/onboarding/hub';

const preparePortfolioUpload = vi.fn();
const uploadPortfolioFile = vi.fn();

vi.mock('../../../../lib/provider/provider-portfolio-api', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../../../lib/provider/provider-portfolio-api')>();
  return {
    ...actual,
    preparePortfolioUpload: (...a: unknown[]) => preparePortfolioUpload(...a),
    uploadPortfolioFile: (...a: unknown[]) => uploadPortfolioFile(...a),
  };
});

const HUB = {
  tasks: [
    {
      id: 'PORTFOLIO',
      group: 'PROFILE',
      status: 'AVAILABLE',
      title: 'Public profile',
      description: 'Public profile',
    },
  ],
  progress: { complete: 0, total: 1 },
  nextAction: { kind: 'COMPLETE_TASK', taskId: 'PORTFOLIO' },
  status: 'DRAFT',
};

const DRAFT = (version = 3) => ({
  state: 'DRAFT',
  currentStep: 'PROFILE',
  steps: [],
  completedSteps: [],
  percentComplete: 0,
  nextAction: { kind: 'COMPLETE_STEP', step: 'PROFILE' },
  complete: false,
  missing: [],
  draftId: 'draft-portfolio-exit',
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
    professionalTitle: 'Electrician',
    bio: 'A bio that is comfortably longer than the forty character minimum.',
  },
});

const EMPTY_PORTFOLIO = { items: [], remainingSlots: 8, maxItems: 8 };

// The real `ProviderPublicProfilePreviewResponse` shape. An approximation here
// would be worse than no mock: the screen reads `profile.displayName`, so a
// flat object renders an error boundary and every assertion below becomes a
// test of the boundary rather than of the exit contract.
const PREVIEW = {
  profile: {
    displayName: 'Pat Provider',
    initials: 'PP',
    avatarUrl: null,
    about: { headline: 'Electrician', bio: 'A bio.' },
    area: { city: null, country: null },
    standing: { ratingAvg: 0, reviewCount: 0, completedJobs: 0, verified: false },
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
  mock.onGet(/\/onboarding\/review/).reply(200, { groups: [], canSubmit: false });
  mock.onGet(/public-profile\/preview/).reply(200, PREVIEW);
  mock.onGet(/\/portfolio$/).reply(200, EMPTY_PORTFOLIO);
  mock.onPost(/\/portfolio$/).reply(201, EMPTY_PORTFOLIO);
  mock.onPatch(/\/onboarding\/steps\/[A-Z_]+$/).reply(200, DRAFT(4));
  mock.onGet(/\/service-categories|\/equipment/).reply(200, []);

  preparePortfolioUpload.mockResolvedValue({
    uploadUrl: 'http://api.test/v1/media/uploads/portfolio/ref/one.jpg?sig=x',
    fileUrl: 'http://api.test/v1/media/files/portfolio/ref/one.jpg',
    storageKey: 'portfolio/ref/one.jpg',
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  });
  globalThis.URL.createObjectURL = vi.fn(() => 'blob:preview');
  globalThis.URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  mock.restore();
  vi.clearAllMocks();
  window.localStorage.clear();
  vi.useRealTimers();
});

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

function renderTask() {
  window.localStorage.setItem('hsm.lang', 'en');
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
    { initialEntries: ['/provider/onboarding/PORTFOLIO'] },
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

/** Pick a file and confirm the publication acknowledgement, which is what
 *  arms the publish button. */
async function startPortfolioUpload() {
  const input = (await screen.findByLabelText('Choose a photo file')) as HTMLInputElement;
  const file = new File([new Uint8Array([1, 2, 3])], 'work.jpg', { type: 'image/jpeg' });
  fireEvent.change(input, { target: { files: [file] } });

  const consent = await screen.findByRole('checkbox');
  fireEvent.click(consent);

  // By accessible name, which is what the provider actually clicks. The
  // section has no test id here and adding one purely for this test would put
  // a hook in shipped markup that nothing else needs.
  fireEvent.click(await screen.findByRole('button', { name: 'Add photo' }));
}

describe('Phase 4 — a portfolio upload is unsaved work for the exit contract', () => {
  it('Close WAITS for an in-flight portfolio upload instead of navigating out from under it', async () => {
    let releaseUpload!: () => void;
    uploadPortfolioFile.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          releaseUpload = () => resolve();
        }),
    );

    const router = renderTask();
    await screen.findByTestId('task-screen-PORTFOLIO');
    await startPortfolioUpload();
    await waitFor(() => expect(uploadPortfolioFile).toHaveBeenCalledTimes(1));

    // WHERE THE ROUTER WAS when the attach ran, recorded rather than timed.
    // If the exit did not wait, navigation happens on the click and the attach
    // fires from the hub — with the component already unmounted.
    let routeAtAttach: string | null = null;
    mock.onPost(/\/portfolio$/).reply(() => {
      routeAtAttach = router.state.location.pathname;
      return [201, EMPTY_PORTFOLIO];
    });

    fireEvent.click(screen.getByTestId('onboarding-v2-close'));
    expect(routeAtAttach).toBeNull();

    releaseUpload();

    await waitFor(() => expect(routeAtAttach).toBe('/provider/onboarding/PORTFOLIO'));
    await waitFor(() => expect(router.state.location.pathname).toBe('/provider/onboarding'));
  });

  it('a hard reload during a portfolio upload is warned about', async () => {
    uploadPortfolioFile.mockImplementation(() => new Promise<void>(() => {}));

    renderTask();
    await screen.findByTestId('task-screen-PORTFOLIO');
    await startPortfolioUpload();
    await waitFor(() => expect(uploadPortfolioFile).toHaveBeenCalledTimes(1));

    // `beforeunload` is the ONLY thing that can intervene here: the browser is
    // tearing the page down and the in-flight PUT dies with it.
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it('a FAILED portfolio upload is not silently counted as finished', async () => {
    uploadPortfolioFile.mockRejectedValue(new Error('network died'));

    const router = renderTask();
    await screen.findByTestId('task-screen-PORTFOLIO');
    await startPortfolioUpload();
    await waitFor(() => expect(uploadPortfolioFile).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByTestId('onboarding-v2-close'));

    // The exit is BLOCKED rather than allowed. A rejected upload that resolved
    // its tracked promise would look identical to a successful one, and the
    // provider would be released into a navigation having lost the image with
    // nothing said.
    await screen.findByTestId('onboarding-exit-blocked');
    expect(router.state.location.pathname).toBe('/provider/onboarding/PORTFOLIO');
  });

  it('the provider can DISCARD a failed portfolio upload and leave', async () => {
    uploadPortfolioFile.mockRejectedValue(new Error('network died'));

    const router = renderTask();
    await screen.findByTestId('task-screen-PORTFOLIO');
    await startPortfolioUpload();
    await waitFor(() => expect(uploadPortfolioFile).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByTestId('onboarding-v2-close'));
    await screen.findByTestId('onboarding-exit-blocked');

    // Re-queried from the live document rather than from a node captured
    // before the re-render: a stale subtree yields a detached button whose
    // click reaches nothing, which once made this look like a product bug.
    fireEvent.click(screen.getByTestId('onboarding-exit-discard'));

    await waitFor(() => expect(router.state.location.pathname).toBe('/provider/onboarding'));
  });
});
