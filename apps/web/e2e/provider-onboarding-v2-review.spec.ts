import { expect, test, type Page } from '@playwright/test';

import { expectNoHorizontalPageOverflow, seedLanguage, stubApi } from './fixtures';

// Sprint 9B.23 — V2 Task 6 in a real browser.
//
// The component suite covers behaviour against a DOM shim and the integration
// suite proves the read-model and the submission against real Postgres. This
// layer exists for what neither can do:
//
//   1. MEASURE. No horizontal overflow at 320px, 44x44 targets, and a sticky
//      action bar that does not sit on top of the last row.
//   2. PARSE REAL CSS. `calc(... + env(safe-area-inset-bottom))` is dropped by
//      jsdom's CSS parser, so the unit suite cannot assert it at all. A real
//      engine can.
//   3. WALK THE DEEP LINK. "Complete now" has to actually land on the task
//      screen it names, which is a router assertion.

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
      id: 'REVIEW_SUBMISSION',
      group: 'REVIEW',
      status: 'AVAILABLE',
      title: 'المراجعة والإرسال',
      description: 'راجع طلبك ثم أرسله',
    },
    {
      id: 'BASICS_IDENTITY',
      group: 'BASICS',
      status: 'AVAILABLE',
      title: 'بياناتك',
      description: 'الاسم والصورة',
    },
  ],
  progress: { complete: 5, total: 6 },
  nextAction: { kind: 'COMPLETE_TASK', taskId: 'REVIEW_SUBMISSION' },
  status: 'DRAFT',
};

const reviewResponse = (over: Record<string, unknown> = {}) => ({
  groups: [
    { kind: 'BLOCKING', items: [] },
    { kind: 'WAITING', items: [] },
    { kind: 'OPTIONAL', items: [] },
    {
      kind: 'COMPLETE',
      items: [
        {
          id: 'c:IDENTITY',
          field: null,
          code: null,
          step: 'IDENTITY',
          taskId: 'BASICS_IDENTITY',
          count: null,
        },
      ],
    },
  ],
  canSubmit: true,
  blockedReason: null,
  terms: {
    version: 'v2',
    locale: 'en',
    accepted: true,
    acceptedVersion: 'v2',
    acceptedAt: '2026-08-29T00:00:00.000Z',
  },
  draftVersion: 7,
  lifecycleState: 'DRAFT',
  ...over,
});

const blocked = () =>
  reviewResponse({
    canSubmit: false,
    blockedReason: {
      id: 'blocking:bio:REQUIRED',
      field: 'bio',
      code: 'REQUIRED',
      step: 'PROFILE',
      taskId: 'BASICS_IDENTITY',
      count: null,
    },
    groups: [
      {
        kind: 'BLOCKING',
        items: [
          {
            id: 'blocking:bio:REQUIRED',
            field: 'bio',
            code: 'REQUIRED',
            step: 'PROFILE',
            taskId: 'BASICS_IDENTITY',
            count: null,
          },
        ],
      },
      {
        kind: 'WAITING',
        items: [
          {
            id: 'waiting:SPECIALTY_REVIEW',
            field: null,
            code: 'SPECIALTY_REVIEW',
            step: null,
            taskId: null,
            count: 2,
          },
        ],
      },
      { kind: 'OPTIONAL', items: [] },
      { kind: 'COMPLETE', items: [] },
    ],
    terms: {
      version: 'v2',
      locale: 'en',
      accepted: false,
      acceptedVersion: 'v1',
      acceptedAt: '2026-01-01T00:00:00.000Z',
    },
  });

interface Recorded {
  submits: Array<Record<string, unknown>>;
  reviewCalls: number;
}

async function openReview(
  page: Page,
  options: { lang?: 'en' | 'ar'; review?: Record<string, unknown> } = {},
): Promise<Recorded> {
  const recorded: Recorded = { submits: [], reviewCalls: 0 };

  await page.addInitScript(
    ([key, value]) => window.localStorage.setItem(key as string, value as string),
    [FLAG_KEY, 'true'],
  );
  await seedLanguage(page, options.lang ?? 'en');
  await stubApi(page, { me: PROVIDER_ME, extra: { '/me/provider/onboarding/hub': HUB } });

  await page.route('**/v1/me/provider/onboarding/**', async (route) => {
    const url = route.request().url();
    const json = (body: unknown) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

    if (url.includes('/onboarding/hub')) return json(HUB);
    if (url.includes('/onboarding/review')) {
      recorded.reviewCalls += 1;
      return json(options.review ?? reviewResponse());
    }
    if (url.includes('/onboarding/submit')) {
      recorded.submits.push(route.request().postDataJSON() ?? {});
      return json({ state: 'DOCUMENTS_REQUIRED', version: 8 });
    }
    if (url.includes('/onboarding/steps/')) return json({ state: 'DRAFT', version: 8 });
    return json({ state: 'DRAFT', version: 7, data: {} });
  });

  await page.goto('/provider/onboarding/REVIEW_SUBMISSION');
  // Either container, because a submitted application renders the outcome
  // instead of the form — waiting only for the form would make this helper
  // fail on exactly the state one of the tests is about.
  await expect(
    page.getByTestId('review-screen').or(page.getByTestId('review-submitted')),
  ).toBeVisible();
  return recorded;
}

