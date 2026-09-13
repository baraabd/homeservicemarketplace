import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, Outlet, RouterProvider, useLocation } from 'react-router';
import MockAdapter from 'axios-mock-adapter';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { api } from '../../../../lib/api';
import { LanguageProvider } from '../../../i18n/LanguageContext';
import { OnboardingTaskScreen } from './OnboardingTaskScreen';
import { ProviderOnboardingAutosaveProvider } from '../autosave/ProviderOnboardingAutosaveProvider';

// Sprint 9B.16 — the per-task route: what makes the hub resumable.
//
// The task is in the URL, so the test drives it the way a reload does — by
// entering at the address rather than by clicking through the hub.

const HUB_URL = '/v1/me/provider/onboarding/hub';
const DRAFT_URL = '/v1/me/provider/onboarding/draft';

/**
 * Enough of a draft for a task BODY to render.
 *
 * The tests above this one assert the shell — the header, the position, the
 * direction — and never needed it. G-14 is about what is drawn INSIDE the
 * shell, so its tests have to let the body load; without the draft every task
 * renders its skeleton and an assertion about emptiness would pass on a
 * loading screen, which is the wrong thing to be reassured by.
 */
const DRAFT = {
  state: 'DRAFT',
  currentStep: 'IDENTITY',
  steps: [],
  completedSteps: [],
  percentComplete: 17,
  nextAction: { kind: 'COMPLETE_STEP', step: 'IDENTITY' },
  complete: false,
  missing: [],
  version: 3,
  policyVersion: 'sprint-08',
  lastSavedAt: null,
  editable: true,
  data: {
    providerType: 'INDIVIDUAL',
    legalBusinessName: null,
    displayName: 'Pat Provider',
    profileImageUrl: null,
    phoneNumber: '+963900000444',
  },
};

const HUB = {
  tasks: [
    {
      id: 'BASICS_IDENTITY',
      group: 'BASICS',
      status: 'AVAILABLE',
      title: 'البيانات الأساسية',
      description: 'الاسم، رقم الهاتف، والصورة الشخصية',
    },
    {
      id: 'WORK_AREA',
      group: 'COVERAGE',
      status: 'BLOCKED',
      title: 'نطاق العمل',
      description: 'المدينة ونقطة التمركز الخاصة بك',
    },
  ],
  progress: { complete: 0, total: 6 },
  nextAction: { kind: 'COMPLETE_TASK', taskId: 'BASICS_IDENTITY' },
  status: 'DRAFT',
};

let mock: MockAdapter;

beforeEach(() => {
  mock = new MockAdapter(api);
});

afterEach(() => {
  mock.restore();
  window.localStorage.clear();
});

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

/**
 * Enter directly at the task URL — this is what a reload does.
 *
 * Sprint 9B.28 — a DATA router, and the coordinator mounted on a LAYOUT route
 * above the task, because that is now the production shape (see routes.ts).
 * Two things depend on it:
 *
 *   - the exit guard blocks browser Back through `useBlocker`, which only
 *     exists on a data router. A `MemoryRouter` here would have tested a
 *     component that cannot render in the app.
 *   - the autosave coordinator has to OUTLIVE the task component. Mounting it
 *     inside the task route would reproduce the very defect this sprint fixed
 *     while appearing to test the fix.
 */
function renderTask(taskId: string, lang: 'en' | 'ar' = 'en') {
  window.localStorage.setItem('hsm.lang', lang);
  const client = new QueryClient({ defaultOptions: { queries: { retryDelay: 0 } } });
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
  return render(
    <QueryClientProvider client={client}>
      <LanguageProvider>
        <RouterProvider router={router} />
      </LanguageProvider>
    </QueryClientProvider>,
  );
}

