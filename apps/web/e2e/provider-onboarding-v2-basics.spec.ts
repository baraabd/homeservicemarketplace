import { expect, test, type Page } from '@playwright/test';

import {
  expectNoHorizontalPageOverflow,
  expectVisibleFocusIndicator,
  htmlLangDir,
  seedLanguage,
  stubApi,
} from './fixtures';

// Sprint 9B.17 — V2 Task 1 in a real browser.
//
// The component suite covers behaviour against a DOM shim. This layer exists
// for the two things that shim cannot do:
//
//   1. RUN THE CANVAS. The image pipeline decodes, rotates, crops and
//      re-encodes through a real 2D context. happy-dom has no encoder, so
//      outside a browser that code is only ever mocked — and an avatar
//      pipeline nobody has actually executed is not one you can ship.
//   2. MEASURE. Overflow at 320px, 44x44 targets and focus visibility are
//      properties of a layout engine.

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
      id: 'BASICS_IDENTITY',
      group: 'BASICS',
      status: 'AVAILABLE',
      title: 'البيانات الأساسية',
      description: 'الاسم، رقم الهاتف، والصورة الشخصية',
    },
  ],
  progress: { complete: 0, total: 6 },
  nextAction: { kind: 'COMPLETE_TASK', taskId: 'BASICS_IDENTITY' },
  status: 'DRAFT',
};

const draft = (over: Record<string, unknown> = {}) => ({
  state: 'DRAFT',
  currentStep: 'PROVIDER_TYPE',
  steps: [],
  completedSteps: [],
  percentComplete: 0,
  nextAction: { kind: 'COMPLETE_STEP', step: 'PROVIDER_TYPE' },
  complete: false,
  missing: [],
  version: 3,
  policyVersion: 'sprint-08',
  lastSavedAt: null,
  editable: true,
  data: {
    providerType: null,
    legalBusinessName: null,
    displayName: 'Pat Provider',
    profileImageUrl: null,
    phoneNumber: null,
    ...((over.data as Record<string, unknown>) ?? {}),
  },
  ...over,
});

/** A real 1x1 PNG. Playwright hands it to the file input as actual bytes, so
 *  the canvas pipeline decodes and re-encodes something genuine. */
const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

interface Recorded {
  presigns: Array<Record<string, unknown>>;
  puts: number;
  finalizes: Array<Record<string, unknown>>;
  removes: number;
  patches: Array<{ url: string; body: Record<string, unknown> }>;
}

async function openTask(
  page: Page,
  options: { lang?: 'en' | 'ar'; draftOver?: Record<string, unknown> } = {},
): Promise<Recorded> {
  const recorded: Recorded = { presigns: [], puts: 0, finalizes: [], removes: 0, patches: [] };

  await page.addInitScript(
    ([key, value]) => window.localStorage.setItem(key as string, value as string),
    [FLAG_KEY, 'true'],
  );
  await seedLanguage(page, options.lang ?? 'en');

  await stubApi(page, {
    me: PROVIDER_ME,
    extra: { '/me/provider/onboarding/hub': HUB },
  });

  // Routed BEFORE the catch-all stub's patterns are consulted, because
  // page.route matches most-recently-added first.
  await page.route('**/v1/me/provider/onboarding/**', async (route) => {
    const url = route.request().url();
    const method = route.request().method();
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

    // The hub lives under the same prefix, and this handler is registered
    // AFTER stubApi so it wins the match. Answering it with a draft would
    // leave the hub with no tasks, the task route with nothing to render, and
    // a failure that looks like the form is broken.
    if (url.includes('/onboarding/hub')) return json(HUB);
    if (url.includes('/avatar/remove')) {
      recorded.removes += 1;
      return json(draft({ ...options.draftOver, data: { profileImageUrl: null } }));
    }
    if (url.includes('/onboarding/avatar')) {
      recorded.finalizes.push(JSON.parse(route.request().postData() ?? '{}'));
      return json(
        draft({
          ...options.draftOver,
          data: { profileImageUrl: 'https://cdn.test/avatars/ref/new.jpg' },
        }),
      );
    }
    if (url.includes('/onboarding/steps/')) {
      recorded.patches.push({ url, body: JSON.parse(route.request().postData() ?? '{}') });
      return json(draft(options.draftOver));
    }
    if (url.includes('/onboarding/draft') && method === 'GET') {
      return json(draft(options.draftOver));
    }
    return json(draft(options.draftOver));
  });

  await page.route('**/v1/media/presigned-url', async (route) => {
    recorded.presigns.push(JSON.parse(route.request().postData() ?? '{}'));
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        items: [
          {
            uploadUrl: 'http://127.0.0.1:4010/v1/media/uploads/avatars/ref/new.jpg?sig=x',
            fileUrl: 'http://127.0.0.1:4010/v1/media/files/avatars/ref/new.jpg',
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
          },
        ],
      }),
    });
  });

  await page.route('**/v1/media/uploads/**', async (route) => {
    recorded.puts += 1;
    return route.fulfill({ status: 204, body: '' });
  });

  await page.goto('/provider/onboarding/BASICS_IDENTITY');
  await expect(page.getByTestId('basics-task')).toBeVisible();
  return recorded;
}

