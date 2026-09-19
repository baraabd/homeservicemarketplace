import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import MockAdapter from 'axios-mock-adapter';
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { api } from '../../../../lib/api';
import { providerQueryKeys } from '../../../../lib/provider/query-keys';
import { LanguageProvider } from '../../../i18n/LanguageContext';
import { ProviderOnboardingAutosaveProvider } from '../autosave/ProviderOnboardingAutosaveProvider';
import { OnboardingTaskScreen } from './OnboardingTaskScreen';

const DRAFT_URL = '/v1/me/provider/onboarding/draft';
const PATCH_URL = '/v1/me/provider/onboarding/steps/EXPERIENCE';
const year = new Date().getUTCFullYear();
const since = (years: number) => `${year - years}-01-01T00:00:00.000Z`;
const draft = (professionSince: string | null, yearsOfExperience: number | null = null) => ({
  state: 'DRAFT',
  currentStep: 'EXPERIENCE',
  steps: [],
  completedSteps: [],
  percentComplete: 0,
  nextAction: { kind: 'COMPLETE_STEP', step: 'EXPERIENCE' },
  complete: false,
  missing: [],
  awaitingReview: [],
  version: 3,
  policyVersion: 'v3',
  lastSavedAt: null,
  editable: true,
  data: {
    professionSince,
    yearsOfExperience,
    specialties: [],
    specialtyLeafIds: [],
    transportModes: [],
    transportMode: null,
    maxSpecialties: 5,
    suggestedTitle: null,
  },
});

let mock: MockAdapter;
beforeEach(() => {
  mock = new MockAdapter(api);
  mock.onGet('/v1/services').reply(200, { items: [] });
  mock.onGet('/v1/me/provider/onboarding/hub').reply(200, {
    status: 'DRAFT',
    progress: { complete: 0, total: 6 },
    nextAction: { kind: 'COMPLETE_TASK', taskId: 'SERVICES_EXPERIENCE' },
    tasks: [
      {
        id: 'SERVICES_EXPERIENCE',
        group: 'SERVICES',
        status: 'AVAILABLE',
        title: 'Your services',
        description: '',
      },
    ],
  });
});
afterEach(() => {
  mock.restore();
  window.localStorage.clear();
});

function setup(initial = draft(null), lang: 'en' | 'ar' = 'en', preload = true) {
  window.localStorage.setItem('hsm.lang', lang);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  if (preload) {
    client.setQueryData(providerQueryKeys.onboarding.draft(), initial);
    mock.onGet(DRAFT_URL).reply(200, initial);
  }
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
          { path: 'WORK_AREA', element: <div data-testid="next-task">Work area</div> },
          { path: ':taskId', element: <OnboardingTaskScreen /> },
        ],
      },
    ],
    { initialEntries: ['/provider/onboarding/SERVICES_EXPERIENCE#experience'] },
  );
  render(
    <QueryClientProvider client={client}>
      <LanguageProvider>
        <RouterProvider router={router} />
      </LanguageProvider>
    </QueryClientProvider>,
  );
  return { client, router };
}

