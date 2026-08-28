import { expect, test, type Page } from '@playwright/test';

import { expectNoHorizontalPageOverflow, seedLanguage, stubApi } from './fixtures';

// Sprint 9B.21 — V2 Task 4 in a real browser.
//
// The component suite covers behaviour against a DOM shim and the integration
// suite covers persistence against a real Postgres. This layer exists for what
// neither can do:
//
//   1. MEASURE. No horizontal overflow at 320px, 44x44 targets, and — the
//      thing the brief names — the last schedule row still reachable with the
//      page scrolled to the bottom.
//   2. DRIVE THE REAL CONTROLS. A native <select> in a real engine, under RTL,
//      with a real tap.

const FLAG_KEY = 'hsm.ff.providerOnboardingV2';

const PROVIDER_ME = {
  id: 'u-provider',
  email: 'provider@example.com',
  firstName: 'Pat',
  lastName: 'Provider',
  status: 'ACTIVE',
  emailVerifiedAt: '2026-08-01T00:00:00.000Z',
  mfaEnabled: false,
  roles: ['customer', 'provider'],
};

const HUB = {
  tasks: [
    {
      id: 'WORKING_HOURS',
      group: 'COVERAGE',
      status: 'AVAILABLE',
      title: 'ساعات العمل',
      description: 'متى يمكنك قبول الأعمال',
    },
  ],
  progress: { complete: 0, total: 6 },
  nextAction: { kind: 'COMPLETE_TASK', taskId: 'WORKING_HOURS' },
  status: 'DRAFT',
};

const draft = (over: Record<string, unknown> = {}) => ({
  state: 'DRAFT',
  currentStep: 'AVAILABILITY',
  steps: [],
  completedSteps: [],
  percentComplete: 0,
  complete: false,
  missing: [],
  version: 4,
  policyVersion: 'sprint-08',
  lastSavedAt: null,
  editable: true,
  ...over,
  data: {
    availability: [],
    timezone: 'Asia/Damascus',
    resolvedTimezone: {
      resolved: 'Asia/Damascus',
      display: { city: 'Damascus', offset: 'UTC+3' },
      needsConfirmation: false,
    },
    ...((over.data as Record<string, unknown>) ?? {}),
  },
});

interface Recorded {
  patches: Array<Record<string, unknown>>;
}

async function openTask(
  page: Page,
  options: { lang?: 'en' | 'ar'; draftOver?: Record<string, unknown>; patchStatus?: number } = {},
): Promise<Recorded> {
  const recorded: Recorded = { patches: [] };

  await page.addInitScript(
    ([key, value]) => window.localStorage.setItem(key as string, value as string),
    [FLAG_KEY, 'true'],
  );
  await seedLanguage(page, options.lang ?? 'en');

  await stubApi(page, {
    me: PROVIDER_ME,
    extra: { '/me/provider/onboarding/hub': HUB },
  });

  // Registered AFTER stubApi so it wins the match — page.route consults the
  // most recently added pattern first.
  await page.route('**/v1/me/provider/onboarding/**', async (route) => {
    const url = route.request().url();
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

    if (url.includes('/onboarding/hub')) return json(HUB);
    if (url.includes('/onboarding/steps/')) {
      const body = JSON.parse(route.request().postData() ?? '{}') as Record<string, unknown>;
      recorded.patches.push(body);
      if (options.patchStatus === 409) {
        return json({ code: 'CONFLICT', message: 'stale', details: { currentVersion: 9 } }, 409);
      }
      // Echo the saved week back, which is what a reload would return.
      return json(
        draft({
          ...options.draftOver,
          version: 5,
          data: {
            ...((options.draftOver?.data as Record<string, unknown>) ?? {}),
            availability: ((body.availability as Array<Record<string, unknown>>) ?? []).map(
              (i, index) => ({ ...i, id: `iv-${index}`, timezone: 'Asia/Damascus' }),
            ),
          },
        }),
      );
    }
    return json(draft(options.draftOver));
  });

  await page.goto('/provider/onboarding/WORKING_HOURS');
  await expect(page.getByTestId('availability-task')).toBeVisible();
  return recorded;
}

// ─────────────────────────────────────────────────────────────────────────────

