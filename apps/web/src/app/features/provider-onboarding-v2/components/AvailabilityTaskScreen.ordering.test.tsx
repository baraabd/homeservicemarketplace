import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

// R10 — the working-hours editor against every ordering of "the provider
// applies a week" and "the server answers".
//
// The seeker profile editor lost typed fields to a late refetch (the R05
// baseline repair). This asks the same questions of the schedule editor, with
// each test deciding when each response lands. The schedule's guard is the
// draft VERSION, not a timestamp, and these tests pin that it holds.
//
// The draft query and the serial autosave are real; only HTTP is substituted.

const DRAFT_URL = '/v1/me/provider/onboarding/draft';
const PATCH_URL = '/v1/me/provider/onboarding/steps/AVAILABILITY';

function draft(
  version: number,
  days: number[],
  over: { draftId?: string; start?: number; end?: number } = {},
): ProviderOnboardingDraftView {
  return {
    draftId: over.draftId ?? 'ordering-draft',
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
        startMinute: over.start ?? 540,
        endMinute: over.end ?? 1020,
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

function Probe() {
  const autosave = useOnboardingStepAutosave('AVAILABILITY');
  const query = useOnboardingDraft();
  return (
    <>
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
        <Probe />
      </ProviderOnboardingAutosaveProvider>
    </QueryClientProvider>,
  );
}

const toggle = (day: number) => fireEvent.click(screen.getByTestId(`day-toggle-${day}`));
const apply = () => fireEvent.click(screen.getByTestId('apply-to-selected'));
const pressed = (day: number) =>
  screen.getByTestId(`day-toggle-${day}`).getAttribute('aria-pressed') === 'true';
/** The days the on-screen summary shows working hours for. */
const summaryDays = () =>
  [0, 1, 2, 3, 4, 5, 6].filter(
    (d) => screen.getByTestId(`availability-summary-day-${d}`).querySelector('bdi') !== null,
  );
const state = () => screen.getByTestId('save-state').textContent;
const sent = (index: number) =>
  JSON.parse(String(mock.history.patch[index]!.data)) as {
    version: number;
    availability: { dayOfWeek: number }[];
  };
const settle = () => new Promise((resolve) => setTimeout(resolve, 30));
const refetch = () =>
  act(async () => {
    await client.refetchQueries({ queryKey: providerQueryKeys.onboarding.draft() });
  });

describe('working hours — the applied week belongs to the provider until it is acknowledged', () => {
  it('a late refetch does not replace a week whose save is still in flight', async () => {
    const save = deferred<[number, unknown]>();
    mock.onPatch(PATCH_URL).reply(() => save.promise);
    mount(draft(3, [1]));
    await screen.findByTestId('availability-summary-day-1');

    toggle(2);
    apply();
    await waitFor(() => expect(mock.history.patch).toHaveLength(1));
    expect(sent(0).availability.map((i) => i.dayOfWeek)).toEqual([1, 2]);

    // The server answers a read with a week this browser did not write.
    mock.onGet(DRAFT_URL).reply(200, draft(3, [5]));
    await refetch();
    await settle();
    // The applied week is still on screen, and it is not called saved.
    expect(summaryDays()).toEqual([1, 2]);
    expect(state()).not.toBe('saved');

    save.resolve([200, draft(4, [1, 2])]);
    await waitFor(() => expect(state()).toBe('saved'));
    expect(summaryDays()).toEqual([1, 2]);
    expect(screen.getByTestId('draft-version')).toHaveTextContent('4');
  });

  it('an older answer arriving after the acknowledgement does not restore the old week', async () => {
    mock.onPatch(PATCH_URL).reply(200, draft(4, [1, 2]));
    mount(draft(3, [1]));
    await screen.findByTestId('availability-summary-day-1');

    toggle(2);
    apply();
    await waitFor(() => expect(state()).toBe('saved'));
    expect(screen.getByTestId('draft-version')).toHaveTextContent('4');

    // A read that began before the save lands now, carrying version 3.
    mock.onGet(DRAFT_URL).reply(200, draft(3, [1]));
    await refetch();
    await settle();

    // The version, not the arrival order, decides which week is current.
    expect(screen.getByTestId('draft-version')).toHaveTextContent('4');
    expect(summaryDays()).toEqual([1, 2]);
    expect(pressed(2)).toBe(true);
  });

  it('a week applied while an earlier save is pending is not reported saved by that earlier save', async () => {
    const first = deferred<[number, unknown]>();
    const second = deferred<[number, unknown]>();
    let calls = 0;
    mock.onPatch(PATCH_URL).reply(() => {
      calls += 1;
      return calls === 1 ? first.promise : second.promise;
    });
    mount(draft(3, [1]));
    await screen.findByTestId('availability-summary-day-1');

    toggle(2);
    apply();
    await waitFor(() => expect(mock.history.patch).toHaveLength(1));

    // While that save is in flight the provider applies a different week.
    toggle(4);
    apply();
    expect(summaryDays()).toEqual([1, 2, 4]);

    first.resolve([200, draft(4, [1, 2])]);
    // The first acknowledgement covers [1, 2]. The screen shows [1, 2, 4],
    // which nobody has acknowledged, so it must not say "saved".
    await waitFor(() => expect(mock.history.patch).toHaveLength(2));
    expect(state()).not.toBe('saved');
    expect(summaryDays()).toEqual([1, 2, 4]);
    // The second write carries the version the first acknowledgement returned.
    expect(sent(1).version).toBe(4);
    expect(sent(1).availability.map((i) => i.dayOfWeek)).toEqual([1, 2, 4]);

    second.resolve([200, draft(5, [1, 2, 4])]);
    await waitFor(() => expect(state()).toBe('saved'));
    expect(summaryDays()).toEqual([1, 2, 4]);
  });

  it('a refused stale write is not shown as saved, and the week it would have replaced is not lost on the server', async () => {
    mock.onPatch(PATCH_URL).reply(409, {
      error: { code: 'CONFLICT', details: { expectedVersion: 7, receivedVersion: 3 } },
    });
    mount(draft(3, [1]));
    await screen.findByTestId('availability-summary-day-1');

    toggle(2);
    apply();
    await waitFor(() => expect(state()).toBe('conflict'));
    expect(state()).not.toBe('saved');
    // One attempt only: a conflict is not retried into an overwrite.
    await settle();
    expect(mock.history.patch).toHaveLength(1);
  });

  it('another provider’s application in the same mounted screen shows only that provider’s week', async () => {
    mount(draft(3, [1, 2]));
    await screen.findByTestId('availability-summary-day-1');
    // Unapplied choices by the first provider: a day and a time.
    toggle(5);
    fireEvent.change(screen.getByTestId('bulk-start'), { target: { value: '06:00' } });
    expect(pressed(5)).toBe(true);

    // The cache now holds a different draft: another provider signed in.
    const other = draft(1, [3], { draftId: 'someone-elses-draft', start: 600, end: 900 });
    mock.onGet(DRAFT_URL).reply(200, other);
    await act(async () => {
      client.setQueryData(providerQueryKeys.onboarding.draft(), other);
    });
    await settle();

    expect(summaryDays()).toEqual([3]);
    // None of the first provider's unapplied selection is carried over.
    expect([0, 1, 2, 3, 4, 5, 6].filter(pressed)).toEqual([3]);
    expect((screen.getByTestId('bulk-start') as HTMLInputElement).value).toBe('10:00');

    // And applying now writes the second provider's week at their version.
    mock
      .onPatch(PATCH_URL)
      .reply(200, draft(2, [3], { draftId: 'someone-elses-draft', start: 600, end: 900 }));
    apply();
    await waitFor(() => expect(mock.history.patch).toHaveLength(1));
    expect(sent(0).version).toBe(1);
    expect(sent(0).availability.map((i) => i.dayOfWeek)).toEqual([3]);
  });
});