describe('experience uses the acknowledged answer and an explicit save', () => {
  it('replaces the old numeric answer when explicitly editing date-based experience', async () => {
    mock.onPatch(PATCH_URL).reply(200, { ...draft(since(13)), version: 4 });
    setup(draft(null, 12));
    fireEvent.click(await screen.findByTestId('experience-years-increase'));
    fireEvent.click(screen.getByTestId('task-save-and-continue'));
    expect(await screen.findByTestId('next-task')).toBeInTheDocument();
    expect(JSON.parse(mock.history.patch[0].data)).toMatchObject({
      professionSince: since(13),
      yearsOfExperience: null,
      version: 3,
    });
  });

  it('disables confirmation until the draft form is available', async () => {
    let release!: (value: [number, unknown]) => void;
    mock.onGet(DRAFT_URL).reply(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    setup(draft(null), 'en', false);
    expect(await screen.findByTestId('task-save-and-continue')).toBeDisabled();
    expect(screen.queryByTestId('experience-years-value')).not.toBeInTheDocument();
    await act(async () => release([200, draft(null)]));
    expect(await screen.findByTestId('experience-years-value')).toHaveTextContent('0');
    expect(screen.getByTestId('task-save-and-continue')).toBeEnabled();
  });

  it('keeps confirmation disabled if the draft failed to load', async () => {
    mock.onGet(DRAFT_URL).reply(500, {});
    setup(draft(null), 'en', false);
    expect(await screen.findByTestId('task-save-and-continue')).toBeDisabled();
    expect(await screen.findByTestId('services-load-failed')).toBeInTheDocument();
    expect(screen.getByTestId('task-save-and-continue')).toBeDisabled();
  });

  it('shows a legacy years value when no start date has been recorded', async () => {
    setup(draft(null, 12));
    expect(await screen.findByTestId('experience-years-value')).toHaveTextContent('12');
  });

  it('hydrates a changed authoritative answer while clean', async () => {
    const { client } = setup(draft(since(5)));
    expect(await screen.findByTestId('experience-years-value')).toHaveTextContent('5');
    await act(async () =>
      client.setQueryData(providerQueryKeys.onboarding.draft(), { ...draft(since(9)), version: 4 }),
    );
    await waitFor(() =>
      expect(screen.getByTestId('experience-years-value')).toHaveTextContent('9'),
    );
  });

  it('keeps an edit during a stale read, then hydrates the acknowledged answer', async () => {
    let release!: (value: [number, unknown]) => void;
    mock.onPatch(PATCH_URL).reply(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const { client } = setup(draft(since(5)));
    fireEvent.click(await screen.findByTestId('experience-years-increase'));
    await waitFor(() => expect(mock.history.patch).toHaveLength(1));
    await act(async () =>
      client.setQueryData(providerQueryKeys.onboarding.draft(), { ...draft(since(3)), version: 3 }),
    );
    expect(screen.getByTestId('experience-years-value')).toHaveTextContent('6');
    await act(async () => release([200, { ...draft(since(7)), version: 4 }]));
    await waitFor(() =>
      expect(screen.getByTestId('experience-years-value')).toHaveTextContent('7'),
    );
  });

  it.each(['en', 'ar'] as const)(
    'Save and continue confirms zero experience and waits for acknowledgement (%s)',
    async (lang) => {
      let release!: (value: [number, unknown]) => void;
      mock.onPatch(PATCH_URL).reply(
        () =>
          new Promise((resolve) => {
            release = resolve;
          }),
      );
      const { router } = setup(draft(null), lang);
      expect(await screen.findByTestId('experience-years-value')).toHaveTextContent('0');
      expect(mock.history.patch).toHaveLength(0);
      fireEvent.click(screen.getByTestId('task-save-and-continue'));
      await waitFor(() => expect(mock.history.patch).toHaveLength(1));
      expect(JSON.parse(mock.history.patch[0].data)).toMatchObject({
        professionSince: since(0),
        version: 3,
      });
      expect(router.state.location.pathname).toBe('/provider/onboarding/SERVICES_EXPERIENCE');
      await act(async () => release([200, { ...draft(since(0)), version: 4 }]));
      expect(await screen.findByTestId('next-task')).toBeInTheDocument();
    },
  );

  it('does not replace explicitly selected experience with the zero default', async () => {
    mock
      .onPatch(PATCH_URL)
      .reply((config) => [200, { ...draft(JSON.parse(config.data).professionSince), version: 4 }]);
    setup();
    fireEvent.click(await screen.findByTestId('experience-years-increase'));
    fireEvent.click(screen.getByTestId('experience-years-increase'));
    fireEvent.click(screen.getByTestId('task-save-and-continue'));
    expect(await screen.findByTestId('next-task')).toBeInTheDocument();
    expect(mock.history.patch).toHaveLength(1);
    expect(JSON.parse(mock.history.patch[0].data).professionSince).toBe(since(2));
  });

  it('confirms zero together with a pending transport edit without losing either answer', async () => {
    mock.onPatch(PATCH_URL).reply(200, { ...draft(since(0)), version: 4 });
    setup();
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Car' }));
    fireEvent.click(screen.getByTestId('task-save-and-continue'));
    expect(await screen.findByTestId('next-task')).toBeInTheDocument();
    expect(mock.history.patch).toHaveLength(1);
    expect(JSON.parse(mock.history.patch[0].data)).toMatchObject({
      professionSince: since(0),
      transportModes: ['CAR'],
    });
  });

  it('continues without rewriting an existing legacy answer', async () => {
    setup(draft(null, 12));
    fireEvent.click(await screen.findByTestId('task-save-and-continue'));
    expect(await screen.findByTestId('next-task')).toBeInTheDocument();
    expect(mock.history.patch).toHaveLength(0);
  });

  it('does not create an answer on a read-only application', async () => {
    setup({ ...draft(null), editable: false });
    fireEvent.click(await screen.findByTestId('task-save-and-continue'));
    expect(await screen.findByTestId('next-task')).toBeInTheDocument();
    expect(mock.history.patch).toHaveLength(0);
  });
});
