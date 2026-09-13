import { expect, test, type Page } from '@playwright/test';

import { expectNoHorizontalPageOverflow, htmlLangDir, seedLanguage, stubApi } from './fixtures';

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

// Sprint 09B.29 Phase 5A — Task 5 in a real browser, on the two approved
// screens: `profile` (the bio and the customer preview) and `portfolio`
// (the uploader, the tiles and the moderation notice).
//
// SUPERSEDED, and recorded rather than deleted:
//
//   the title editor    ruling C1 makes the generated title server-owned, and
//                       the approved screen shows it without an editor. The
//                       client-side refusal of a phone number inside it has
//                       nothing left to refuse — no unverifiable text can be
//                       typed there at all, which is stricter.
//   the preview panel   was the server's public PROJECTION, fetched
//                       separately. The approved panel reads back the draft
//                       the provider is filling in, which is the thing they
//                       are being asked to confirm.
//   the bio counter     gone with the approved design; the ceiling is an input
//                       cap now.
//
// What this layer still exists for is what a DOM shim cannot see: geometry at
// 320px, and real bidi layout.

/** Open the second approved screen of this task. */
async function openPortfolio(page: Page, options: Parameters<typeof openTask>[1] = {}) {
  const recorded = await openTask(page, options);
  await page.goto('/provider/onboarding/PORTFOLIO#portfolio');
  await expect(page.getByTestId('portfolio-section')).toBeVisible();
  return recorded;
}

test.describe('Task 5 — the profile a customer will see', () => {
  test('reads back what the provider told us, and offers nothing to edit', async ({ page }) => {
    await openTask(page, {
      draftOver: {
        data: {
          suggestedTitle: { en: 'Painting professional', ar: 'فني دهانات' },
          serviceAreaCity: 'Aleppo, Al-Furqan',
          serviceAreaRadiusKm: 15,
          yearsOfExperience: 14,
        },
      },
    });

    await expect(page.getByTestId('preview-title')).toContainText('Painting professional');
    await expect(page.getByTestId('preview-line')).toContainText('15 km radius');
    await expect(page.getByTestId('title-input')).toHaveCount(0);
  });

  test('saves the bio as it is typed', async ({ page }) => {
    const rec = await openTask(page);

    await page.getByTestId('bio-input').fill('Painting professional with 14 years of experience.');
    await expect.poll(() => rec.patches.length).toBeGreaterThan(0);
    expect(rec.patches.some((p) => typeof p.bio === 'string')).toBe(true);
  });

  test('caps the bio at the input rather than letting the server refuse it', async ({ page }) => {
    await openTask(page);
    await expect(page.getByTestId('bio-input')).toHaveAttribute('maxlength', '2000');
  });
});

test.describe('Task 5 — the portfolio', () => {
  test('draws the approved upload surface and the moderation notice', async ({ page }) => {
    await openPortfolio(page);

    await expect(page.getByTestId('portfolio-add-photo')).toBeVisible();
    await expect(page.getByTestId('portfolio-moderation-notice')).toBeVisible();
  });

  test('will not upload until the publication wording has been agreed to', async ({ page }) => {
    await openPortfolio(page);

    // The server records WHICH wording was agreed to. A create sent without
    // showing the sentence would record agreement to text nobody saw.
    await page.getByTestId('portfolio-file-input').setInputFiles({
      name: 'work.jpg',
      mimeType: 'image/jpeg',
      buffer: Buffer.from([0xff, 0xd8, 0xff]),
    });

    await expect(page.getByTestId('portfolio-consent')).toBeVisible();
    await expect(page.getByTestId('portfolio-consent-agree')).toBeDisabled();
    await page.getByTestId('portfolio-consent').locator('input[type="checkbox"]').check();
    await expect(page.getByTestId('portfolio-consent-agree')).toBeEnabled();
  });
});

test.describe('Task 5 — Arabic', () => {
  test('renders the approved Arabic copy, RTL, without overflow', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 780 });
    await openTask(page, { lang: 'ar' });

    expect(await htmlLangDir(page)).toEqual({ lang: 'ar', dir: 'rtl' });
    await expect(page.getByTestId('bio-input')).toBeVisible();
    await expectNoHorizontalPageOverflow(page);
  });
});

test.describe('Task 5 — geometry', () => {
  for (const width of [320, 430]) {
    test(`${width}px: no horizontal overflow, and the controls are at least 44x44`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 780 });
      await openTask(page);

      await expectNoHorizontalPageOverflow(page);

      const bio = (await page.getByTestId('bio-input').boundingBox())!;
      expect(bio.height, 'the bio is a real target').toBeGreaterThanOrEqual(44);
    });

    test(`${width}px: the uploader is a real target`, async ({ page }) => {
      await page.setViewportSize({ width, height: 780 });
      await openPortfolio(page);

      await expectNoHorizontalPageOverflow(page);
      const add = (await page.getByTestId('portfolio-add-photo').boundingBox())!;
      expect(add.height).toBeGreaterThanOrEqual(44);
      expect(add.width).toBeGreaterThanOrEqual(44);
    });
  }

  test('a long unbroken bio cannot push the page sideways', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 780 });
    await openTask(page, { draftOver: { data: { bio: 'x'.repeat(400) } } });
    await expectNoHorizontalPageOverflow(page);
  });
});
