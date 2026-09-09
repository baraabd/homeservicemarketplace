import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, Outlet, RouterProvider, useLocation } from 'react-router';
import MockAdapter from 'axios-mock-adapter';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { api } from '../../../../lib/api';
import { providerQueryKeys } from '../../../../lib/provider/query-keys';
import { LanguageProvider } from '../../../i18n/LanguageContext';
import { OnboardingTaskScreen } from '../components/OnboardingTaskScreen';
import { ProviderOnboardingAutosaveProvider } from './ProviderOnboardingAutosaveProvider';

// Sprint 09B.29 Phase 4 — A BLOCKED EXIT MUST BE RECOVERABLE BY KEYBOARD.
//
// The existing exit suite proves the provider is held on the task and that the
// notice carries `role="alert"`. What it does not prove is that the recovery
// is USABLE: an alert nobody can operate without a mouse is an announcement,
// not a recovery path.
//
// So this asserts the properties a keyboard and a screen reader depend on —
// that Retry and Keep editing are real, named, focusable controls, that they
// do what they say, and that a conflict offers Reload instead of a Retry that
// could only fail the same way.
//
// Focus is deliberately NOT moved to the notice. `role="alert"` +
// `aria-live="assertive"` announces it without interrupting, and yanking focus
// mid-announcement is worse for a screen reader user than leaving it on the
// control they just operated — which is still present and still visible.

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
  draftId: 'draft-exit-recovery',
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

function renderTask(lang: 'en' | 'ar' = 'en') {
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

async function editAndFailToLeave() {
  await screen.findByTestId('task-screen-BASICS_IDENTITY');
  const input = await screen.findByTestId('field-displayName');
  fireEvent.change(input, { target: { value: 'Will not save' } });
  fireEvent.click(screen.getByTestId('onboarding-v2-close'));
  return screen.findByTestId('onboarding-exit-blocked');
}

describe('Phase 4 — a blocked exit offers a recovery a keyboard can reach', () => {
  it('Retry and Keep editing are real, named, focusable buttons', async () => {
    mock.onPatch(PATCH).reply(500, { code: 'INTERNAL_ERROR' });
    renderTask();
    const notice = await editAndFailToLeave();

    expect(notice).toHaveAttribute('role', 'alert');

    // Found BY ROLE AND NAME, which is what a screen reader and a keyboard
    // both depend on — not by test id, which proves only that a div exists.
    const buttons = within(notice).getAllByRole('button');
    expect(buttons.length).toBeGreaterThanOrEqual(2);
    for (const button of buttons) {
      expect(button).toBeEnabled();
      // A real <button> is in the tab order by default; a div with an onClick
      // is not, and that is the failure this asserts against.
      expect(button.tagName).toBe('BUTTON');
      expect(button).toHaveAccessibleName();
      button.focus();
      expect(button).toHaveFocus();
    }
  });

  it('Retry resends the latest value and completes the exit once the server recovers', async () => {
    mock.onPatch(PATCH).replyOnce(500, { code: 'INTERNAL_ERROR' });
    mock.onPatch(PATCH).reply(200, DRAFT(4));
    const router = renderTask();
    const notice = await editAndFailToLeave();

    // Still on the task, and nothing claimed the data was saved.
    expect(router.state.location.pathname).toBe('/provider/onboarding/BASICS_IDENTITY');

    const retry = within(notice).getByRole('button', { name: /try again|retry/i });
    fireEvent.click(retry);

    await waitFor(() => expect(router.state.location.pathname).toBe('/provider/onboarding'));

    // The value that was retried is the one the provider typed, not an empty
    // payload left over from a cleared queue.
    const last = mock.history.patch[mock.history.patch.length - 1];
    expect(JSON.parse(String(last.data))).toMatchObject({ displayName: 'Will not save' });
  });

  it('a conflict offers Reload rather than a Retry that could only fail again', async () => {
    mock.onPatch(PATCH).reply(409, { details: { expectedVersion: 9 } });
    renderTask();
    const notice = await editAndFailToLeave();

    expect(notice).toHaveAttribute('data-reason', 'conflict');
    // Retrying a 409 presents the same stale token and fails identically, so
    // offering it would be an invitation to a loop.
    expect(within(notice).queryByRole('button', { name: /try again|retry/i })).toBeNull();
    expect(within(notice).getAllByRole('button').length).toBeGreaterThan(0);
  });

  it('the recovery is announced in Arabic too, not just rendered in it', async () => {
    mock.onPatch(PATCH).reply(500, { code: 'INTERNAL_ERROR' });
    renderTask('ar');
    const notice = await editAndFailToLeave();

    expect(notice).toHaveAttribute('role', 'alert');
    for (const button of within(notice).getAllByRole('button')) {
      expect(button).toHaveAccessibleName();
      // A control whose only label is an English string in an Arabic UI is
      // unusable by an Arabic screen reader.
      expect(button.textContent?.trim()).not.toBe('');
    }
  });
});
