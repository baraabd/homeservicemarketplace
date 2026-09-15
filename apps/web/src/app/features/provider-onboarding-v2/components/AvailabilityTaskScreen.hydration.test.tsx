import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import MockAdapter from 'axios-mock-adapter';
import type { ProviderOnboardingDraftView } from '@homeservicemarketplace/contracts';

import { api } from '../../../../lib/api';
import { providerQueryKeys } from '../../../../lib/provider/query-keys';
import { useOnboardingDraft } from '../../../hooks/provider/useProviderOnboarding';
import {
  ProviderOnboardingAutosaveProvider,
  useOnboardingStepAutosave,
} from '../autosave/ProviderOnboardingAutosaveProvider';
import { AvailabilityTask } from './AvailabilityTaskScreen';
import { AVAILABILITY_COPY } from '../copy/availability-copy';

const DRAFT_URL = '/v1/me/provider/onboarding/draft';
const PATCH_URL = '/v1/me/provider/onboarding/steps/AVAILABILITY';

function draft(version: number, days: number[]): ProviderOnboardingDraftView {
  return {
    draftId: 'availability-hydration-draft',
    version,
    editable: true,
    data: {
      timezone: 'Asia/Damascus',
      resolvedTimezone: {
        resolved: 'Asia/Damascus',
        display: { city: 'Damascus', offset: 'UTC+3' },
        needsConfirmation: false,
      },
      availability: days.map((dayOfWeek) => ({
        id: `availability-${dayOfWeek}`,
        dayOfWeek,
        startMinute: 540,
        endMinute: 1020,
        timezone: 'Asia/Damascus',
      })),
    },
  } as ProviderOnboardingDraftView;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

let mock: MockAdapter;
let client: QueryClient;

beforeEach(() => {
  mock = new MockAdapter(api);
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } },
  });
});

afterEach(() => {
  mock.restore();
  client.clear();
});

function SaveProbe() {
  const autosave = useOnboardingStepAutosave('AVAILABILITY');
  const query = useOnboardingDraft();
  return (
    <>
      <button type="button" onClick={() => void autosave.flushAll()}>
        Flush saves
      </button>
      <output data-testid="save-state">{autosave.status.kind}</output>
      <output data-testid="draft-version">{query.data?.version}</output>
    </>
  );
}

function mount(initial: ProviderOnboardingDraftView) {
  client.setQueryData(providerQueryKeys.onboarding.draft(), initial);
  mock.onGet(DRAFT_URL).reply(200, initial);
  return render(
    <QueryClientProvider client={client}>
      <ProviderOnboardingAutosaveProvider>
        <AvailabilityTask lang="en" />
        <SaveProbe />
      </ProviderOnboardingAutosaveProvider>
    </QueryClientProvider>,
  );
}

const toggleDay = (day: number) => fireEvent.click(screen.getByTestId(`day-toggle-${day}`));
const apply = () => fireEvent.click(screen.getByTestId('apply-to-selected'));
const flush = () => fireEvent.click(screen.getByRole('button', { name: 'Flush saves' }));
const sentDays = (index: number) =>
  (JSON.parse(String(mock.history.patch[index]!.data)).availability as { dayOfWeek: number }[]).map(
    ({ dayOfWeek }) => dayOfWeek,
  );