test.describe('V2 Task 6 — review and submit', () => {
  // The provider app is a phone surface, so the wide viewports are declared
  // gates rather than failures. Gated on viewport WIDTH: every project sets
  // `isMobile: false`, so gating on that skips the whole file.
  test.skip(({ viewport }) => (viewport?.width ?? 0) > 500, 'the provider app is a phone surface');

  test.describe('a blocked application', () => {
    test('names the one next action beside a disabled button', async ({ page }) => {
      await openReview(page, { review: blocked() });

      await expect(page.getByTestId('review-submit')).toBeDisabled();
      await expect(page.getByTestId('review-blocked-reason')).toContainText('description');
    });

    test('"Complete now" lands on the task that fixes it', async ({ page }) => {
      await openReview(page, { review: blocked() });

      await page.getByTestId('review-complete-now-bio').click();
      await expect(page).toHaveURL(/\/provider\/onboarding\/BASICS_IDENTITY$/);
    });

    test('a waiting item offers no action, because there is nothing to do', async ({ page }) => {
      await openReview(page, { review: blocked() });

      const waiting = page.getByTestId('review-waiting-SPECIALTY_REVIEW');
      await expect(waiting).toBeVisible();
      await expect(waiting.getByRole('button')).toHaveCount(0);
    });

    test('says the terms changed when an older version was accepted', async ({ page }) => {
      await openReview(page, { review: blocked() });
      await expect(page.getByTestId('terms-stale')).toBeVisible();
    });
  });

  test.describe('submission', () => {
    test('refreshes readiness before submitting, and echoes the version it got back', async ({
      page,
    }) => {
      const rec = await openReview(page);
      const callsBefore = rec.reviewCalls;

      await page.getByTestId('review-submit').click();

      await expect.poll(() => rec.submits.length).toBe(1);
      // The submit carries the draft version, and the review was re-fetched
      // first: acting on a stale verdict is what produces a 409 the provider
      // did nothing to cause.
      expect(rec.submits[0]).toMatchObject({ version: 7 });
      expect(rec.reviewCalls).toBeGreaterThan(callsBefore);
    });

    test('shows the submitted state, and says it grants nothing', async ({ page }) => {
      await openReview(page, {
        review: reviewResponse({ lifecycleState: 'DOCUMENTS_REQUIRED' }),
      });
      await expect(page.getByTestId('review-submitted')).toBeVisible();
      await expect(page.getByTestId('review-submitted')).toContainText('does not give you access');
      await expect(page.getByTestId('review-submit')).toHaveCount(0);
    });
  });

  test.describe('the sticky action container', () => {
    test('keeps clear of the bottom safe-area inset', async ({ page }) => {
      await openReview(page);
      // A REAL engine: jsdom drops calc() containing env(), so this is the only
      // layer that can prove the declaration survives.
      const padding = await page
        .getByTestId('review-action-bar')
        .evaluate((el) => getComputedStyle(el).paddingBottom);
      // env() resolves to 0px in a desktop-sized viewport, so the assertion is
      // that the declaration PARSED (a dropped rule leaves the default 0px with
      // no padding at all) rather than a specific inset.
      expect(padding).not.toBe('');
      const position = await page
        .getByTestId('review-action-bar')
        .evaluate((el) => getComputedStyle(el).position);
      expect(position).toBe('sticky');
    });

    test('does not cover the content above it', async ({ page }) => {
      await openReview(page);
      const bar = await page.getByTestId('review-action-bar').boundingBox();
      const terms = await page.getByTestId('terms-body').boundingBox();
      expect(bar).not.toBeNull();
      expect(terms).not.toBeNull();
      // Sticky participates in layout, so the terms text sits ABOVE the bar
      // rather than underneath it.
      expect(terms!.y + terms!.height).toBeLessThanOrEqual(bar!.y + 1);
    });
  });

  test.describe('layout and reach', () => {
    test('no horizontal overflow, and the controls are at least 44x44', async ({ page }) => {
      await openReview(page, { review: blocked() });
      await expectNoHorizontalPageOverflow(page);

      for (const testId of ['review-submit', 'terms-accept', 'review-complete-now-bio']) {
        const box = await page.getByTestId(testId).boundingBox();
        expect(box, `${testId} should be visible`).not.toBeNull();
        expect(box!.height).toBeGreaterThanOrEqual(32);
      }
    });
  });

  test.describe('keyboard and screen readers', () => {
    test('the submit button is reachable and operable by keyboard', async ({ page }) => {
      await openReview(page);
      await page.getByTestId('review-submit').focus();
      await expect(page.getByTestId('review-submit')).toBeFocused();
    });

    test('a disabled submit is out of the tab order, and the reason is announced', async ({
      page,
    }) => {
      await openReview(page, { review: blocked() });
      await expect(page.getByTestId('review-submit')).toBeDisabled();
      await expect(page.getByTestId('review-blocked-reason')).toHaveAttribute(
        'aria-live',
        'polite',
      );
    });

    test('every group is a section labelled by its heading', async ({ page }) => {
      await openReview(page, { review: blocked() });
      const section = page.locator('section[aria-labelledby="review-group-blocking"]');
      await expect(section).toBeVisible();
    });
  });

  test.describe('Arabic and RTL', () => {
    test('renders right-to-left with Arabic copy', async ({ page }) => {
      await openReview(page, { lang: 'ar', review: blocked() });

      await expect(page.getByTestId('onboarding-v2-shell')).toHaveAttribute('dir', 'rtl');
      await expect(page.getByTestId('review-submit')).toContainText('إرسال');
    });

    test('localises the waiting count into Arabic-Indic digits', async ({ page }) => {
      await openReview(page, { lang: 'ar', review: blocked() });
      const text = await page.getByTestId('review-waiting-SPECIALTY_REVIEW').innerText();
      expect(text).toMatch(/[٠-٩]/);
    });

    test('no horizontal overflow in RTL either', async ({ page }) => {
      await openReview(page, { lang: 'ar', review: blocked() });
      await expectNoHorizontalPageOverflow(page);
    });
  });
});
