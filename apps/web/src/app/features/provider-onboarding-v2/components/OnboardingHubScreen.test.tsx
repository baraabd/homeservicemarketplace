import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import MockAdapter from 'axios-mock-adapter';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { api } from '../../../../lib/api';
import { LanguageProvider } from '../../../i18n/LanguageContext';
import { OnboardingHubScreen } from './OnboardingHubScreen';

// Sprint 9B.16 — the hub, as a provider experiences it.
//
// The state machine is asserted in hub-view-state.test.ts. This file asserts
// what is on the screen and what can be pressed — and, above all, that the
// numbers and the row states come from the SERVER. A hub that computed its own
// progress could tell a provider they are finished while the API refuses their
// submission.

const HUB_URL = '/v1/me/provider/onboarding/hub';

// The canonical 9B.15 response, verbatim.
const CANONICAL = {
  tasks: [
    {
      id: 'BASICS_IDENTITY',
      group: 'BASICS',
      status: 'AVAILABLE',
      title: 'البيانات الأساسية',
      description: 'الاسم، رقم الهاتف، والصورة الشخصية',
    },
    {
      id: 'SERVICES_EXPERIENCE',
      group: 'SERVICES',
      status: 'BLOCKED',
      title: 'الخدمات والخبرة',
      description: 'التخصص، سنوات الخبرة، ووسيلة النقل',
    },
    {
      id: 'WORK_AREA',
      group: 'COVERAGE',
      status: 'BLOCKED',
      title: 'نطاق العمل',
      description: 'المدينة ونقطة التمركز الخاصة بك',
    },
    {
      id: 'WORKING_HOURS',
      group: 'COVERAGE',
      status: 'BLOCKED',
      title: 'ساعات العمل',
      description: 'أيام وأوقات توفرك لاستقبال الطلبات',
    },
    {
      id: 'PORTFOLIO',
      group: 'PROFILE',
      status: 'BLOCKED',
      title: 'معرض الأعمال',
      description: 'نبذة تعريفية وصور من أعمالك السابقة',
    },
    {
      id: 'REVIEW_SUBMISSION',
      group: 'REVIEW',
      status: 'BLOCKED',
      title: 'المراجعة والإرسال',
      description: 'تأكيد البيانات والموافقة على الشروط',
    },
  ],
  progress: { complete: 0, total: 6 },
  nextAction: { kind: 'COMPLETE_TASK', taskId: 'BASICS_IDENTITY' },
  status: 'DRAFT',
};

const hub = (over: Record<string, unknown> = {}) => ({ ...CANONICAL, ...over });

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

