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
          <AvailabilityTaskScreen view={view as never} lang={lang} editable={editable} />
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

function selectTime(testId: string, minute: number) {
  fireEvent.change(screen.getByTestId(testId), { target: { value: String(minute) } });
}

// ─────────────────────────────────────────────────────────────────────────────
// THE ACCEPTANCE CRITERION
// ─────────────────────────────────────────────────────────────────────────────

describe('a whole working week in one bulk action', () => {
  it('sets Sunday–Thursday 09:00–17:00 with one preset and one apply', async () => {
    renderScreen();

    fireEvent.click(screen.getByTestId('preset-sun-thu'));
    fireEvent.click(screen.getByTestId('apply-to-selected'));

    const body = await lastPatch();
    expect(body.availability).toEqual([
      { dayOfWeek: 0, startMinute: 540, endMinute: 1020 },
      { dayOfWeek: 1, startMinute: 540, endMinute: 1020 },
      { dayOfWeek: 2, startMinute: 540, endMinute: 1020 },
      { dayOfWeek: 3, startMinute: 540, endMinute: 1020 },
      { dayOfWeek: 4, startMinute: 540, endMinute: 1020 },
    ]);
  });

  it('does Monday–Friday too', async () => {
    renderScreen();
    fireEvent.click(screen.getByTestId('preset-mon-fri'));
    fireEvent.click(screen.getByTestId('apply-to-selected'));

    const body = await lastPatch();
    expect((body.availability as { dayOfWeek: number }[]).map((i) => i.dayOfWeek)).toEqual([
      1, 2, 3, 4, 5,
    ]);
  });

  it('needs no repeated card stack: seven rows, whatever the schedule', () => {
    renderScreen(DRAFT({ data: { availability: weekOf([0, 1, 2, 3, 4]) } }));
    expect(screen.getByTestId('week-summary').querySelectorAll('li')).toHaveLength(7);
  });

  it('sends ONE request carrying the whole week, never one per day', async () => {
    // A partial bulk update cannot exist if there is no request that carries
    // part of the week.
    renderScreen();
    fireEvent.click(screen.getByTestId('preset-sun-thu'));
    fireEvent.click(screen.getByTestId('apply-to-selected'));

    await waitFor(() => expect(mock.history.patch.length).toBe(1));
    const body = JSON.parse(mock.history.patch[0]!.data as string) as Record<string, unknown>;
    expect((body.availability as unknown[]).length).toBe(5);
  });

  it('carries the timezone with the hours, which the server requires', async () => {
    renderScreen();
    fireEvent.click(screen.getByTestId('preset-sun-thu'));
    fireEvent.click(screen.getByTestId('apply-to-selected'));
    expect((await lastPatch()).timezone).toBe('Asia/Damascus');
  });
});

describe('the preset is an offer, not a default', () => {
  it('selects days and applies NOTHING until asked', async () => {
    renderScreen();
    fireEvent.click(screen.getByTestId('preset-sun-thu'));

    expect(screen.getByTestId('day-toggle-1')).toHaveAttribute('aria-pressed', 'true');
    // Nothing saved, and the week is still empty.
    expect(mock.history.patch).toHaveLength(0);
    expect(screen.getByTestId('day-summary-1')).toHaveTextContent(EN.unavailable);
  });

  it('applies nothing on mount', () => {
    renderScreen();
    expect(mock.history.patch).toHaveLength(0);
    expect(screen.getByTestId('week-totals')).toHaveTextContent(EN.summaryEmpty);
  });

  it('cannot apply with no days selected', () => {
    renderScreen();
    expect(screen.getByTestId('apply-to-selected')).toBeDisabled();
    expect(screen.getByTestId('apply-disabled-hint')).toBeInTheDocument();
  });
});

describe('per-day availability', () => {
  it('marks a day unavailable and saves the rest of the week', async () => {
    renderScreen(DRAFT({ data: { availability: weekOf([1, 2, 3]) } }));

    fireEvent.click(screen.getByTestId('day-clear-2'));

    const body = await lastPatch();
    expect((body.availability as { dayOfWeek: number }[]).map((i) => i.dayOfWeek)).toEqual([1, 3]);
    expect(screen.getByTestId('day-row-2')).toHaveAttribute('data-available', 'false');
  });

  it('keeps an unavailable day visible so it can be brought back', () => {
    renderScreen();
    // A day that vanishes when cleared leaves nowhere to tap.
    expect(screen.getByTestId('day-row-5')).toBeInTheDocument();
    expect(screen.getByTestId('day-set-5')).toBeInTheDocument();
  });

  it('brings a day back with the hours currently in the bulk controls', async () => {
    renderScreen();
    selectTime('bulk-start', 600);
    selectTime('bulk-end', 780);
    fireEvent.click(screen.getByTestId('day-set-6'));

    const body = await lastPatch();
    expect(body.availability).toEqual([{ dayOfWeek: 6, startMinute: 600, endMinute: 780 }]);
  });
});

