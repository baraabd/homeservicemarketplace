import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import MockAdapter from 'axios-mock-adapter';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { api } from '../../../../lib/api';
import { LanguageProvider } from '../../../i18n/LanguageContext';
import { OnboardingTaskScreen } from './OnboardingTaskScreen';

// Sprint 9B.16 — the per-task route: what makes the hub resumable.
//
// The task is in the URL, so the test drives it the way a reload does — by
// entering at the address rather than by clicking through the hub.

const HUB_URL = '/v1/me/provider/onboarding/hub';

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

/** Enter directly at the task URL — this is what a reload does. */
function renderTask(taskId: string, lang: 'en' | 'ar' = 'en') {
  window.localStorage.setItem('hsm.lang', lang);
  const client = new QueryClient({ defaultOptions: { queries: { retryDelay: 0 } } });
  return render(
    <MemoryRouter initialEntries={[`/provider/onboarding/${taskId}`]}>
      <QueryClientProvider client={client}>
        <LanguageProvider>
          <Routes>
            <Route path="/provider/onboarding/:taskId" element={<OnboardingTaskScreen />} />
            <Route path="*" element={<LocationProbe />} />
          </Routes>
        </LanguageProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('OnboardingTaskScreen', () => {
  it('resumes the task named in the URL', async () => {
    mock.onGet(HUB_URL).reply(200, HUB);
    renderTask('BASICS_IDENTITY');

    await screen.findByTestId('task-screen-BASICS_IDENTITY');
    // Client prose, not the server's Arabic, for an English reader.
    expect(screen.getByText('Your details')).toBeInTheDocument();
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

  it('renders Arabic with an RTL direction', async () => {
    mock.onGet(HUB_URL).reply(200, HUB);
    renderTask('BASICS_IDENTITY', 'ar');

    await screen.findByTestId('task-screen-BASICS_IDENTITY');
    expect(screen.getByTestId('onboarding-v2-shell')).toHaveAttribute('dir', 'rtl');
    expect(screen.getByText('الاسم، رقم الهاتف، والصورة الشخصية')).toBeInTheDocument();
  });
});