test.describe('Task 4 — a working week in one action', () => {
  test('sets Sunday–Thursday with a preset, hours, and one apply', async ({ page }) => {
    const recorded = await openTask(page);

    await page.getByTestId('preset-sun-thu').click();
    await page.getByTestId('bulk-start').selectOption('540');
    await page.getByTestId('bulk-end').selectOption('1020');
    await page.getByTestId('apply-to-selected').click();

    // The summary is the schedule, immediately.
    for (const day of [0, 1, 2, 3, 4]) {
      await expect(page.getByTestId(`day-summary-${day}`)).toHaveText('09:00–17:00');
    }
    await expect(page.getByTestId('day-summary-5')).toHaveText('Unavailable');

    await expect
      .poll(() => recorded.patches.length, { message: 'one PATCH for the whole week' })
      .toBe(1);
    expect((recorded.patches[0]!.availability as unknown[]).length).toBe(5);
  });

  test('needs no repeated card stack — seven rows, whatever the schedule', async ({ page }) => {
    await openTask(page);
    await page.getByTestId('preset-sun-thu').click();
    await page.getByTestId('apply-to-selected').click();
    await expect(page.getByTestId('week-summary').locator('li')).toHaveCount(7);
  });

  test('the preset selects days and saves nothing on its own', async ({ page }) => {
    const recorded = await openTask(page);
    await page.getByTestId('preset-mon-fri').click();

    await expect(page.getByTestId('day-toggle-1')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('day-summary-1')).toHaveText('Unavailable');
    expect(recorded.patches).toHaveLength(0);
  });
});

test.describe('Task 4 — the schedule survives a reload', () => {
  test('renders what the server holds', async ({ page }) => {
    await openTask(page, {
      draftOver: {
        data: {
          availability: [
            { id: 'a', dayOfWeek: 1, startMinute: 540, endMinute: 720, timezone: 'Asia/Damascus' },
            { id: 'b', dayOfWeek: 1, startMinute: 780, endMinute: 1020, timezone: 'Asia/Damascus' },
            { id: 'c', dayOfWeek: 4, startMinute: 600, endMinute: 900, timezone: 'Asia/Damascus' },
          ],
        },
      },
    });

    await expect(page.getByTestId('day-summary-1')).toHaveText('09:00–12:00, 13:00–17:00');
    await expect(page.getByTestId('day-summary-4')).toHaveText('10:00–15:00');
    await expect(page.getByTestId('week-totals')).toContainText('2 days');
  });
});

test.describe('Task 4 — per-day control', () => {
  test('marks a day unavailable and brings it back', async ({ page }) => {
    await openTask(page, {
      draftOver: {
        data: {
          availability: [
            { id: 'a', dayOfWeek: 2, startMinute: 540, endMinute: 1020, timezone: 'Asia/Damascus' },
          ],
        },
      },
    });

    await page.getByTestId('day-clear-2').click();
    await expect(page.getByTestId('day-row-2')).toHaveAttribute('data-available', 'false');

    await page.getByTestId('day-set-2').click();
    await expect(page.getByTestId('day-row-2')).toHaveAttribute('data-available', 'true');
  });

  test('edits one day after a bulk apply without disturbing the others', async ({ page }) => {
    const recorded = await openTask(page);

    await page.getByTestId('preset-mon-fri').click();
    await page.getByTestId('apply-to-selected').click();
    await expect(page.getByTestId('day-summary-3')).toHaveText('09:00–17:00');

    await page.getByTestId('day-edit-3').click();
    await page.getByTestId('day-3-start-0').selectOption('600');

    await expect(page.getByTestId('day-summary-3')).toHaveText('10:00–17:00');
    await expect(page.getByTestId('day-summary-2')).toHaveText('09:00–17:00');

    // The COUNT is not the property. The autosave debounce legitimately
    // coalesces a bulk apply and an immediate per-day fix into one request —
    // which is better than two, and asserting on two would be asserting on the
    // debounce rather than on the schedule. What must be true is that the last
    // thing sent is the whole corrected week.
    await expect
      .poll(() => recorded.patches[recorded.patches.length - 1]?.availability)
      .toEqual([
        { dayOfWeek: 1, startMinute: 540, endMinute: 1020 },
        { dayOfWeek: 2, startMinute: 540, endMinute: 1020 },
        { dayOfWeek: 3, startMinute: 600, endMinute: 1020 },
        { dayOfWeek: 4, startMinute: 540, endMinute: 1020 },
        { dayOfWeek: 5, startMinute: 540, endMinute: 1020 },
      ]);
  });
});

test.describe('Task 4 — invalid schedules cannot be built', () => {
  test('the end control offers nothing at or before the start', async ({ page }) => {
    await openTask(page);
    await page.getByTestId('bulk-start').selectOption('720');

    const values = await page
      .getByTestId('bulk-end')
      .locator('option')
      .evaluateAll((nodes) => nodes.map((n) => Number((n as HTMLOptionElement).value)));
    expect(values.every((v) => v > 720)).toBe(true);
  });

  test('refuses an overlapping second period rather than saving it', async ({ page }) => {
    await openTask(page, {
      draftOver: {
        data: {
          availability: [
            { id: 'a', dayOfWeek: 1, startMinute: 540, endMinute: 1020, timezone: 'Asia/Damascus' },
          ],
        },
      },
    });

    await page.getByTestId('day-edit-1').click();
    await page.getByTestId('bulk-start').selectOption('600');
    await page.getByTestId('bulk-end').selectOption('1200');
    await page.getByTestId('day-add-1').click();

    await expect(page.getByTestId('availability-rejected')).toBeVisible();
    await expect(page.getByTestId('day-summary-1')).toHaveText('09:00–17:00');
  });
});

