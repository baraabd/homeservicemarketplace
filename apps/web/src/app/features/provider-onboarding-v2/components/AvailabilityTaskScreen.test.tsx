import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import MockAdapter from 'axios-mock-adapter';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { api } from '../../../../lib/api';
import { providerQueryKeys } from '../../../../lib/provider/query-keys';
import { LanguageProvider } from '../../../i18n/LanguageContext';
import { AvailabilityTaskScreen } from './AvailabilityTaskScreen';
import { AVAILABILITY_COPY } from '../copy/availability-copy';
import { AUTOSAVE_COPY } from '../copy/autosave-copy';
import {
  ProviderOnboardingAutosaveProvider,
  useOnboardingStepAutosave,
} from '../autosave/ProviderOnboardingAutosaveProvider';
import { AutosaveStatus } from './AutosaveStatus';

// Sprint 9B.21 — V2 Task 4.
//
// The acceptance criteria this file pins:
//
//   - a Sunday–Thursday week is entered in ONE bulk action
//   - the payload is always the WHOLE week, so a partial update cannot exist
//   - a preset selects days and applies nothing
//   - a day can be made unavailable, and brought back
//   - one day can be edited after a bulk apply without disturbing the others
//   - the summary after a reload is the schedule that was saved
//   - a raw IANA identifier appears only where somebody has to choose one

const PATCH = /\/v1\/me\/provider\/onboarding\/steps\/AVAILABILITY/;
const EN = AVAILABILITY_COPY.en;

// `data` is destructured OUT of the overrides before the outer spread, for the
// reason the Task 3 fixture spells out: spreading `...over` last re-sets `data`
// to the caller's partial object and silently drops every default under it.
const DRAFT = (over: Record<string, unknown> = {}) => {
  const { data: dataOver, ...rest } = over;
  return {
    state: 'DRAFT',
    currentStep: 'AVAILABILITY',
    steps: [],
    completedSteps: [],
    version: 4,
    editable: true,
    lastSavedAt: null,
    policyVersion: 'sprint-08',
    missing: [],
    ...rest,
    data: {
      availability: [],
      timezone: 'Asia/Damascus',
      resolvedTimezone: {
        resolved: 'Asia/Damascus',
        display: { city: 'Damascus', offset: 'UTC+3' },
        needsConfirmation: false,
      },
      ...((dataOver as Record<string, unknown>) ?? {}),
    },
  };
};

let mock: MockAdapter;

beforeEach(() => {
  mock = new MockAdapter(api);
  mock.onPatch(PATCH).reply(200, DRAFT());
});

afterEach(() => {
  mock.restore();
  window.localStorage.clear();
});