describe('editing one day after a bulk apply', () => {
  it('changes only that day', async () => {
    renderScreen(DRAFT({ data: { availability: weekOf([1, 2, 3]) } }));

    fireEvent.click(screen.getByTestId('day-edit-2'));
    selectTime('day-2-start-0', 600);

    const body = await lastPatch();
    expect(body.availability).toEqual([
      { dayOfWeek: 1, startMinute: 540, endMinute: 1020 },
      { dayOfWeek: 2, startMinute: 600, endMinute: 1020 },
      { dayOfWeek: 3, startMinute: 540, endMinute: 1020 },
    ]);
  });

  it('adds a second period to one day, since the API supports several', async () => {
    renderScreen(DRAFT({ data: { availability: [interval(1, 540, 720)] } }));

    fireEvent.click(screen.getByTestId('day-edit-1'));
    selectTime('bulk-start', 780);
    selectTime('bulk-end', 1020);
    fireEvent.click(screen.getByTestId('day-add-1'));

    const body = await lastPatch();
    expect(body.availability).toEqual([
      { dayOfWeek: 1, startMinute: 540, endMinute: 720 },
      { dayOfWeek: 1, startMinute: 780, endMinute: 1020 },
    ]);
  });

  it('removes one period and leaves the other', async () => {
    renderScreen(
      DRAFT({ data: { availability: [interval(1, 540, 720), interval(1, 780, 1020)] } }),
    );

    fireEvent.click(screen.getByTestId('day-edit-1'));
    fireEvent.click(screen.getByTestId('day-1-remove-0'));

    const body = await lastPatch();
    expect(body.availability).toEqual([{ dayOfWeek: 1, startMinute: 780, endMinute: 1020 }]);
  });

  it('survives a later bulk apply that does not include it', async () => {
    // "Bulk apply, then fix Wednesday" is worthless if the next bulk apply
    // silently clobbers Wednesday.
    renderScreen(DRAFT({ data: { availability: [interval(3, 600, 780)] } }));

    fireEvent.click(screen.getByTestId('day-toggle-1'));
    fireEvent.click(screen.getByTestId('apply-to-selected'));

    const body = await lastPatch();
    expect(body.availability).toEqual([
      { dayOfWeek: 1, startMinute: 540, endMinute: 1020 },
      { dayOfWeek: 3, startMinute: 600, endMinute: 780 },
    ]);
  });
});

describe('states the API cannot persist are unreachable', () => {
  it('offers no end time at or before the start', () => {
    renderScreen();
    selectTime('bulk-start', 600);

    const options = [...screen.getByTestId('bulk-end').querySelectorAll('option')].map((o) =>
      Number(o.value),
    );
    expect(options.every((m) => m > 600)).toBe(true);
  });

  it('moves the end along when the start passes it, rather than inverting', () => {
    renderScreen();
    selectTime('bulk-start', 1200); // past the default 17:00 end
    const end = screen.getByTestId('bulk-end') as HTMLSelectElement;
    expect(Number(end.value)).toBeGreaterThan(1200);
  });

  it('offers midnight as an end, which a clock input cannot express', () => {
    renderScreen();
    selectTime('bulk-start', 1080);
    const options = [...screen.getByTestId('bulk-end').querySelectorAll('option')].map((o) =>
      Number(o.value),
    );
    expect(options).toContain(1440);
  });

  it('refuses an overlapping second period and says how to fix it', async () => {
    renderScreen(DRAFT({ data: { availability: [interval(1, 540, 1020)] } }));

    fireEvent.click(screen.getByTestId('day-edit-1'));
    selectTime('bulk-start', 600);
    selectTime('bulk-end', 1200);
    fireEvent.click(screen.getByTestId('day-add-1'));

    expect(screen.getByTestId('availability-rejected')).toHaveTextContent(EN.rejectedOverlap);
    // And nothing was sent — the refusal is not a save.
    expect(mock.history.patch).toHaveLength(0);
  });

  it('refuses an exact duplicate', async () => {
    renderScreen(DRAFT({ data: { availability: [interval(1, 540, 1020)] } }));
    fireEvent.click(screen.getByTestId('day-edit-1'));
    fireEvent.click(screen.getByTestId('day-add-1'));

    expect(screen.getByTestId('availability-rejected')).toHaveTextContent(EN.rejectedDuplicate);
  });

  it('uses no text input, so no keyboard can cover the last row', () => {
    const { container } = renderScreen(DRAFT({ data: { availability: weekOf([0, 1, 2, 3, 4]) } }));
    expect(container.querySelectorAll('input[type="text"], input[type="time"]')).toHaveLength(0);
  });

  it('leaves room under the last day row', () => {
    renderScreen();
    expect(screen.getByTestId('availability-bottom-spacer')).toBeInTheDocument();
  });
});