test.describe('Task 4 — the time zone', () => {
  test('says a city and an offset, never an identifier', async ({ page }) => {
    await openTask(page);
    const line = page.getByTestId('timezone-resolved');
    await expect(line).toContainText('Damascus time (UTC+3)');
    await expect(line).not.toContainText('Asia/');
  });

  test('asks only where the country spans several zones', async ({ page }) => {
    await openTask(page, {
      draftOver: {
        data: {
          timezone: null,
          resolvedTimezone: { resolved: null, display: null, needsConfirmation: true },
        },
      },
    });
    await expect(page.getByTestId('timezone-select')).toBeVisible();
    await expect(page.getByTestId('apply-to-selected')).toBeDisabled();
  });
});

test.describe('Task 4 — a save that loses a race', () => {
  test('is reported as a conflict, not as a generic failure', async ({ page }) => {
    await openTask(page, { patchStatus: 409 });

    await page.getByTestId('preset-sun-thu').click();
    await page.getByTestId('apply-to-selected').click();

    await expect(page.getByTestId('availability-save-status')).toHaveAttribute(
      'data-status',
      'conflict',
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GEOMETRY — the half a DOM shim cannot answer.
// ─────────────────────────────────────────────────────────────────────────────

for (const width of [320, 430]) {
  test.describe(`Task 4 — geometry at ${width}px`, () => {
    test.skip(
      ({ viewport }) => (viewport?.width ?? 0) > 500,
      'the provider app is a phone surface',
    );

    test('no horizontal overflow, and every control is at least 44x44', async ({ page }) => {
      await page.setViewportSize({ width, height: 780 });
      await openTask(page, {
        draftOver: {
          data: {
            availability: [0, 1, 2, 3, 4, 5, 6].map((d) => ({
              id: `a${d}`,
              dayOfWeek: d,
              startMinute: 540,
              endMinute: 1020,
              timezone: 'Asia/Damascus',
            })),
          },
        },
      });

      await expectNoHorizontalPageOverflow(page);

      // Seven day toggles plus the seven per-day controls: the densest row in
      // the screen at the narrowest width it has to work at.
      for (const testId of [
        'day-toggle-0',
        'day-toggle-6',
        'preset-sun-thu',
        'apply-to-selected',
        'day-clear-6',
        'day-edit-6',
      ]) {
        const box = await page.getByTestId(testId).boundingBox();
        expect({ testId, ok: (box?.height ?? 0) >= 44 && (box?.width ?? 0) >= 44 }).toEqual({
          testId,
          ok: true,
        });
      }
    });

    test('the LAST day row is reachable, not trapped under the bottom edge', async ({ page }) => {
      // The brief's requirement, measured rather than asserted. Saturday is the
      // last row, and it is the one a sticky action or a raised keyboard would
      // cover.
      await page.setViewportSize({ width, height: 640 });
      await openTask(page, {
        draftOver: {
          data: {
            availability: [0, 1, 2, 3, 4, 5, 6].map((d) => ({
              id: `a${d}`,
              dayOfWeek: d,
              startMinute: 540,
              endMinute: 1020,
              timezone: 'Asia/Damascus',
            })),
          },
        },
      });

      const last = page.getByTestId('day-row-6');
      await last.scrollIntoViewIfNeeded();
      await expect(last).toBeInViewport();

      // And it is not merely visible — its control is hittable, which is the
      // property that fails when something floats over it.
      await page.getByTestId('day-clear-6').click();
      await expect(page.getByTestId('day-row-6')).toHaveAttribute('data-available', 'false');
    });

    test('this screen raises no keyboard, because it has no text input', async ({ page }) => {
      await page.setViewportSize({ width, height: 640 });
      await openTask(page);
      expect(await page.locator('input[type="text"], input[type="time"], textarea').count()).toBe(
        0,
      );
    });
  });
}

test.describe('Task 4 — Arabic', () => {
  test('renders the week in Arabic with the times unchanged', async ({ page }) => {
    await openTask(page, {
      lang: 'ar',
      draftOver: {
        data: {
          availability: [
            { id: 'a', dayOfWeek: 0, startMinute: 540, endMinute: 1020, timezone: 'Asia/Damascus' },
          ],
        },
      },
    });

    await expect(page.getByTestId('preset-sun-thu')).toContainText('الأحد');
    await expect(page.getByTestId('day-summary-0')).toHaveText('09:00–17:00');
    await expect(page.getByTestId('day-summary-6')).toHaveText('غير متاح');
  });

  test('does not overflow sideways under RTL at 320px', async ({ page, viewport }) => {
    test.skip((viewport?.width ?? 0) > 500, 'the provider app is a phone surface');
    await page.setViewportSize({ width: 320, height: 780 });
    await openTask(page, { lang: 'ar' });
    await expectNoHorizontalPageOverflow(page);
  });
});