describe('availability hydration through the real draft query and serial autosave', () => {
  it.each(['apply', 'clear'] as const)(
    'keeps a newer week through the previous acknowledgement and the next %s',
    async (action) => {
      const first = deferred<ProviderOnboardingDraftView>();
      const second = deferred<ProviderOnboardingDraftView>();
      mock.onPatch(PATCH_URL).replyOnce(async () => [200, await first.promise]);
      mock.onPatch(PATCH_URL).replyOnce(async () => [200, await second.promise]);
      mock.onPatch(PATCH_URL).reply(200, draft(7, action === 'apply' ? [1, 4] : []));
      mount(draft(4, [1, 2, 3]));

      toggleDay(3);
      apply();
      flush();
      await waitFor(() => expect(mock.history.patch).toHaveLength(1));
      expect(sentDays(0)).toEqual([1, 2]);

      toggleDay(2);
      apply();
      await act(async () => first.resolve(draft(5, [1, 2])));
      await waitFor(() => expect(mock.history.patch).toHaveLength(2));
      expect(sentDays(1)).toEqual([1]);
      await waitFor(() => expect(screen.getByTestId('draft-version')).toHaveTextContent('5'));

      // The old acknowledgement must not restore Tuesday, either in the day
      // selection or in the week used by "Unavailable on selected days".
      expect(screen.getByTestId('day-toggle-2')).toHaveAttribute('aria-pressed', 'false');
      if (action === 'apply') {
        toggleDay(4);
      } else {
        fireEvent.click(screen.getByTestId('mark-unavailable').querySelector('input')!);
      }
      apply();
      await act(async () => second.resolve(draft(6, [1])));
      await waitFor(() => expect(mock.history.patch).toHaveLength(3));

      expect(sentDays(2)).toEqual(action === 'apply' ? [1, 4] : []);
      expect(mock.history.patch.map((request) => JSON.parse(String(request.data)).version)).toEqual(
        [4, 5, 6],
      );
      await waitFor(() => expect(screen.getByTestId('save-state')).toHaveTextContent('saved'));
    },
  );

  it('hydrates the acknowledged week after a server copy was held while saving', async () => {
    const response = deferred<ProviderOnboardingDraftView>();
    const saved = draft(5, [2]);
    mock.onPatch(PATCH_URL).reply(async () => [200, await response.promise]);
    mount(draft(4, [1, 2]));

    toggleDay(2);
    fireEvent.click(screen.getByTestId('mark-unavailable').querySelector('input')!);
    apply();
    flush();
    await waitFor(() => expect(mock.history.patch).toHaveLength(1));

    // A read can see the committed server answer before PATCH finishes. The
    // same object remains current when the coordinator acknowledges the save.
    act(() => client.setQueryData(providerQueryKeys.onboarding.draft(), saved));
    await waitFor(() => expect(screen.getByTestId('draft-version')).toHaveTextContent('5'));
    expect(screen.getByTestId('save-state')).toHaveTextContent('saving');
    expect(screen.getByTestId('day-toggle-1')).toHaveAttribute('aria-pressed', 'true');

    await act(async () => response.resolve(saved));
    await waitFor(() => expect(screen.getByTestId('save-state')).toHaveTextContent('saved'));
    expect(screen.getByTestId('day-toggle-1')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('day-toggle-2')).toHaveAttribute('aria-pressed', 'true');
  });

  it('preserves days selected for the next Apply when the previous save finishes', async () => {
    const response = deferred<ProviderOnboardingDraftView>();
    mock.onPatch(PATCH_URL).replyOnce(async () => [200, await response.promise]);
    mock.onPatch(PATCH_URL).reply(200, draft(6, [1]));
    mount(draft(4, [1, 2, 3]));

    toggleDay(3);
    apply();
    flush();
    await waitFor(() => expect(mock.history.patch).toHaveLength(1));
    toggleDay(2);

    await act(async () => response.resolve(draft(5, [1, 2])));
    await waitFor(() => expect(screen.getByTestId('save-state')).toHaveTextContent('saved'));
    expect(screen.getByTestId('day-toggle-2')).toHaveAttribute('aria-pressed', 'false');
    expect(mock.history.patch).toHaveLength(1);

    apply();
    flush();
    await waitFor(() => expect(mock.history.patch).toHaveLength(2));
    expect(sentDays(1)).toEqual([1]);
    await waitFor(() => expect(screen.getByTestId('save-state')).toHaveTextContent('saved'));
  });

  it('preserves unapplied selections across a refetch without saving them automatically', async () => {
    const initial = draft(4, [1]);
    mount(initial);
    toggleDay(2);
    fireEvent.change(screen.getByTestId('bulk-start'), { target: { value: '10:00' } });

    mock.onGet(DRAFT_URL).reply(200, draft(5, [1]));
    await act(async () => {
      await client.refetchQueries({ queryKey: providerQueryKeys.onboarding.draft() });
    });
    await waitFor(() => expect(screen.getByTestId('draft-version')).toHaveTextContent('5'));

    expect(screen.getByTestId('day-toggle-2')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('bulk-start')).toHaveValue('10:00');
    expect(mock.history.patch).toHaveLength(0);
  });

  it.each(['cancelled', 'invalid'] as const)(
    'retains the day selection when Apply is %s, even across a refetch',
    async (outcome) => {
      const savedDays = outcome === 'cancelled' ? [1] : [];
      mount(draft(4, savedDays));
      toggleDay(2);
      fireEvent.change(screen.getByTestId('bulk-start'), {
        target: { value: outcome === 'cancelled' ? '10:00' : '18:00' },
      });
      apply();
      if (outcome === 'cancelled') {
        fireEvent.click(screen.getByTestId('apply-discards-cancel'));
      } else {
        expect(screen.getByTestId('availability-rejected')).toBeInTheDocument();
      }

      mock.onGet(DRAFT_URL).reply(200, draft(5, savedDays));
      await act(async () => {
        await client.refetchQueries({ queryKey: providerQueryKeys.onboarding.draft() });
      });
      await waitFor(() => expect(screen.getByTestId('draft-version')).toHaveTextContent('5'));

      expect(screen.getByTestId('day-toggle-2')).toHaveAttribute('aria-pressed', 'true');
      expect(mock.history.patch).toHaveLength(0);
    },
  );
});

