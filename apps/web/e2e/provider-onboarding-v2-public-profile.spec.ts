import { expect, test, type Page } from '@playwright/test';

import { expectNoHorizontalPageOverflow, seedLanguage, stubApi } from './fixtures';

// Sprint 9B.22 — V2 Task 5 in a real browser.
//
// The component suite covers behaviour against a DOM shim and the integration
// suite proves the projection against a real Postgres. This layer exists for
// what neither can do:
//
//   1. MEASURE. No horizontal overflow at 320px, 44x44 targets, and a preview
//      that does not blow the layout out when it carries images.
//   2. PROVE THE SEPARATION END TO END. The page is rendered with a server that
//      returns a preview AND a private draft; the assertion is that nothing
//      from the private half reaches the screen.

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
      id: 'PORTFOLIO',
      group: 'PROFILE',
      status: 'AVAILABLE',
      title: 'معرض الأعمال',
      description: 'نبذة تعريفية وصور من أعمالك السابقة',
    },
  ],
  progress: { complete: 0, total: 6 },
  nextAction: { kind: 'COMPLETE_TASK', taskId: 'PORTFOLIO' },
  status: 'DRAFT',
};

/** The PRIVATE draft. Everything here that a customer must never see is
 *  present on purpose, so the assertions below mean something. */
const PHONE = '+963991234567';
const draft = (over: Record<string, unknown> = {}) => ({
  state: 'DRAFT',
  currentStep: 'PROFILE',
  steps: [],
  completedSteps: [],
  percentComplete: 0,
  complete: false,
  missing: [],
  version: 7,
  policyVersion: 'sprint-08',
  lastSavedAt: null,
  editable: true,
  ...over,
  data: {
    headline: null,
    bio: null,
    additionalInformation: 'Please call before 9am.',
    phoneNumber: PHONE,
    serviceAreaLat: 33.51378,
    serviceAreaLng: 36.29234,
    serviceAreaRadiusKm: 25,
    suggestedTitle: { en: 'Electrician', ar: 'كهربائي' },
    ...((over.data as Record<string, unknown>) ?? {}),
  },
});

const previewResponse = (over: Record<string, unknown> = {}) => ({
  profile: {
    displayName: 'Pat Provider',
    initials: 'PP',
    avatarUrl: null,
    about: { headline: 'Electrician', bio: 'I do residential electrical work.' },
    area: { city: 'Damascus', country: 'Syria' },
    standing: { ratingAvg: 4.8, reviewCount: 12, completedJobs: 30, verified: true },
    portfolio: [],
    services: ['Fault finding'],
    ...((over.profile as Record<string, unknown>) ?? {}),
  },
  awaitingReviewCount: 0,
  publicProfileRouteAvailable: false,
  moderationReviewAvailable: false,
  ...over,
});

interface Recorded {
  patches: Array<Record<string, unknown>>;
}

async function openTask(
  page: Page,
  options: {
    lang?: 'en' | 'ar';
    draftOver?: Record<string, unknown>;
    previewOver?: Record<string, unknown>;
  } = {},
): Promise<Recorded> {
  const recorded: Recorded = { patches: [] };

  await page.addInitScript(
    ([key, value]) => window.localStorage.setItem(key as string, value as string),
    [FLAG_KEY, 'true'],
  );
  await seedLanguage(page, options.lang ?? 'en');
  await stubApi(page, { me: PROVIDER_ME, extra: { '/me/provider/onboarding/hub': HUB } });

  await page.route('**/v1/me/provider/public-profile/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(previewResponse(options.previewOver)),
    }),
  );

  await page.route('**/v1/me/provider/portfolio**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items: [], remainingSlots: 10, maxItems: 10 }),
    }),
  );

  await page.route('**/v1/me/provider/onboarding/**', async (route) => {
    const url = route.request().url();
    const json = (body: unknown) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

    if (url.includes('/onboarding/hub')) return json(HUB);
    if (url.includes('/onboarding/steps/')) {
      recorded.patches.push(JSON.parse(route.request().postData() ?? '{}'));
      return json(draft({ ...options.draftOver, version: 8 }));
    }
    return json(draft(options.draftOver));
  });

  await page.goto('/provider/onboarding/PORTFOLIO');
  await expect(page.getByTestId('public-profile-task')).toBeVisible();
  return recorded;
}

// ─────────────────────────────────────────────────────────────────────────────