test.describe('task 1 — what it must not ask', () => {
  test('has no image URL input, and shows no URL to paste into', async ({ page }) => {
    await openTask(page);

    await expect(page.locator('input[type="url"]')).toHaveCount(0);
    const body = (await page.getByTestId('basics-task').textContent()) ?? '';
    expect(body).not.toMatch(/https?:\/\//);
  });

  test('asks for no address of any kind', async ({ page }) => {
    await openTask(page);
    const body = (await page.getByTestId('basics-task').textContent()) ?? '';
    for (const word of [/street/i, /address/i, /postcode/i, /zip/i]) {
      expect(body).not.toMatch(word);
    }
  });

  test('does not demand phone verification, and offers no way to fake it', async ({ page }) => {
    await openTask(page);
    await expect(page.getByTestId('phone-verification-note')).toBeVisible();
    await expect(page.getByRole('button', { name: /verify/i })).toHaveCount(0);
  });
});

test.describe('task 1 — the questions ruling C1 removed', () => {
  // SUPERSEDED CONTRACT, recorded rather than deleted.
  //
  // These two tests asserted that the screen asked for a provider type, warned
  // before changing it, and asked a business for a registered name. They were
  // correct for the Sprint 9B.17 design.
  //
  // Ruling C1 supersedes them: providerType is a SERVER-side default, and the
  // business path belongs to a later approved surface. The approved screen
  // asks three things — photo, customer-facing name, phone — and the rule says
  // in terms not to put provider-type or legal-business-name controls on it.
  //
  // What replaces them is stricter: the old tests proved the controls worked
  // when shown, these prove they cannot be reached at all, for either stored
  // provider type, on the real route.
  test('offers no provider-type control and no business name, whatever the stored type is', async ({
    page,
  }) => {
    await openTask(page, { draftOver: { data: { providerType: 'INDIVIDUAL' } } });
    await expect(page.getByTestId('field-legalBusinessName')).toHaveCount(0);
    await expect(page.getByTestId('provider-type-INDIVIDUAL')).toHaveCount(0);
    await expect(page.getByTestId('provider-type-BUSINESS')).toHaveCount(0);
    await expect(page.getByTestId('provider-type-change-dialog')).toHaveCount(0);

    // A provider already stored as BUSINESS keeps that value server-side; the
    // screen simply stops asking. Nothing is deleted and nothing is re-asked.
    await openTask(page, {
      draftOver: { data: { providerType: 'BUSINESS', legalBusinessName: 'ACME' } },
    });
    await expect(page.getByTestId('field-legalBusinessName')).toHaveCount(0);
    await expect(page.getByTestId('provider-type-BUSINESS')).toHaveCount(0);
  });

  test('writes nothing to the PROVIDER_TYPE step from this screen', async ({ page }) => {
    const rec = await openTask(page, { draftOver: { data: { providerType: 'INDIVIDUAL' } } });

    await page.getByTestId('field-displayName').fill('Ahmad Fatal');
    await page.getByTestId('field-displayName').blur();
    await expect.poll(() => rec.patches.length).toBeGreaterThan(0);

    // Every write from task 1 belongs to IDENTITY now that the type question
    // has moved server-side.
    expect(rec.patches.every((patch) => patch.url.includes('/steps/IDENTITY'))).toBe(true);
    expect(rec.patches.some((patch) => patch.url.includes('/steps/PROVIDER_TYPE'))).toBe(false);
  });
});

test.describe('task 1 — the photo, through a real canvas', () => {
  test('processes, uploads and FINALIZES a genuine PNG', async ({ page }) => {
    const rec = await openTask(page);

    await page.getByTestId('avatar-input-gallery').setInputFiles({
      name: 'me.png',
      mimeType: 'image/png',
      buffer: PNG_BYTES,
    });

    await expect.poll(() => rec.finalizes.length, { timeout: 15_000 }).toBe(1);

    // Presigned for the AVATAR purpose, and re-encoded to JPEG by the canvas
    // before upload — so what lands is one predictable format regardless of
    // what the phone produced.
    expect(rec.presigns[0].purpose).toBe('avatar');
    const item = (rec.presigns[0].items as Array<{ contentType: string }>)[0];
    expect(item.contentType).toBe('image/jpeg');

    expect(rec.puts).toBe(1);
    // A KEY, never a URL, and carrying the version handshake.
    expect(rec.finalizes[0].key).toBe('avatars/ref/new.jpg');
    expect(rec.finalizes[0].version).toBe(3);

    await expect(page.getByTestId('avatar-preview-image')).toBeVisible();
  });

  test('offers rotate once a photo is picked, and re-uploads the turned image', async ({
    page,
  }) => {
    const rec = await openTask(page);

    await page.getByTestId('avatar-input-gallery').setInputFiles({
      name: 'me.png',
      mimeType: 'image/png',
      buffer: PNG_BYTES,
    });
    await expect.poll(() => rec.finalizes.length, { timeout: 15_000 }).toBe(1);

    await page.getByTestId('avatar-rotate').click();
    await expect.poll(() => rec.finalizes.length, { timeout: 15_000 }).toBe(2);
    // Re-presigned rather than re-using an expiring URL.
    expect(rec.presigns).toHaveLength(2);
  });

  test('removes a stored photo through the versioned endpoint', async ({ page }) => {
    const rec = await openTask(page, {
      draftOver: { data: { profileImageUrl: 'https://cdn.test/avatars/ref/old.jpg' } },
    });

    await page.getByTestId('avatar-remove').click();
    await expect.poll(() => rec.removes).toBe(1);
  });
});

test.describe('task 1 — geometry and keyboard', () => {
  for (const width of [320, 430]) {
    test(`${width}px: no horizontal overflow and 44x44 controls`, async ({ page }) => {
      await page.setViewportSize({ width, height: 780 });
      await openTask(page);

      await expectNoHorizontalPageOverflow(page);

      // field-legalBusinessName is gone with ruling C1; the approved screen
      // asks three things and every one of them is still measured here.
      for (const testId of [
        'field-displayName',
        'field-phoneNumber',
        'avatar-take-photo',
        'avatar-choose-file',
      ]) {
        const box = (await page.getByTestId(testId).boundingBox())!;
        expect(box.height, `${testId} is too short`).toBeGreaterThanOrEqual(44);
      }
    });
  }

  test('every input is reachable and shows focus', async ({ page }) => {
    await openTask(page);
    await expectVisibleFocusIndicator(page.getByTestId('field-displayName'), 'display name');
    await expectVisibleFocusIndicator(page.getByTestId('field-phoneNumber'), 'phone');
  });

  test('a malformed phone is reported inline and not sent', async ({ page }) => {
    const rec = await openTask(page);

    await page.getByTestId('field-phoneNumber').fill('12345');
    await page.getByTestId('field-displayName').click();

    await expect(page.getByText('Enter a phone number in international format,')).toBeVisible();
    expect(rec.patches.filter((p) => 'phoneNumber' in p.body)).toHaveLength(0);
  });

  test('a valid phone saves on blur', async ({ page }) => {
    const rec = await openTask(page);

    await page.getByTestId('field-phoneNumber').fill('+963912345678');
    await page.getByTestId('field-displayName').click();

    await expect.poll(() => rec.patches.filter((p) => 'phoneNumber' in p.body).length).toBe(1);
  });
});

test.describe('task 1 — Arabic', () => {
  test('renders Arabic in an RTL document without overflow', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 780 });
    await openTask(page, { lang: 'ar' });

    expect(await htmlLangDir(page)).toEqual({ lang: 'ar', dir: 'rtl' });
    // Was the provider-type legend, which ruling C1 removed. Asserts instead
    // on copy the approved screen actually shows.
    await expect(page.getByTestId('basics-task')).toContainText('الاسم الذي يراه العملاء');
    await expect(page.getByTestId('basics-task')).not.toContainText('Name customers see');
    await expectNoHorizontalPageOverflow(page);
  });
});