describe('visible applied schedule and honest acknowledgement', () => {
  it('shows applied hours while pending and confirms only after the server responds, then hydrates them on return', async () => {
    const response = deferred<ProviderOnboardingDraftView>();
    const saved = draft(5, [1, 2]);
    saved.data.availability = saved.data.availability.map((interval) => ({
      ...interval,
      startMinute: 615,
      endMinute: 1125,
    }));
    mock.onPatch(PATCH_URL).replyOnce(async () => [200, await response.promise]);
    const mounted = mount(draft(4, []));
    toggleDay(1);
    toggleDay(2);
    fireEvent.change(screen.getByTestId('bulk-start'), { target: { value: '10:15' } });
    fireEvent.change(screen.getByTestId('bulk-end'), { target: { value: '18:45' } });
    apply();
    await waitFor(() => expect(mock.history.patch).toHaveLength(1));

    expect(screen.getByTestId('availability-apply-feedback')).toHaveAttribute(
      'data-state',
      'saving',
    );
    expect(screen.getByTestId('availability-apply-feedback')).toHaveTextContent(
      AVAILABILITY_COPY.en.appliedSaving,
    );
    expect(screen.queryByText(AVAILABILITY_COPY.en.appliedSaved)).toBeNull();
    expect(screen.getByTestId('availability-summary-day-1')).toHaveTextContent('10:15–18:45');
    expect(screen.getByTestId('availability-summary-day-3')).toHaveTextContent('Unavailable');

    await act(async () => response.resolve(saved));
    await waitFor(() =>
      expect(screen.getByTestId('availability-apply-feedback')).toHaveAttribute(
        'data-state',
        'saved',
      ),
    );
    expect(
      within(screen.getByTestId('availability-apply-feedback')).getByRole('status'),
    ).toHaveTextContent(AVAILABILITY_COPY.en.appliedSaved);
    expect(screen.getByTestId('availability-week-summary')).toHaveTextContent(
      '2 days · 17 hours a week',
    );
    mounted.unmount();
    client.clear();
    mount(saved);
    expect(screen.getByTestId('bulk-start')).toHaveValue('10:15');
    expect(screen.getByTestId('bulk-end')).toHaveValue('18:45');
    expect(screen.getByTestId('availability-summary-day-2')).toHaveTextContent('10:15–18:45');
    expect(mock.history.patch).toHaveLength(1);
  });

  it('keeps failed applied hours visible as unsaved and retries through the existing writer', async () => {
    mock.onPatch(PATCH_URL).replyOnce(500);
    mock.onPatch(PATCH_URL).reply(200, draft(5, [1]));
    mount(draft(4, []));
    toggleDay(1);
    apply();
    await waitFor(() =>
      expect(screen.getByTestId('availability-apply-feedback')).toHaveAttribute(
        'data-state',
        'error',
      ),
    );
    expect(screen.getByRole('alert')).toHaveTextContent(AVAILABILITY_COPY.en.appliedFailed);
    expect(screen.getByRole('alert')).toHaveTextContent(AVAILABILITY_COPY.en.summaryPending);
    expect(screen.queryByText(AVAILABILITY_COPY.en.appliedSaved)).toBeNull();
    expect(screen.getByTestId('availability-summary-day-1')).toHaveTextContent('09:00–17:00');
    fireEvent.click(screen.getByTestId('availability-apply-retry'));
    await waitFor(() =>
      expect(screen.getByTestId('availability-apply-feedback')).toHaveAttribute(
        'data-state',
        'saved',
      ),
    );
    expect(mock.history.patch).toHaveLength(2);
    expect(sentDays(1)).toEqual([1]);
  });

  it('retains time-only unapplied edits across a refetch and keeps the applied summary unchanged', async () => {
    mount(draft(4, [1]));
    fireEvent.change(screen.getByTestId('bulk-start'), { target: { value: '10:30' } });
    mock.onGet(DRAFT_URL).reply(200, draft(5, [1]));
    await act(async () => {
      await client.refetchQueries({ queryKey: providerQueryKeys.onboarding.draft() });
    });
    expect(screen.getByTestId('bulk-start')).toHaveValue('10:30');
    expect(screen.getByTestId('availability-summary-day-1')).toHaveTextContent('09:00–17:00');
    expect(screen.getByTestId('availability-unapplied')).toHaveTextContent(
      AVAILABILITY_COPY.en.unappliedChanges,
    );
    expect(mock.history.patch).toHaveLength(0);
  });
});
