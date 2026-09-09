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

// Sprint 09B.29 Phase 4 — AN UPLOAD IN FLIGHT IS UNSAVED WORK.
//
// The avatar is a coordinator bypass, and it should stay one: a multi-second
// binary upload does not belong in the same debounced queue as a keystroke.
// But "not in the queue" was silently taken to mean "not the exit contract's
// problem", and the two are different claims.
//
// What that cost, enumerated rather than hand-waved:
//
//   component unmount     `useEffect` cleanup calls `abort.current.abort()`,
//                         so leaving the task KILLS the upload.
//   route navigation      unmounts the task, so the same abort — and the exit
//                         path never knew there was anything to wait for, so
//                         it navigated immediately.
//   hard reload           `beforeunload` is armed from `hasPendingWork`, which
//                         counted only queued text. An upload got no prompt.
//   tab close             same as reload; the upload dies with the tab.
//   logout                purges caches and unmounts; same abort.
//   network interruption  already handled — the PUT rejects and the component
//                         shows a specific, retryable failure.
//
// In every one of those the provider watched a progress bar and lost the work,
// and nothing ever said "Saved", so no false claim was made — but silence is
// not the same as consent. Controlled navigation must WAIT for the upload, and
// an uncontrolled exit must warn.
//
// These tests fail before the repair.

const HUB_URL = '/v1/me/provider/onboarding/hub';
const PATCH = /\/v1\/me\/provider\/onboarding\/steps\/([A-Z_]+)$/;

const presignAvatar = vi.fn();
const putAvatarBytes = vi.fn();
const finalizeAvatar = vi.fn();
const removeAvatar = vi.fn();

vi.mock('../../../../lib/provider/provider-avatar-api', () => ({
  presignAvatar: (...a: unknown[]) => presignAvatar(...a),
  putAvatarBytes: (...a: unknown[]) => putAvatarBytes(...a),
  finalizeAvatar: (...a: unknown[]) => finalizeAvatar(...a),
  removeAvatar: (...a: unknown[]) => removeAvatar(...a),
  keyFromUploadUrl: (url: string) => url.replace(/^.*uploads\//, '').split('?')[0],
}));

const processAvatarImage = vi.fn();
vi.mock('../avatar/image-processing', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../avatar/image-processing')>();
  return { ...actual, processAvatarImage: (...a: unknown[]) => processAvatarImage(...a) };
});

const hubTask = (id: string, group: string) => ({
  id,
  group,
  status: 'AVAILABLE',
  title: id,
  description: id,
});

const HUB = {
  tasks: [hubTask('BASICS_IDENTITY', 'BASICS')],
  progress: { complete: 0, total: 1 },
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
  draftId: 'draft-upload-exit',
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
  },
});

let mock: MockAdapter;