describe('OnboardingTaskScreen', () => {
  it('resumes the task named in the URL', async () => {
    mock.onGet(HUB_URL).reply(200, HUB);
    renderTask('BASICS_IDENTITY');

    await screen.findByTestId('task-screen-BASICS_IDENTITY');
    // Client prose, not the server's Arabic, for an English reader.
    //
    // Sprint 09B.29 Phase 5A — the header is the APPROVED SCREEN's title and
    // its "Task 1 of 6" position, not the hub row's task name. The assertion
    // that matters is unchanged: an English reader gets English, chosen by the
    // client, rather than whatever single language the server happened to send.
    expect(screen.getByText('Basic details')).toBeInTheDocument();
    expect(screen.getByText('Task 1 of 6')).toBeInTheDocument();
  });

  it('refuses a task the server says is blocked, even when reached by URL', async () => {
    // Typing a task id into the address bar must not get past a server
    // decision the hub would have enforced.
    mock.onGet(HUB_URL).reply(200, HUB);
    renderTask('WORK_AREA');

    await screen.findByTestId('task-screen-WORK_AREA');
    expect(screen.getByTestId('task-screen-blocked')).toBeInTheDocument();
    expect(screen.queryByTestId('task-screen-pending')).toBeNull();
  });

  it('explains an id that is not in the application at all', async () => {
    mock.onGet(HUB_URL).reply(200, HUB);
    renderTask('NOT_A_TASK');
    await screen.findByTestId('task-not-found');
  });

  it('waits for the server before deciding what the task is', async () => {
    // Rendering optimistically would mean showing a surface for a task the
    // server may be about to call blocked.
    mock.onGet(HUB_URL).reply(() => new Promise(() => {}));
    renderTask('BASICS_IDENTITY');

    expect(await screen.findByRole('status')).toBeInTheDocument();
    expect(screen.queryByTestId('task-screen-BASICS_IDENTITY')).toBeNull();
  });

  it('goes back to the hub', async () => {
    mock.onGet(HUB_URL).reply(200, HUB);
    renderTask('BASICS_IDENTITY');

    await screen.findByTestId('task-screen-BASICS_IDENTITY');
    fireEvent.click(screen.getByTestId('onboarding-v2-close'));
    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent('/provider/onboarding'),
    );
  });

  // ── Gap G-14: a finished task must not be a blank screen ────────────────
  //
  // Found by the Phase 5B real-API run and confirmed against the live server:
  // PATCHing a display name and a phone makes BASICS_IDENTITY COMPLETE, and a
  // COMPLETE task was drawn with no body and no explanation — the explanation
  // map covers WAITING and BLOCKED only. A provider who finished task 1 and
  // pressed reload saw a header, a progress bar and a "Save and continue"
  // with nothing between them.
  //
  // The hub row for a finished task is a non-interactive div, so this is not
  // reachable by clicking. It is reachable by RELOADING the screen you just
  // completed, and by any deep link to it, which is how the browser suite hit
  // it.
  const COMPLETED_HUB = {
    ...HUB,
    tasks: [{ ...HUB.tasks[0], status: 'COMPLETE' }, HUB.tasks[1]],
    progress: { complete: 1, total: 6 },
  };

  it('still shows a completed task its own fields, so the answers can be revised', async () => {
    mock.onGet(HUB_URL).reply(200, COMPLETED_HUB);
    mock.onGet(DRAFT_URL).reply(200, DRAFT);
    renderTask('BASICS_IDENTITY');

    await screen.findByTestId('task-screen-BASICS_IDENTITY');
    // The body, not an empty screen. `basics-task` is the form itself.
    expect(await screen.findByTestId('basics-task')).toBeInTheDocument();
  });

  it('never draws a task screen with no body and no explanation', async () => {
    // The general statement of G-14, rather than a restatement of the case
    // above: whatever the server says about a task, this screen owes the
    // provider either something to do or a reason there is nothing. Silence
    // is the one answer it may not give.
    for (const status of ['AVAILABLE', 'COMPLETE', 'BLOCKED', 'WAITING']) {
      mock.reset();
      mock.onGet(HUB_URL).reply(200, {
        ...HUB,
        tasks: [{ ...HUB.tasks[0], status }, HUB.tasks[1]],
      });
      mock.onGet(DRAFT_URL).reply(200, DRAFT);
      const view = renderTask('BASICS_IDENTITY');
      await screen.findByTestId('task-screen-BASICS_IDENTITY');

      await waitFor(() => {
        const body = screen.queryByTestId('basics-task');
        const blocked = screen.queryByTestId('task-screen-blocked');
        const pending = screen.queryByTestId('task-screen-pending');
        expect(
          body ?? blocked ?? pending,
          `status ${status} left the task screen empty`,
        ).not.toBeNull();
      });
      view.unmount();
    }
  });

  it('renders Arabic with an RTL direction', async () => {
    mock.onGet(HUB_URL).reply(200, HUB);
    renderTask('BASICS_IDENTITY', 'ar');

    await screen.findByTestId('task-screen-BASICS_IDENTITY');
    expect(screen.getByTestId('onboarding-v2-shell')).toHaveAttribute('dir', 'rtl');
    // The approved screen carries no task description — the header says what
    // the screen is, and the hub row already said what the task was. Arabic is
    // still asserted, on the copy the screen actually renders.
    expect(screen.getByText('البيانات الأساسية')).toBeInTheDocument();
    expect(screen.getByText('المهمة 1 من 6')).toBeInTheDocument();
  });
});
