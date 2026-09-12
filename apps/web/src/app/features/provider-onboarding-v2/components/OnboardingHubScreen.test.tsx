import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import MockAdapter from 'axios-mock-adapter';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { api } from '../../../../lib/api';
import { LanguageProvider } from '../../../i18n/LanguageContext';
import { statusExplanation, statusLabel } from '../copy/onboarding-hub-copy';
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
    // FOUR sections, from five server groups. The approved hub puts Review
    // under the same "Public profile" heading as the portfolio task, so those
    // two codes resolve to one section — see `sectionOf`. The two COVERAGE
    // tasks still share one heading rather than repeating it.
    //
    // Sentence case, not caps: Mode B replaced 11px tracked-out all-caps grey
    // — decoration that happened to contain words — with a readable heading.
    expect(headings).toEqual(['Basics', 'Your services', 'Where and when', 'Public profile']);

    const coverage = screen.getByRole('region', { name: 'Where and when' });
    expect(within(coverage).getAllByTestId(/^task-row-/)).toHaveLength(2);

    // The merge must not swallow a task: all six rows are still rendered, and
    // the section that absorbed Review carries both of its rows.
    expect(screen.getAllByTestId(/^task-row-/)).toHaveLength(6);
    const profile = screen.getByRole('region', { name: 'Public profile' });
    expect(within(profile).getAllByTestId(/^task-row-/)).toHaveLength(2);
  });

  it('renders the progress COUNT the server sent', async () => {
    mock.onGet(HUB_URL).reply(200, hub());
    renderHub();
    expect(await screen.findByTestId('onboarding-v2-progress')).toHaveTextContent(
      '0 of 6 tasks complete',
    );
  });

  it('renders the server count even when it disagrees with the rows', async () => {
    // The load-bearing assertion for "do not infer readiness". If the client
    // counted COMPLETE rows it would say 1; the server says 3, so it says 3.
    const tasks = CANONICAL.tasks.map((t, i) => (i === 0 ? { ...t, status: 'COMPLETE' } : t));
    mock.onGet(HUB_URL).reply(200, hub({ tasks, progress: { complete: 3, total: 6 } }));
    renderHub();
    expect(await screen.findByTestId('onboarding-v2-progress')).toHaveTextContent(
      '3 of 6 tasks complete',
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

// Sprint 09B.29 Phase 3, JOURNEY B — the client half of the deadlock repair.
//
// The server no longer blocks submission on a specialty the platform has not
// yet approved, and `phase3-journey-b-work-access-denied.integration.spec.ts`
// pins the server side. This block pins the SCREEN, because the deadlock was
// only half a server bug: a hub that renders the waiting specialty as the
// provider's own outstanding task sends them back into a form on which every
// editable field is already filled in, and no amount of server correctness
// fixes that.
//
// The payload below is the one the API actually returns for that state,
// transcribed from the integration journey: SERVICES_EXPERIENCE WAITING,
// REVIEW_SUBMISSION AVAILABLE, progress 5 of 6, nextAction SUBMIT.
const PENDING_MODERATION = hub({
  tasks: CANONICAL.tasks.map((t) => {
    if (t.id === 'SERVICES_EXPERIENCE') return { ...t, status: 'WAITING' };
    if (t.id === 'REVIEW_SUBMISSION') return { ...t, status: 'AVAILABLE' };
    return { ...t, status: 'COMPLETE' };
  }),
  progress: { complete: 5, total: 6 },
  nextAction: { kind: 'SUBMIT' },
});

describe('OnboardingHubScreen — a specialty still in moderation', () => {
  it('does not present the waiting specialty as the provider’s own work', async () => {
    mock.onGet(HUB_URL).reply(200, PENDING_MODERATION);
    renderHub();

    const row = await screen.findByTestId('task-row-SERVICES_EXPERIENCE');
    // The exact regression: an openable row here is an invitation to redo work
    // that is already done and is not what is holding the application up.
    expect(row.tagName).not.toBe('BUTTON');
    expect(row).toHaveAttribute('data-actionable', 'false');
    expect(within(row).queryByRole('button')).toBeNull();
  });

  it('explains it as ours to finish, not theirs', async () => {
    mock.onGet(HUB_URL).reply(200, PENDING_MODERATION);
    renderHub();

    // Asserted against the copy module rather than a frozen string, so
    // rewording stays free while a MAPPING error — the waiting specialty
    // explained as "finish the tasks above first", which is the instruction
    // that sent providers back into a completed form — fails here.
    const explanation = await screen.findByTestId('task-explanation-SERVICES_EXPERIENCE');
    expect(explanation).toHaveTextContent(statusExplanation('WAITING', 'en') ?? '');
    expect(explanation.textContent).not.toBe(statusExplanation('BLOCKED', 'en'));

    const row = screen.getByTestId('task-row-SERVICES_EXPERIENCE');
    expect(row).toHaveTextContent(statusLabel('WAITING', 'en'));
    // Not labelled as something to do.
    expect(row).not.toHaveTextContent(statusLabel('AVAILABLE', 'en'));
  });

  it('keeps the review task open — moderation does not bar submission', async () => {
    mock.onGet(HUB_URL).reply(200, PENDING_MODERATION);
    renderHub();

    const review = await screen.findByTestId('task-row-REVIEW_SUBMISSION');
    expect(review.tagName).toBe('BUTTON');
    expect(review).toHaveAttribute('data-actionable', 'true');
    expect(review).toBeEnabled();
  });

  it('points the primary action at submitting, not back at the waiting task', async () => {
    mock.onGet(HUB_URL).reply(200, PENDING_MODERATION);
    renderHub();

    // The approved complete-hub action reads 'Review application': submission
    // itself lives on the review screen, and a hub button that said 'Submit'
    // promised a write it does not perform.
    fireEvent.click(await screen.findByRole('button', { name: 'Review application' }));
    await waitFor(() => expect(at()).toBe('/provider/onboarding/REVIEW_SUBMISSION'));
  });

  it('counts the provider’s own part as done, from the server’s number', async () => {
    mock.onGet(HUB_URL).reply(200, PENDING_MODERATION);
    renderHub();
    // Before the repair this read 4 of 6 and told a provider who had finished
    // that they had not.
    expect(await screen.findByTestId('onboarding-v2-progress')).toHaveTextContent(
      '5 of 6 tasks complete',
    );
  });

  it('raises no action-required banner — nothing is being asked of them', async () => {
    mock.onGet(HUB_URL).reply(200, PENDING_MODERATION);
    renderHub();

    await screen.findByTestId('hub-task-list');
    expect(screen.queryByTestId('hub-state-ACTION_REQUIRED')).toBeNull();
  });

  it('reads the same way in Arabic', async () => {
    mock.onGet(HUB_URL).reply(200, PENDING_MODERATION);
    renderHub('ar');

    const row = await screen.findByTestId('task-row-SERVICES_EXPERIENCE');
    expect(row).toHaveAttribute('data-actionable', 'false');
    // The Arabic CTA, not a transliteration and not the English string.
    expect(screen.getByRole('button', { name: 'مراجعة الطلب' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Review application' })).toBeNull();
  });
});

describe('OnboardingHubScreen — the dynamic CTA', () => {
  it('opens the task named by nextAction', async () => {
    mock
      .onGet(HUB_URL)
      .reply(200, hub({ nextAction: { kind: 'COMPLETE_TASK', taskId: 'WORK_AREA' } }));
    renderHub();

    // The approved label names WHERE it goes — 'Start: <section>' — and the
    // section comes from the group of the task the server nominated.
    fireEvent.click(await screen.findByRole('button', { name: 'Start: Where and when' }));
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

  it('shows the unauthorized state on 401', async () => {
    mock.onGet(HUB_URL).reply(401);
    renderHub();
    await screen.findByTestId('hub-state-UNAUTHORIZED');
  });

  // Sprint 9B.29 — 403 gets its OWN screen. This case used to be folded into
  // the 401 assertion above, which is how a freshly-upgraded provider whose
  // token predates the role grant was told their session had expired and sent
  // to sign in again — advice that cannot fix a stale role claim.
  it('shows the forbidden state on 403, never the session-expired copy', async () => {
    mock.onGet(HUB_URL).reply(403);
    // The recovery rotation fires once on the first 403. Both calls are stubbed
    // so the attempt resolves deterministically instead of hitting the network;
    // the role set comes back WITHOUT `provider`, which is the "genuine
    // refusal" branch and leaves the forbidden screen on display.
    mock.onPost('/v1/auth/refresh').reply(200);
    mock.onGet('/v1/auth/me').reply(200, {
      id: 'u1',
      email: 'p@example.com',
      firstName: 'P',
      lastName: 'R',
      status: 'ACTIVE',
      emailVerifiedAt: null,
      mfaEnabled: false,
      roles: ['seeker'],
    });

    renderHub();

    await screen.findByTestId('hub-state-FORBIDDEN');
    expect(screen.queryByTestId('hub-state-UNAUTHORIZED')).toBeNull();
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
    expect(screen.getByText('Basic details')).toBeInTheDocument();
    expect(screen.queryByText('البيانات الأساسية')).toBeNull();
    expect(screen.getByTestId('onboarding-v2-shell')).toHaveAttribute('dir', 'ltr');
  });
});
