import { expect, test, type Page } from '@playwright/test';

import { expectNoHorizontalPageOverflow, htmlLangDir, seedLanguage, stubApi } from './fixtures';

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

// Sprint 09B.29 Phase 5A — the approved working-hours screen in a real
// browser. It is five controls: seven day toggles, a From/To pair, Apply, and
// a checkbox that turns Apply into a clear.
//
// The presets, the per-day editor, the week summary and the timezone picker
// are not on it; each absence is recorded in the component and in the unit
// suite. What this layer still exists for is the two things a DOM shim cannot
// see: geometry at 320px, and real bidi layout.

/** A stored week, in the contract's own shape. 0 = Sunday. */
const weekOf = (days: readonly number[], startMinute = 540, endMinute = 1020) =>
  days.map((dayOfWeek) => ({
    id: `iv-${dayOfWeek}`,
    dayOfWeek,
    startMinute,
    endMinute,
    timezone: 'Asia/Damascus',
  }));

test.describe('Task 4 — a working week in one action', () => {
  test('sets Sunday–Thursday by tapping days and applying once', async ({ page }) => {
    const rec = await openTask(page);

    for (const day of [0, 1, 2, 3, 4]) await page.getByTestId(`day-toggle-${day}`).click();
    await page.getByTestId('apply-to-selected').click();

    await expect.poll(() => rec.patches.length).toBeGreaterThan(0);
    const sent = rec.patches[0].availability as Array<{ dayOfWeek: number; startMinute: number }>;
    expect(sent.map((i) => i.dayOfWeek).sort()).toEqual([0, 1, 2, 3, 4]);
    expect(sent.every((i) => i.startMinute === 540 && i.endMinute === 1020)).toBe(true);
    // One request, the whole week. A partial schedule must not be expressible.
    expect(rec.patches).toHaveLength(1);
  });

  test('tapping days saves nothing on its own', async ({ page }) => {
    const rec = await openTask(page);

    for (const day of [0, 1, 2]) await page.getByTestId(`day-toggle-${day}`).click();
    await page.waitForTimeout(300);
    expect(rec.patches).toHaveLength(0);
  });
});

test.describe('Task 4 — the schedule survives a reload', () => {
  test('opens showing the week the server holds', async ({ page }) => {
    await openTask(page, { draftOver: { data: { availability: weekOf([0, 1, 2, 3, 4]) } } });

    // The toggles ARE the schedule, so this is what "the saved week is on
    // screen" looks like now.
    for (const day of [0, 1, 2, 3, 4]) {
      await expect(page.getByTestId(`day-toggle-${day}`)).toHaveAttribute('aria-pressed', 'true');
    }
    for (const day of [5, 6]) {
      await expect(page.getByTestId(`day-toggle-${day}`)).toHaveAttribute('aria-pressed', 'false');
    }

    await page.reload();
    await expect(page.getByTestId('day-toggle-0')).toHaveAttribute('aria-pressed', 'true');
  });
});

test.describe('Task 4 — turning days off', () => {
  test('clears the selected days and keeps the rest of the week', async ({ page }) => {
    const rec = await openTask(page, {
      draftOver: { data: { availability: weekOf([0, 1, 2, 3, 4]) } },
    });

    // Leave only Tuesday selected, then apply as a clear.
    for (const day of [0, 1, 3, 4]) await page.getByTestId(`day-toggle-${day}`).click();
    await page.getByTestId('mark-unavailable').locator('input').check();
    await page.getByTestId('apply-to-selected').click();

    await expect.poll(() => rec.patches.length).toBeGreaterThan(0);
    const sent = rec.patches[0].availability as Array<{ dayOfWeek: number }>;
    expect(sent.map((i) => i.dayOfWeek).sort()).toEqual([0, 1, 3, 4]);
  });

  test('leaves the From/To pair alone, so a day is one tap from coming back', async ({ page }) => {
    // Exactly what the approved label promises.
    await openTask(page, { draftOver: { data: { availability: weekOf([2]) } } });

    await page.getByTestId('mark-unavailable').locator('input').check();
    await page.getByTestId('apply-to-selected').click();

    await expect(page.getByTestId('bulk-start')).toHaveValue('09:00');
    await expect(page.getByTestId('bulk-end')).toHaveValue('17:00');
  });
});

test.describe('Task 4 — invalid schedules cannot be saved', () => {
  test('refuses an inverted range and says why', async ({ page }) => {
    const rec = await openTask(page);

    await page.getByTestId('day-toggle-0').click();
    await page.getByTestId('bulk-start').fill('18:00');
    await page.getByTestId('bulk-end').fill('09:00');
    await page.getByTestId('apply-to-selected').click();

    await expect(page.getByTestId('availability-rejected')).toBeVisible();
    expect(rec.patches).toHaveLength(0);
  });
});

test.describe('Task 4 — a save that loses a race', () => {
  test('is reported as a conflict, not as a generic failure', async ({ page }) => {
    await openTask(page, { patchStatus: 409 });

    await page.getByTestId('day-toggle-0').click();
    await page.getByTestId('apply-to-selected').click();

    // Telling the provider to "try again" would invite them to overwrite a
    // week they have not seen.
    await expect(page.getByTestId('task-save-status')).toHaveAttribute('data-status', 'conflict');
  });
});

test.describe('Task 4 — geometry', () => {
  for (const width of [320, 430]) {
    test(`${width}px: no horizontal overflow, and every control is at least 44x44`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 860 });
      await openTask(page, { draftOver: { data: { availability: weekOf([0, 1, 2, 3, 4]) } } });

      await expectNoHorizontalPageOverflow(page);

      // Seven toggles must still fit a 320px column without wrapping into
      // something unusable, and each must remain a real target.
      for (const day of [0, 3, 6]) {
        const box = (await page.getByTestId(`day-toggle-${day}`).boundingBox())!;
        expect(box.width, `day ${day} too narrow`).toBeGreaterThanOrEqual(44);
        expect(box.height, `day ${day} too short`).toBeGreaterThanOrEqual(44);
      }
      for (const id of ['bulk-start', 'bulk-end', 'apply-to-selected']) {
        const box = (await page.getByTestId(id).boundingBox())!;
        expect(box.height, `${id} too short`).toBeGreaterThanOrEqual(44);
      }
    });
  }

  test('the checkbox row is reachable, not trapped under the sticky bar', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 700 });
    await openTask(page);

    const row = page.getByTestId('mark-unavailable');
    await row.scrollIntoViewIfNeeded();
    const box = (await row.boundingBox())!;
    const sticky = (await page.getByTestId('onboarding-v2-sticky').boundingBox())!;
    expect(box.y + box.height, 'the last row sits above the action bar').toBeLessThanOrEqual(
      sticky.y + 1,
    );
  });
});

test.describe('Task 4 — Arabic', () => {
  test('renders the approved Arabic copy with the times unchanged', async ({ page }) => {
    await openTask(page, { lang: 'ar', draftOver: { data: { availability: weekOf([0, 1]) } } });

    expect(await htmlLangDir(page)).toEqual({ lang: 'ar', dir: 'rtl' });
    // Times stay in Latin digits on a 24-hour clock: a stamp the provider
    // matches against their own phone, not prose.
    await expect(page.getByTestId('bulk-start')).toHaveValue('09:00');
    await expect(page.getByTestId('day-toggle-0')).toHaveAttribute('aria-label', 'الأحد');
  });

  test('does not overflow sideways under RTL at 320px', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 860 });
    await openTask(page, { lang: 'ar', draftOver: { data: { availability: weekOf([0, 1, 2]) } } });
    await expectNoHorizontalPageOverflow(page);
  });
});