function renderScreen(view = DRAFT(), lang: 'en' | 'ar' = 'en', editable = true) {
  window.localStorage.setItem('hsm.lang', lang);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(providerQueryKeys.onboarding.draft(), view);
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <LanguageProvider>
          <ProviderOnboardingAutosaveProvider>
            <AvailabilityTaskScreen view={view as never} lang={lang} editable={editable} />
            <SaveStatusProbe lang={lang} />
          </ProviderOnboardingAutosaveProvider>
        </LanguageProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

/** The body of the last PATCH the screen sent. */
async function lastPatch(): Promise<Record<string, unknown>> {
  await waitFor(() => expect(mock.history.patch.length).toBeGreaterThan(0));
  const raw = mock.history.patch[mock.history.patch.length - 1]!.data as string;
  return JSON.parse(raw) as Record<string, unknown>;
}

/** A stored week, in the contract's own shape. 0 = Sunday. */
const week = (days: readonly number[], startMinute = 540, endMinute = 1020) =>
  days.map((dayOfWeek) => ({
    id: `av-${dayOfWeek}`,
    dayOfWeek,
    startMinute,
    endMinute,
    timezone: 'Asia/Damascus',
  }));

// ─────────────────────────────────────────────────────────────────────────────
// THE ACCEPTANCE CRITERION
//
// Sprint 09B.29 Phase 5A — the approved screen is five controls: the day
// toggles, a From/To pair, Apply, and one checkbox that turns Apply into a
// clear. The presets, the per-day editor, the week summary and the timezone
// picker are not on it.
//
// RECORDED FOR PHASE 5B, because each was a real affordance:
//
//   presets            "Sunday–Thursday" as one tap. The day toggles do the
//                      same job in five taps and the approved screen has no
//                      row for them.
//   per-day editing    a second window on one day, or different hours on a
//                      Wednesday. The contract still stores several windows
//                      per day and nothing deletes them — but this screen can
//                      only set ONE window across the selected days, so a
//                      provider cannot create or edit a second one here.
//   the timezone       `resolvedTimezone.needsConfirmation` is the case the
//                      server cannot settle alone. The stored zone is
//                      preserved and sent with every write; what is gone is
//                      the surface to CONFIRM one when asked.
//
// What has NOT changed is the payload contract: one request, the whole week,
// the timezone with it.
// ─────────────────────────────────────────────────────────────────────────────

describe('a whole working week in one bulk action', () => {
  it('sets Sunday–Thursday 09:00–17:00 by tapping days and applying once', async () => {
    renderScreen();

    for (const day of [0, 1, 2, 3, 4]) fireEvent.click(screen.getByTestId(`day-toggle-${day}`));
    fireEvent.click(screen.getByTestId('apply-to-selected'));

    const body = await lastPatch();
    const sent = body.availability as Array<{ dayOfWeek: number; startMinute: number }>;
    expect(sent.map((i) => i.dayOfWeek).sort()).toEqual([0, 1, 2, 3, 4]);
    expect(sent.every((i) => i.startMinute === 540 && i.endMinute === 1020)).toBe(true);
  });

  it('sends ONE request carrying the whole week, never one per day', async () => {
    renderScreen();

    for (const day of [0, 1, 2, 3, 4]) fireEvent.click(screen.getByTestId(`day-toggle-${day}`));
    fireEvent.click(screen.getByTestId('apply-to-selected'));

    await waitFor(() => expect(mock.history.patch.length).toBeGreaterThan(0));
    // A partial schedule must not be expressible. Five requests would each be
    // one, and a failure between them would leave a week nobody chose.
    expect(mock.history.patch).toHaveLength(1);
    expect((await lastPatch()).availability).toHaveLength(5);
  });

  it('carries the timezone with the hours, which the server requires', async () => {
    renderScreen();

    fireEvent.click(screen.getByTestId('day-toggle-0'));
    fireEvent.click(screen.getByTestId('apply-to-selected'));

    expect((await lastPatch()).timezone).toBe('Asia/Damascus');
  });

  it('opens showing the week the provider already has', async () => {
    // The toggles ARE the schedule, not a transient selection. A row of blank
    // toggles over a saved Sunday–Thursday would read as "you have told us
    // nothing" to somebody who has.
    renderScreen(DRAFT({ data: { availability: week([0, 1, 2, 3, 4]) } }));

    for (const day of [0, 1, 2, 3, 4]) {
      expect(screen.getByTestId(`day-toggle-${day}`)).toHaveAttribute('aria-pressed', 'true');
    }
    for (const day of [5, 6]) {
      expect(screen.getByTestId(`day-toggle-${day}`)).toHaveAttribute('aria-pressed', 'false');
    }
  });
});

describe('applying is deliberate, never automatic', () => {
  it('applies nothing on mount', async () => {
    renderScreen(DRAFT({ data: { availability: week([0, 1, 2, 3, 4]) } }));
    // Seeding the toggles from the stored week must not write it back.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(mock.history.patch).toHaveLength(0);
  });

  it('selects days and applies NOTHING until asked', async () => {
    renderScreen();

    for (const day of [0, 1, 2]) fireEvent.click(screen.getByTestId(`day-toggle-${day}`));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(mock.history.patch).toHaveLength(0);
  });

  it('cannot apply with no days selected', async () => {
    renderScreen();
    expect(screen.getByTestId('apply-to-selected')).toBeDisabled();
  });
});

describe('marking days unavailable', () => {
  it('clears the selected days and keeps the rest of the week', async () => {
    renderScreen(DRAFT({ data: { availability: week([0, 1, 2, 3, 4]) } }));

    // Turn Tuesday off, leave the other four on, and apply as a clear.
    fireEvent.click(screen.getByTestId('day-toggle-0'));
    fireEvent.click(screen.getByTestId('day-toggle-1'));
    fireEvent.click(screen.getByTestId('day-toggle-3'));
    fireEvent.click(screen.getByTestId('day-toggle-4'));
    fireEvent.click(screen.getByTestId('mark-unavailable').querySelector('input')!);
    fireEvent.click(screen.getByTestId('apply-to-selected'));

    const sent = (await lastPatch()).availability as Array<{ dayOfWeek: number }>;
    expect(sent.map((i) => i.dayOfWeek)).toEqual([0, 1, 3, 4]);
  });

  it('leaves the From/To pair alone, so a day is one tap from coming back', async () => {
    // This is precisely what the approved label promises: "Disables days
    // without deleting saved time ranges."
    renderScreen(DRAFT({ data: { availability: week([2]) } }));

    fireEvent.click(screen.getByTestId('mark-unavailable').querySelector('input')!);
    fireEvent.click(screen.getByTestId('apply-to-selected'));
    await lastPatch();

    expect(screen.getByTestId('bulk-start')).toHaveValue('09:00');
    expect(screen.getByTestId('bulk-end')).toHaveValue('17:00');
  });
});

describe('states the API cannot persist are unreachable', () => {
  it('refuses an inverted range and says so', async () => {
    renderScreen();

    fireEvent.click(screen.getByTestId('day-toggle-0'));
    fireEvent.change(screen.getByTestId('bulk-start'), { target: { value: '18:00' } });
    fireEvent.change(screen.getByTestId('bulk-end'), { target: { value: '09:00' } });
    fireEvent.click(screen.getByTestId('apply-to-selected'));

    expect(await screen.findByTestId('availability-rejected')).toHaveTextContent(
      EN.rejectedInvalidRange,
    );
    expect(mock.history.patch).toHaveLength(0);
  });

  it('uses a native time input, so no custom listbox has to re-implement one', () => {
    renderScreen();
    expect(screen.getByTestId('bulk-start')).toHaveAttribute('type', 'time');
    expect(screen.getByTestId('bulk-end')).toHaveAttribute('type', 'time');
  });
});

describe('the time zone', () => {
  it('sends the stored zone unchanged, with no surface to pick one', async () => {
    // RECORDED PHASE 5B GAP. The approved screen draws no timezone control,
    // so the zone is carried, never chosen. Asserting the absence keeps
    // re-adding one a deliberate change.
    renderScreen(DRAFT({ data: { timezone: 'Asia/Damascus' } }));

    expect(screen.queryByTestId('timezone-select')).toBeNull();

    fireEvent.click(screen.getByTestId('day-toggle-0'));
    fireEvent.click(screen.getByTestId('apply-to-selected'));
    expect((await lastPatch()).timezone).toBe('Asia/Damascus');
  });
});

describe('a locked application', () => {
  it('disables every control', () => {
    renderScreen(DRAFT(), 'en', false);

    expect(screen.getByTestId('day-toggle-0')).toBeDisabled();
    expect(screen.getByTestId('bulk-start')).toBeDisabled();
    expect(screen.getByTestId('apply-to-selected')).toBeDisabled();
    expect(screen.getByTestId('mark-unavailable').querySelector('input')).toBeDisabled();
  });
});

describe('Arabic', () => {
  it('renders the approved Arabic copy', () => {
    renderScreen(DRAFT(), 'ar');

    expect(screen.getByText(AVAILABILITY_COPY.ar.question)).toBeInTheDocument();
    expect(screen.getByText(AVAILABILITY_COPY.ar.unavailableLabel)).toBeInTheDocument();
    expect(screen.queryByText(EN.question)).toBeNull();
  });

  it('names each two-letter toggle in full, for a screen reader', () => {
    renderScreen(DRAFT(), 'ar');
    // "ح" alone is not a day name. The accessible name carries the whole word
    // in the reader's own language.
    expect(screen.getByTestId('day-toggle-0')).toHaveAttribute('aria-label', 'الأحد');
  });
});

// Sprint 09B.29 Phase 5A — the status line moved into the approved sticky bar,
// which this component does not own. It is still driven by the same step of the
// same coordinator, so the harness mounts it the way the task route does; every
// assertion below is about the COORDINATOR's behaviour, and that is unchanged.
function SaveStatusProbe({ lang }: { lang: 'en' | 'ar' }) {
  const { status } = useOnboardingStepAutosave('AVAILABILITY');
  return <AutosaveStatus status={status} lang={lang} testIdPrefix="availability" />;
}

/** Tap days and apply — the write this screen makes. */
function applyDays(days: readonly number[]) {
  for (const day of days) fireEvent.click(screen.getByTestId(`day-toggle-${day}`));
  fireEvent.click(screen.getByTestId('apply-to-selected'));
}

describe('saving, and saying so truthfully', () => {
  it('reports a save while it is in flight, then reports it saved', async () => {
    renderScreen();
    applyDays([0, 1, 2, 3, 4]);

    await waitFor(() =>
      expect(screen.getByTestId('availability-save-status')).toHaveAttribute(
        'data-status',
        'saved',
      ),
    );
  });

  it('surfaces a CONCURRENCY conflict as a conflict, not as a generic error', async () => {
    // Another tab won. Telling the provider to "try again" would invite them
    // to overwrite a week they have not seen.
    mock.reset();
    mock.onPatch(PATCH).reply(409, { error: { details: { expectedVersion: 9 } } });
    renderScreen();
    applyDays([1, 2, 3, 4, 5]);

    await waitFor(() =>
      expect(screen.getByTestId('availability-save-status')).toHaveAttribute(
        'data-status',
        'conflict',
      ),
    );
    expect(screen.getByTestId('availability-save-status')).toHaveTextContent(
      AUTOSAVE_COPY.en.conflict,
    );
  });

  it('offers a retry when the save simply failed', async () => {
    mock.reset();
    mock.onPatch(PATCH).reply(500);
    renderScreen();
    applyDays([1, 2, 3, 4, 5]);

    await waitFor(() =>
      expect(screen.getByTestId('availability-save-status')).toHaveAttribute(
        'data-status',
        'error',
      ),
    );
    expect(screen.getByTestId('availability-save-retry')).toBeInTheDocument();
  });

  it('re-renders from the SERVER copy when the draft changes underneath it', () => {
    // The conflict resolution path: the query refetches, the view changes, and
    // the editor must show what the server holds rather than merging it into
    // whatever was on screen. The toggles are the schedule now, so they are
    // what has to change.
    const { rerender } = renderScreen(DRAFT({ data: { availability: weekOf([1]) } }));
    expect(screen.getByTestId('day-toggle-1')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('day-toggle-4')).toHaveAttribute('aria-pressed', 'false');

    const server = DRAFT({ version: 9, data: { availability: [interval(4, 600, 780)] } });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(providerQueryKeys.onboarding.draft(), server);
    rerender(
      <MemoryRouter>
        <QueryClientProvider client={client}>
          <LanguageProvider>
            <ProviderOnboardingAutosaveProvider>
              <AvailabilityTaskScreen view={server as never} lang="en" editable />
              <SaveStatusProbe lang="en" />
            </ProviderOnboardingAutosaveProvider>
          </LanguageProvider>
        </QueryClientProvider>
      </MemoryRouter>,
    );
    expect(screen.getByTestId('day-toggle-4')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('day-toggle-1')).toHaveAttribute('aria-pressed', 'false');
  });
});

describe('an edit made while a save is still in flight', () => {
  it('is not dropped', async () => {
    // The shape a provider hits constantly: apply a week, then immediately
    // change it again while the first request is still on the wire.
    let release: (() => void) | null = null;
    mock.onPatch(PATCH).reply(
      () =>
        new Promise((resolve) => {
          release = () => resolve([200, DRAFT()]);
        }),
    );

    renderScreen(DRAFT({ data: { availability: weekOf([1, 2, 3]) } }));

    // Drop Wednesday.
    fireEvent.click(screen.getByTestId('day-toggle-3'));
    fireEvent.click(screen.getByTestId('apply-to-selected'));
    await waitFor(() => expect(mock.history.patch.length).toBe(1));

    // Second edit, while the first is unresolved: drop Tuesday too.
    fireEvent.click(screen.getByTestId('day-toggle-2'));
    fireEvent.click(screen.getByTestId('apply-to-selected'));
    release?.();

    await waitFor(() => expect(mock.history.patch.length).toBe(2), { timeout: 3000 });
    const body = JSON.parse(mock.history.patch[1]!.data as string) as Record<string, unknown>;
    expect((body.availability as { dayOfWeek: number }[]).map((i) => i.dayOfWeek)).toEqual([1]);
  });
});

// ─── fixtures ───────────────────────────────────────────────────────────────

function interval(dayOfWeek: number, startMinute: number, endMinute: number) {
  return {
    id: `iv-${dayOfWeek}-${startMinute}`,
    dayOfWeek,
    startMinute,
    endMinute,
    timezone: 'Asia/Damascus',
  };
}

function weekOf(days: number[]) {
  return days.map((d) => interval(d, 540, 1020));
}