describe('the time zone', () => {
  it('states a resolved zone as a city and an offset, never an identifier', () => {
    renderScreen();
    const line = screen.getByTestId('timezone-resolved');
    expect(line).toHaveTextContent('Damascus time (UTC+3)');
    expect(line.textContent).not.toContain('Asia/');
    expect(screen.queryByTestId('timezone-select')).not.toBeInTheDocument();
  });

  it('asks only where the country genuinely spans several zones', () => {
    renderScreen(
      DRAFT({
        data: {
          timezone: null,
          resolvedTimezone: { resolved: null, display: null, needsConfirmation: true },
        },
      }),
    );
    expect(screen.getByTestId('timezone-select')).toBeInTheDocument();
    expect(screen.queryByTestId('timezone-resolved')).not.toBeInTheDocument();
  });

  it('will not save hours until an ambiguous zone is chosen', () => {
    renderScreen(
      DRAFT({
        data: {
          timezone: null,
          resolvedTimezone: { resolved: null, display: null, needsConfirmation: true },
        },
      }),
    );
    fireEvent.click(screen.getByTestId('preset-sun-thu'));
    expect(screen.getByTestId('apply-to-selected')).toBeDisabled();
    expect(screen.getByTestId('timezone-required')).toBeInTheDocument();
  });

  it('re-stamps the existing week when the zone changes', async () => {
    // Leaving old hours on the old zone silently splits one schedule across
    // two, which nothing downstream expects.
    renderScreen(
      DRAFT({
        data: {
          availability: weekOf([1]),
          timezone: null,
          resolvedTimezone: { resolved: null, display: null, needsConfirmation: true },
        },
      }),
    );

    fireEvent.change(screen.getByTestId('timezone-select'), {
      target: { value: 'Europe/Stockholm' },
    });

    const body = await lastPatch();
    expect({ timezone: body.timezone, count: (body.availability as unknown[]).length }).toEqual({
      timezone: 'Europe/Stockholm',
      count: 1,
    });
  });
});

describe('the summary', () => {
  it('is the schedule the server holds, after a reload', () => {
    // The acceptance criterion: persisted schedule equals the visible summary.
    renderScreen(DRAFT({ data: { availability: weekOf([0, 1, 2, 3, 4]) } }));

    for (const day of [0, 1, 2, 3, 4]) {
      expect(screen.getByTestId(`day-summary-${day}`)).toHaveTextContent('09:00–17:00');
    }
    for (const day of [5, 6]) {
      expect(screen.getByTestId(`day-summary-${day}`)).toHaveTextContent(EN.unavailable);
    }
  });

  it('counts days worked and hours, not windows', () => {
    renderScreen(
      DRAFT({ data: { availability: [interval(1, 540, 720), interval(1, 780, 1020)] } }),
    );
    // One day, three hours plus four = seven.
    expect(screen.getByTestId('week-totals')).toHaveTextContent('1 day · 7 hours');
  });

  it('shows a half hour exactly rather than rounding it away', () => {
    renderScreen(DRAFT({ data: { availability: [interval(1, 540, 570)] } }));
    expect(screen.getByTestId('week-totals')).toHaveTextContent('0.5 hours');
  });

  it('renders windows in order however the API returned them', () => {
    renderScreen(
      DRAFT({ data: { availability: [interval(1, 780, 1020), interval(1, 540, 720)] } }),
    );
    expect(screen.getByTestId('day-summary-1')).toHaveTextContent('09:00–12:00, 13:00–17:00');
  });

  it('preserves an off-grid legacy value rather than snapping it', () => {
    // A row saved through the V1 wizard's free time input.
    renderScreen(DRAFT({ data: { availability: [interval(1, 545, 1020)] } }));
    expect(screen.getByTestId('day-summary-1')).toHaveTextContent('09:05–17:00');
  });
});