beforeEach(() => {
  mock = new MockAdapter(api);
  mock.onGet(HUB_URL).reply(200, HUB);
  mock.onGet(/\/onboarding\/draft$/).reply(200, DRAFT());
  mock.onGet(/\/onboarding\/review/).reply(200, { groups: [], canSubmit: false });
  mock.onGet(/\/service-categories|\/equipment/).reply(200, []);
  mock.onPatch(PATCH).reply(200, DRAFT(4));

  processAvatarImage.mockResolvedValue({
    blob: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' }),
    contentType: 'image/jpeg',
    width: 512,
    height: 512,
    previewUrl: 'blob:preview',
  });
  presignAvatar.mockResolvedValue({
    uploadUrl: 'http://api.test/v1/media/uploads/avatars/ref/new.jpg?sig=x',
    fileUrl: 'http://api.test/v1/media/files/avatars/ref/new.jpg',
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  });
  finalizeAvatar.mockResolvedValue({
    ...DRAFT(5),
    data: { ...DRAFT(5).data, profileImageUrl: 'https://cdn.test/a.jpg' },
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
    { initialEntries: ['/provider/onboarding/BASICS_IDENTITY'] },
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

function pickAvatar() {
  const input = screen.getByTestId('avatar-input-gallery') as HTMLInputElement;
  const file = new File([new Uint8Array([1, 2, 3])], 'me.jpg', { type: 'image/jpeg' });
  fireEvent.change(input, { target: { files: [file] } });
}

describe('Phase 4 — a photo upload is unsaved work for the exit contract', () => {
  it('Close WAITS for an in-flight upload instead of navigating out from under it', async () => {
    let releaseUpload!: () => void;
    putAvatarBytes.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          releaseUpload = () => resolve();
        }),
    );

    const router = renderTask();
    await screen.findByTestId('task-screen-BASICS_IDENTITY');

    // ORDERING IS RECORDED, NOT TIMED.
    //
    // Two earlier versions of this test were wrong in opposite directions: one
    // asserted "still on the task" with `waitFor`, which resolves on its first
    // check and passed with the tracking mutated out; the next used a 60ms
    // sleep, which is an arbitrary delay standing in for a correctness
    // property and was load-dependent.
    //
    // This records WHERE THE ROUTER WAS at the instant finalize ran. If the
    // exit did not wait, navigation happens on the click and finalize sees the
    // hub. There is no clock in the assertion at all.
    let routeAtFinalize: string | null = null;
    finalizeAvatar.mockImplementation(async () => {
      routeAtFinalize = router.state.location.pathname;
      return { ...DRAFT(5), data: { ...DRAFT(5).data, profileImageUrl: 'https://cdn.test/a.jpg' } };
    });

    pickAvatar();
    await waitFor(() => expect(putAvatarBytes).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByTestId('onboarding-v2-close'));
    expect(finalizeAvatar).not.toHaveBeenCalled();

    releaseUpload();

    // Finalize runs, and it runs while the provider is STILL on the task.
    await waitFor(() => expect(finalizeAvatar).toHaveBeenCalledTimes(1));
    expect(routeAtFinalize).toBe('/provider/onboarding/BASICS_IDENTITY');

    // Only then does the route change.
    await waitFor(() => expect(router.state.location.pathname).toBe('/provider/onboarding'));
  });

  it('a hard reload during an upload is warned about, because the upload dies with the page', async () => {
    let releaseUpload!: () => void;
    putAvatarBytes.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          releaseUpload = () => resolve();
        }),
    );

    renderTask();
    await screen.findByTestId('task-screen-BASICS_IDENTITY');
    pickAvatar();
    await waitFor(() => expect(putAvatarBytes).toHaveBeenCalledTimes(1));

    // `beforeunload` only prompts if a listener calls preventDefault. Nothing
    // here can claim the upload survives the unload — it does not — so the
    // only honest behaviour is to ask.
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);

    releaseUpload();
    await waitFor(() => expect(finalizeAvatar).toHaveBeenCalledTimes(1));
  });

  it('a FAILED upload blocks the exit and demands an explicit decision', async () => {
    // The first `allSettled` design treated a rejected upload as "settled" and
    // let the provider walk out of the screen. Nothing said Saved, so no false
    // claim was made — but the photo was silently gone, and silence is not
    // consent. A failure has to be shown and answered.
    putAvatarBytes.mockRejectedValue(new Error('network died mid-upload'));

    const router = renderTask();
    await screen.findByTestId('task-screen-BASICS_IDENTITY');
    pickAvatar();
    await waitFor(() => expect(putAvatarBytes).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByTestId('onboarding-v2-close'));

    // Held on the task, with an accessible explanation.
    const notice = await screen.findByTestId('onboarding-exit-blocked');
    expect(notice).toHaveAttribute('role', 'alert');
    expect(router.state.location.pathname).toBe('/provider/onboarding/BASICS_IDENTITY');
    // And nothing claimed the photo was saved.
    expect(finalizeAvatar).not.toHaveBeenCalled();
  });

  it('leaving after a failed upload is an explicit act, never implicit', async () => {
    putAvatarBytes.mockRejectedValue(new Error('network died mid-upload'));

    const router = renderTask();
    await screen.findByTestId('task-screen-BASICS_IDENTITY');
    pickAvatar();
    await waitFor(() => expect(putAvatarBytes).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByTestId('onboarding-v2-close'));
    await screen.findByTestId('onboarding-exit-blocked');

    // Clicking Close AGAIN must not be the discard. Repeating a gesture the
    // product just refused is not a decision about the photo.
    fireEvent.click(screen.getByTestId('onboarding-v2-close'));
    await waitFor(() =>
      expect(router.state.location.pathname).toBe('/provider/onboarding/BASICS_IDENTITY'),
    );

    // Re-queried from the LIVE document, not from a node captured earlier.
    //
    // The second click re-renders the notice, which detaches the node the
    // first `findByTestId` returned. `within(staleNode)` still finds a button
    // in that orphan, and clicking it dispatches into a tree React is no
    // longer listening to — so the handler never runs and the test fails as if
    // the product were broken. It cost two wrong product "fixes" before the
    // instrumentation showed `discard` was never called at all.
    const discard = await screen.findByTestId('onboarding-exit-discard');
    expect(discard.tagName).toBe('BUTTON');
    expect(discard).toHaveAccessibleName();
    fireEvent.click(discard);

    await waitFor(() => expect(router.state.location.pathname).toBe('/provider/onboarding'));
  });

  it('once the upload is acknowledged, the exit is immediate again', async () => {
    putAvatarBytes.mockResolvedValue(undefined);

    const router = renderTask();
    await screen.findByTestId('task-screen-BASICS_IDENTITY');
    pickAvatar();

    // Nothing outstanding: an upload the SERVER has acknowledged must not keep
    // holding the provider on the screen.
    //
    // Polled rather than asserted once. `finalizeAvatar` having been CALLED is
    // not the end of the tracked operation — the promise also covers
    // `onSaved`, which seeds the authoritative view and version. Asserting at
    // the call was a real race: it failed on 3 of 5 runs under load, because
    // the coordinator was still legitimately busy. `waitFor` still fails if the
    // work is never released, which is the property worth keeping.
    await waitFor(() => {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    });

    fireEvent.click(screen.getByTestId('onboarding-v2-close'));
    await waitFor(() => expect(router.state.location.pathname).toBe('/provider/onboarding'));
  });
});