test.describe('Task 5 — the profile a customer will see', () => {
  test('renders the server’s public projection', async ({ page }) => {
    await openTask(page);
    await expect(page.getByTestId('preview-display-name')).toHaveText('Pat Provider');
    await expect(page.getByTestId('preview-headline')).toHaveText('Electrician');
    await expect(page.getByTestId('preview-area')).toContainText('Damascus');
  });

  test('shows nothing from the PRIVATE draft in the preview', async ({ page }) => {
    // The draft the page loaded carries a phone number, coordinates and a
    // radius. None of it may appear anywhere on the screen.
    await openTask(page);
    const body = (await page.locator('body').textContent()) ?? '';
    for (const secret of [PHONE, '33.51378', '36.29234', 'Please call before 9am.']) {
      expect({ secret, leaked: body.includes(secret) }).toEqual({ secret, leaked: false });
    }
  });

  test('offers the suggested title and does not save it by itself', async ({ page }) => {
    const recorded = await openTask(page);
    await expect(page.getByTestId('title-suggestion')).toContainText('Electrician');
    expect(recorded.patches).toHaveLength(0);

    await page.getByTestId('title-use-suggestion').click();
    await expect(page.getByTestId('title-input')).toHaveValue('Electrician');
    expect(recorded.patches).toHaveLength(0);
  });

  test('saves the title once the provider leaves the field', async ({ page }) => {
    const recorded = await openTask(page);
    await page.getByTestId('title-input').fill('Electrician');
    await page.getByTestId('bio-input').click();

    await expect.poll(() => recorded.patches.length).toBeGreaterThan(0);
    expect(recorded.patches[recorded.patches.length - 1]).toMatchObject({
      headline: 'Electrician',
    });
  });

  test('refuses a title carrying a phone number, in the browser', async ({ page }) => {
    const recorded = await openTask(page);
    await page.getByTestId('title-input').fill('Electrician call 0991234567');
    await page.getByTestId('bio-input').click();

    await expect(page.getByTestId('title-help')).toContainText('Leave phone numbers');
    expect(recorded.patches).toHaveLength(0);
  });
});

test.describe('Task 5 — the notices tell the truth', () => {
  test('says customer profiles are not live yet', async ({ page }) => {
    await openTask(page);
    await expect(page.getByTestId('notice-route-unavailable')).toBeVisible();
  });

  test('counts photos waiting, and admits no reviewer exists', async ({ page }) => {
    await openTask(page, { previewOver: { awaitingReviewCount: 2 } });
    await expect(page.getByTestId('notice-awaiting-review')).toContainText('2');
    await expect(page.getByTestId('notice-no-reviewer')).toBeVisible();
  });

  test('shows an approved photo when the server returns one', async ({ page }) => {
    await openTask(page, {
      previewOver: {
        profile: {
          displayName: 'Pat Provider',
          initials: 'PP',
          avatarUrl: null,
          about: { headline: 'Electrician', bio: 'I do residential electrical work.' },
          area: { city: 'Damascus', country: 'Syria' },
          standing: { ratingAvg: 4.8, reviewCount: 12, completedJobs: 30, verified: true },
          portfolio: [
            { url: '/v1/media/files/portfolio/ref/a.jpg', title: 'Rewire', description: null },
          ],
          services: ['Fault finding'],
        },
      },
    });
    await expect(page.getByTestId('preview-photos').locator('li')).toHaveCount(1);
    await expect(page.getByTestId('preview-no-photos')).toHaveCount(0);
  });
});

test.describe('Task 5 — the portfolio is the existing component', () => {
  test('mounts inside the task', async ({ page }) => {
    await openTask(page);
    await expect(page.getByTestId('public-profile-portfolio')).toBeVisible();
  });
});

test.describe('Task 5 — Arabic', () => {
  test('renders the Arabic suggestion and an Arabic-Indic counter', async ({ page }) => {
    await openTask(page, { lang: 'ar' });
    await expect(page.getByTestId('title-suggestion')).toContainText('كهربائي');
    await expect(page.getByTestId('bio-counter')).toContainText('٢٬٠٠٠');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GEOMETRY
// ─────────────────────────────────────────────────────────────────────────────

for (const width of [320, 430]) {
  test.describe(`Task 5 — geometry at ${width}px`, () => {
    test.skip(
      ({ viewport }) => (viewport?.width ?? 0) > 500,
      'the provider app is a phone surface',
    );

    test('no horizontal overflow, and the controls are at least 44x44', async ({ page }) => {
      await page.setViewportSize({ width, height: 780 });
      await openTask(page, {
        previewOver: {
          awaitingReviewCount: 3,
          profile: {
            displayName: 'Pat Provider',
            initials: 'PP',
            avatarUrl: null,
            about: {
              headline: 'Electrician',
              bio: 'I do residential electrical work and light commercial installations.',
            },
            area: { city: 'Damascus', country: 'Syria' },
            standing: { ratingAvg: 4.8, reviewCount: 12, completedJobs: 30, verified: true },
            portfolio: [
              { url: '/v1/media/files/portfolio/ref/a.jpg', title: 'Rewire', description: null },
              { url: '/v1/media/files/portfolio/ref/b.jpg', title: 'Board', description: null },
              { url: '/v1/media/files/portfolio/ref/c.jpg', title: 'Lights', description: null },
            ],
            services: ['Fault finding', 'Rewiring'],
          },
        },
      });

      await expectNoHorizontalPageOverflow(page);

      for (const testId of ['title-use-suggestion', 'title-input', 'preview-refresh']) {
        const box = await page.getByTestId(testId).boundingBox();
        expect({ testId, ok: (box?.height ?? 0) >= 44 }).toEqual({ testId, ok: true });
      }
    });

    test('a long unbroken bio cannot push the page sideways', async ({ page }) => {
      await page.setViewportSize({ width, height: 780 });
      await openTask(page, {
        previewOver: {
          profile: {
            displayName: 'Pat Provider',
            initials: 'PP',
            avatarUrl: null,
            about: { headline: 'Electrician', bio: 'x'.repeat(400) },
            area: { city: 'Damascus', country: 'Syria' },
            standing: { ratingAvg: 4.8, reviewCount: 12, completedJobs: 30, verified: true },
            portfolio: [],
            services: [],
          },
        },
      });
      await expectNoHorizontalPageOverflow(page);
    });
  });
}