describe('a locked application', () => {
  it('disables every control rather than hiding the schedule', () => {
    renderScreen(DRAFT({ data: { availability: weekOf([1]) } }), 'en', false);
    expect(screen.getByTestId('day-toggle-1')).toBeDisabled();
    expect(screen.getByTestId('apply-to-selected')).toBeDisabled();
    expect(screen.getByTestId('day-clear-1')).toBeDisabled();
    expect(screen.getByTestId('day-summary-1')).toHaveTextContent('09:00–17:00');
  });
});

describe('Arabic', () => {
  it('renders the schedule and the presets in Arabic', () => {
    renderScreen(DRAFT({ data: { availability: weekOf([0]) } }), 'ar');
    expect(screen.getByTestId('preset-sun-thu')).toHaveTextContent(
      AVAILABILITY_COPY.ar.presetSunThu,
    );
    expect(screen.getByTestId('day-summary-6')).toHaveTextContent(AVAILABILITY_COPY.ar.unavailable);
  });

  it('keeps the times in Latin digits so they match the stored values', () => {
    // The column is minutes; a localised numeral in the summary would not
    // match what the provider sees anywhere else in the app.
    renderScreen(DRAFT({ data: { availability: weekOf([0]) } }), 'ar');
    expect(screen.getByTestId('day-summary-0')).toHaveTextContent('09:00–17:00');
  });
});

describe('saving, and saying so truthfully', () => {
  it('reports a save while it is in flight, then reports it saved', async () => {
    renderScreen();
    fireEvent.click(screen.getByTestId('preset-sun-thu'));
    fireEvent.click(screen.getByTestId('apply-to-selected'));

    await waitFor(() =>
      expect(screen.getByTestId('availability-save-status')).toHaveAttribute(
        'data-status',
        'saved',
      ),
    );
  });

  it('surfaces a CONCURRENCY conflict as a conflict, not as a generic error', async () => {
    // Two tabs, or a phone and a laptop. The provider has to be told the
    // server holds something else, not that the network hiccuped.
    mock.onPatch(PATCH).reply(409, {
      code: 'CONFLICT',
      message: 'stale',
      details: { currentVersion: 9 },
    });

    renderScreen();
    fireEvent.click(screen.getByTestId('preset-mon-fri'));
    fireEvent.click(screen.getByTestId('apply-to-selected'));

    await waitFor(() =>
      expect(screen.getByTestId('availability-save-status')).toHaveAttribute(
        'data-status',
        'conflict',
      ),
    );
    expect(screen.getByTestId('availability-save-status')).toHaveTextContent(EN.saveConflict);
  });

  it('offers a retry when the save simply failed', async () => {
    mock.onPatch(PATCH).reply(500);
    renderScreen();
    fireEvent.click(screen.getByTestId('preset-mon-fri'));
    fireEvent.click(screen.getByTestId('apply-to-selected'));

    await waitFor(() =>
      expect(screen.getByTestId('availability-save-status')).toHaveAttribute(
        'data-status',
        'error',
      ),
    );
    expect(screen.getByTestId('availability-save-retry')).toBeInTheDocument();
  });

  it('re-renders from the SERVER copy when the draft changes underneath it', () => {
    // The conflict resolution path: the query refetches, the view changes,
    // and the editor must show what the server holds rather than merging it
    // into whatever was on screen.
    const { rerender } = renderScreen(DRAFT({ data: { availability: weekOf([1]) } }));
    expect(screen.getByTestId('day-summary-1')).toHaveTextContent('09:00–17:00');

    const server = DRAFT({ version: 9, data: { availability: [interval(1, 600, 780)] } });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(providerQueryKeys.onboarding.draft(), server);
    rerender(
      <MemoryRouter>
        <QueryClientProvider client={client}>
          <LanguageProvider>
            <AvailabilityTaskScreen view={server as never} lang="en" editable />
          </LanguageProvider>
        </QueryClientProvider>
      </MemoryRouter>,
    );
    expect(screen.getByTestId('day-summary-1')).toHaveTextContent('10:00–13:00');
  });
});

describe('an edit made while a save is still in flight', () => {
  it('is not dropped', async () => {
    // The shape a provider hits constantly: bulk apply, then immediately fix
    // one day while the first request is still on the wire.
    let release: (() => void) | null = null;
    mock.onPatch(PATCH).reply(
      () =>
        new Promise((resolve) => {
          release = () => resolve([200, DRAFT()]);
        }),
    );

    renderScreen(DRAFT({ data: { availability: weekOf([1, 2, 3]) } }));

    fireEvent.click(screen.getByTestId('day-clear-3'));
    await waitFor(() => expect(mock.history.patch.length).toBe(1));

    // Second edit, while the first is unresolved.
    fireEvent.click(screen.getByTestId('day-clear-2'));
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