function renderHub(lang: 'en' | 'ar' = 'en') {
  window.localStorage.setItem('hsm.lang', lang);
  const client = new QueryClient({
    // `retry` is deliberately NOT overridden here: the hook sets its own
    // policy (401/403/404 are answers, everything else gets two attempts) and
    // that policy is part of what these tests exercise. Only the DELAY is
    // flattened, so the two retries a 500 earns cost milliseconds instead of
    // three seconds of exponential backoff.
    defaultOptions: { queries: { retryDelay: 0 }, mutations: { retry: false } },
  });
  return render(
    <MemoryRouter initialEntries={['/provider/onboarding']}>
      <QueryClientProvider client={client}>
        <LanguageProvider>
          <Routes>
            <Route path="/provider/onboarding" element={<OnboardingHubScreen />} />
            <Route path="*" element={<LocationProbe />} />
          </Routes>
        </LanguageProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

const at = () => screen.getByTestId('location').textContent;

describe('OnboardingHubScreen — the task list', () => {
  it('renders one row per server task, and nothing else', async () => {
    mock.onGet(HUB_URL).reply(200, hub());
    renderHub();

    await screen.findByTestId('hub-task-list');
    for (const task of CANONICAL.tasks) {
      expect(screen.getByTestId(`task-row-${task.id}`)).toBeInTheDocument();
    }
    // The hub is NOT a task: six rows for six tasks, no seventh for itself.
    expect(
      screen.getByTestId('hub-task-list').querySelectorAll('[data-testid^="task-row-"]'),
    ).toHaveLength(6);
  });

  it('groups the tasks under the groups the server sent, in order', async () => {
    mock.onGet(HUB_URL).reply(200, hub());
    renderHub();

    await screen.findByTestId('hub-task-list');
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    // Five groups, because the response sends five. The two COVERAGE tasks
    // share one heading rather than repeating it.
    expect(headings).toEqual([
      'BASICS',
      'YOUR SERVICES',
      'WHERE AND WHEN YOU WORK',
      'YOUR PROFILE',
      'REVIEW',
    ]);

    const coverage = screen.getByRole('region', { name: 'WHERE AND WHEN YOU WORK' });
    expect(within(coverage).getAllByTestId(/^task-row-/)).toHaveLength(2);
  });

  it('renders the progress COUNT the server sent', async () => {
    mock.onGet(HUB_URL).reply(200, hub());
    renderHub();
    expect(await screen.findByTestId('onboarding-v2-progress')).toHaveTextContent(
      '0 of 6 complete',
    );
  });

  it('renders the server count even when it disagrees with the rows', async () => {
    // The load-bearing assertion for "do not infer readiness". If the client
    // counted COMPLETE rows it would say 1; the server says 3, so it says 3.
    const tasks = CANONICAL.tasks.map((t, i) => (i === 0 ? { ...t, status: 'COMPLETE' } : t));
    mock.onGet(HUB_URL).reply(200, hub({ tasks, progress: { complete: 3, total: 6 } }));
    renderHub();
    expect(await screen.findByTestId('onboarding-v2-progress')).toHaveTextContent(
      '3 of 6 complete',
    );
  });
});

describe('OnboardingHubScreen — what can be pressed', () => {
  it('makes an AVAILABLE row a real button', async () => {
    mock.onGet(HUB_URL).reply(200, hub());
    renderHub();

    const row = await screen.findByTestId('task-row-BASICS_IDENTITY');
    expect(row.tagName).toBe('BUTTON');
    expect(row).toHaveAttribute('data-actionable', 'true');
    expect(row).toBeEnabled();
  });

  it('does NOT make a BLOCKED row a button, disabled or otherwise', async () => {
    mock.onGet(HUB_URL).reply(200, hub());
    renderHub();

    const row = await screen.findByTestId('task-row-WORK_AREA');
    expect(row.tagName).not.toBe('BUTTON');
    expect(row).toHaveAttribute('data-actionable', 'false');
    // A blocked row must not be reachable as a control at all.
    expect(within(row).queryByRole('button')).toBeNull();
  });

  it('tells the provider WHY a blocked row cannot be opened', async () => {
    mock.onGet(HUB_URL).reply(200, hub());
    renderHub();
    const explanation = await screen.findByTestId('task-explanation-WORK_AREA');
    expect(explanation.textContent?.trim().length ?? 0).toBeGreaterThan(0);
  });

  it('explains a WAITING row differently from a BLOCKED one', async () => {
    const tasks = CANONICAL.tasks.map((t) =>
      t.id === 'WORK_AREA' ? { ...t, status: 'WAITING' } : t,
    );
    mock.onGet(HUB_URL).reply(200, hub({ tasks }));
    renderHub();

    const waiting = await screen.findByTestId('task-explanation-WORK_AREA');
    const blocked = screen.getByTestId('task-explanation-PORTFOLIO');
    // "We are checking this" and "finish the earlier tasks" are different
    // instructions; collapsing them tells the provider to do the wrong thing.
    expect(waiting.textContent).not.toBe(blocked.textContent);
  });

  it('opens the task route when an available row is pressed', async () => {
    mock.onGet(HUB_URL).reply(200, hub());
    renderHub();

    fireEvent.click(await screen.findByTestId('task-row-BASICS_IDENTITY'));
    await waitFor(() => expect(at()).toBe('/provider/onboarding/BASICS_IDENTITY'));
  });
});

describe('OnboardingHubScreen — the dynamic CTA', () => {
  it('opens the task named by nextAction', async () => {
    mock
      .onGet(HUB_URL)
      .reply(200, hub({ nextAction: { kind: 'COMPLETE_TASK', taskId: 'WORK_AREA' } }));
    renderHub();

    fireEvent.click(await screen.findByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(at()).toBe('/provider/onboarding/WORK_AREA'));
  });

  it('renders no CTA when the server says there is nothing to do', async () => {
    mock.onGet(HUB_URL).reply(200, hub({ nextAction: { kind: 'NONE' } }));
    renderHub();

    await screen.findByTestId('hub-task-list');
    expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull();
  });

  it('renders no CTA when nextAction names a task the hub is not showing', async () => {
    mock
      .onGet(HUB_URL)
      .reply(200, hub({ nextAction: { kind: 'COMPLETE_TASK', taskId: 'GHOST_TASK' } }));
    renderHub();

    await screen.findByTestId('hub-task-list');
    expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull();
  });
});

describe('OnboardingHubScreen — the shell', () => {
  it('renders no bottom application navigation', async () => {
    mock.onGet(HUB_URL).reply(200, hub());
    renderHub();

    await screen.findByTestId('hub-task-list');
    // The provider nav labels, none of which belong on a form.
    for (const label of ['Jobs', 'My Bids', 'Chat', 'Wallet', 'Profile']) {
      expect(screen.queryByRole('button', { name: label })).toBeNull();
    }
  });

  it('offers a close control that goes back to the provider surface', async () => {
    mock.onGet(HUB_URL).reply(200, hub());
    renderHub();

    fireEvent.click(await screen.findByTestId('onboarding-v2-close'));
    await waitFor(() => expect(at()).toBe('/provider'));
  });
});

describe('OnboardingHubScreen — states', () => {
  it('shows a spinner, announced, while the hub is loading', async () => {
    mock.onGet(HUB_URL).reply(() => new Promise(() => {}));
    renderHub();

    expect(await screen.findByTestId('hub-state-LOADING')).toHaveAttribute('role', 'status');
    expect(screen.getByTestId('hub-loading-spinner')).toBeInTheDocument();
  });

  it('offers a retry on a recoverable error, and recovers', async () => {
    mock.onGet(HUB_URL).reply(500);
    renderHub();

    await screen.findByTestId('hub-state-ERROR');

    // reset(), not a second onGet: handlers match in registration order, so
    // adding a 200 behind the 500 would leave the 500 answering forever and
    // the retry would look broken when it is the fixture that is.
    mock.reset();
    mock.onGet(HUB_URL).reply(200, hub());
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    await screen.findByTestId('hub-task-list');
  });

  it.each([401, 403])('shows the unauthorized state on %i', async (status) => {
    mock.onGet(HUB_URL).reply(status);
    renderHub();
    await screen.findByTestId('hub-state-UNAUTHORIZED');
  });

  it('shows the empty state, not an error, on 404', async () => {
    mock.onGet(HUB_URL).reply(404);
    renderHub();
    await screen.findByTestId('hub-state-EMPTY');
  });

  it('shows the empty state when the server sends no tasks', async () => {
    mock.onGet(HUB_URL).reply(200, hub({ tasks: [] }));
    renderHub();
    await screen.findByTestId('hub-state-EMPTY');
  });

  it('hides the task list once the application is submitted', async () => {
    mock.onGet(HUB_URL).reply(200, hub({ status: 'SUBMITTED' }));
    renderHub();

    await screen.findByTestId('hub-state-SUBMITTED');
    expect(screen.queryByTestId('hub-task-list')).toBeNull();
    // And it must not claim approval — the sentence a provider acts on.
    expect(screen.queryByText(/approved/i)).toBeNull();
  });

  it('shows ACTION_REQUIRED as a banner ABOVE the tasks, not instead of them', async () => {
    mock.onGet(HUB_URL).reply(200, hub({ status: 'ACTION_REQUIRED' }));
    renderHub();

    await screen.findByTestId('hub-state-ACTION_REQUIRED');
    // The banner is only useful if the provider can act on it.
    expect(screen.getByTestId('hub-task-list')).toBeInTheDocument();
  });

  it('tells an already-active provider there is nothing to fill in', async () => {
    mock.onGet(HUB_URL).reply(200, hub({ status: 'ACTIVE' }));
    renderHub();

    await screen.findByTestId('hub-state-ALREADY_ACTIVE');
    expect(screen.queryByTestId('hub-task-list')).toBeNull();
  });
});

describe('OnboardingHubScreen — Arabic', () => {
  it('renders Arabic prose and an RTL direction', async () => {
    mock.onGet(HUB_URL).reply(200, hub());
    renderHub('ar');

    await screen.findByTestId('hub-task-list');
    expect(screen.getByTestId('onboarding-v2-shell')).toHaveAttribute('dir', 'rtl');
    expect(screen.getByText('البيانات الأساسية')).toBeInTheDocument();
    expect(screen.getByTestId('onboarding-v2-progress').textContent).toContain('6');
  });

  it('renders ENGLISH prose for an English reader, not the server Arabic', async () => {
    // The parity regression: the response carries Arabic titles only.
    mock.onGet(HUB_URL).reply(200, hub());
    renderHub('en');

    await screen.findByTestId('hub-task-list');
    expect(screen.getByText('Your details')).toBeInTheDocument();
    expect(screen.queryByText('البيانات الأساسية')).toBeNull();
    expect(screen.getByTestId('onboarding-v2-shell')).toHaveAttribute('dir', 'ltr');
  });
});
