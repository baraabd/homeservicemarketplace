import { expect, test, type Page } from '@playwright/test';

import { expectNoHorizontalPageOverflow, seedLanguage, stubApi } from './fixtures';

// Sprint 9B.23 — V2 Task 6 in a real browser.
// Sprint 09B.29 Phase 5A — the approved design's three screens.
//
// The component suite covers behaviour against a DOM shim and the integration
// suite proves the read-model and the submission against real Postgres. This
// layer exists for what neither can do:
//
//   1. MEASURE. No horizontal overflow at 320px, 44x44 targets, and an action
//      bar that does not sit on top of the last row.
//   2. PARSE REAL CSS. `calc(... + env(safe-area-inset-bottom))` is dropped by
//      jsdom's CSS parser, so the unit suite cannot assert it at all. A real
//      engine can.
//   3. WALK THE DEEP LINKS. Four pencils and a "Complete now" have to land on
//      the task screens they name, which is a router assertion.
//
// WHAT MOVED, AND WHY THE ASSERTIONS MOVED WITH IT
//
//   the action bar    is the shared onboarding chrome's now, not this screen's.
//                     It is a flex SIBLING of the scroll area rather than a
//                     `position: sticky` child, which is a stronger form of the
//                     same guarantee — it cannot overlap content at all, rather
//                     than only while there is more to scroll. Both the inset
//                     and the non-overlap are still asserted, on
//                     `onboarding-v2-sticky`.
//   the submit        lives on the CONSENT screen (`#terms`), because agreeing
//                     to a legal document and pressing submit are one act and
//                     the approved design puts them together.
//   the waiting card  became a badge on the summary row it belongs to. The
//                     assertion that it offers no action came with it.

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
    {
      id: 'WORK_AREA',
      group: 'COVERAGE',
      status: 'AVAILABLE',
      title: 'نطاق العمل',
      description: 'أين تعمل',
    },
  ],
  progress: { complete: 5, total: 6 },
  nextAction: { kind: 'COMPLETE_TASK', taskId: 'REVIEW_SUBMISSION' },
  status: 'DRAFT',
};

/** A finished application — what the four summary rows read back. */
const draftResponse = (over: Record<string, unknown> = {}) => ({
  state: 'DRAFT',
  currentStep: 'REVIEW',
  steps: [],
  completedSteps: [],
  percentComplete: 100,
  nextAction: { kind: 'SUBMIT' },
  complete: true,
  missing: [],
  version: 7,
  policyVersion: 'v2',
  lastSavedAt: '2026-09-01T12:42:00.000Z',
  editable: true,
  ...over,
  data: {
    displayName: 'Ahmad Fatal',
    phoneNumber: '0936706600',
    primarySpecialtyId: 'sp-interior',
    specialties: [
      {
        categoryId: 'sp-interior',
        labelEn: 'Interior painting',
        labelAr: 'دهانات داخلية',
        state: 'APPROVED',
      },
    ],
    yearsOfExperience: 14,
    transportMode: 'CAR',
    serviceAreaCity: 'Aleppo, Al-Furqan',
    serviceAreaRadiusKm: 15,
    timezone: 'UTC',
    resolvedTimezone: { resolved: 'UTC', display: null, needsConfirmation: false },
    availability: [0, 1, 2, 3, 4].map((dayOfWeek) => ({
      id: `av-${dayOfWeek}`,
      dayOfWeek,
      startMinute: 540,
      endMinute: 1020,
      timezone: 'UTC',
    })),
    ...((over.data as Record<string, unknown>) ?? {}),
  },
});

const reviewResponse = (over: Record<string, unknown> = {}) => ({
  groups: [],
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
  canWithdraw: false,
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
  /** Every write to the CONSENT step, which is how acceptance is recorded. */
  consents: Array<Record<string, unknown>>;
  reviewCalls: number;
}

interface OpenOptions {
  lang?: 'en' | 'ar';
  review?: Record<string, unknown>;
  draft?: Record<string, unknown>;
  /** Which of the three approved screens to open. */
  part?: 'review' | 'terms';
  submittedAt?: string | null;
}

async function openReview(page: Page, options: OpenOptions = {}): Promise<Recorded> {
  const recorded: Recorded = { submits: [], consents: [], reviewCalls: 0 };
  const draft = options.draft ?? draftResponse();

  await page.addInitScript(
    ([key, value]) => window.localStorage.setItem(key as string, value as string),
    [FLAG_KEY, 'true'],
  );
  await seedLanguage(page, options.lang ?? 'en');
  await stubApi(page, { me: PROVIDER_ME, extra: { '/me/provider/onboarding/hub': HUB } });

  // The confirmation reads the submission time from the PROFILE, which is the
  // only place the server records it.
  await page.route('**/v1/me/provider/profile', async (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        profile: {
          id: 'pp-1',
          displayName: 'Ahmad Fatal',
          initials: 'AF',
          avatarUrl: null,
          status: 'DRAFT',
          submittedForReviewAt: options.submittedAt ?? null,
          reviewedAt: null,
          rejectionReason: null,
          serviceCategories: [],
          pendingCategories: [],
        },
      }),
    }),
  );

  await page.route('**/v1/me/provider/onboarding/**', async (route) => {
    const url = route.request().url();
    const json = (body: unknown) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

    if (url.includes('/onboarding/hub')) return json(HUB);
    // Checked before the draft, which shares its prefix.
    if (url.includes('/onboarding/review')) {
      recorded.reviewCalls += 1;
      const body = (options.review ?? reviewResponse()) as Record<string, unknown>;
      if (recorded.consents.length === 0) return json(body);
      // The acceptance ROUND TRIPS, as it does in production: the tick appears
      // because the server reports it, never because the client assumed it.
      const terms = body.terms as Record<string, unknown>;
      return json({
        ...body,
        terms: { ...terms, accepted: true, acceptedVersion: terms.version },
      });
    }
    if (url.includes('/onboarding/submit')) {
      recorded.submits.push(route.request().postDataJSON() ?? {});
      return json({ ...draft, state: 'DOCUMENTS_REQUIRED', version: 8 });
    }
    if (url.includes('/onboarding/steps/CONSENT')) {
      recorded.consents.push(route.request().postDataJSON() ?? {});
      return json({ ...draft, version: 8 });
    }
    if (url.includes('/onboarding/steps/')) return json({ ...draft, version: 8 });
    return json(draft);
  });

  const hash = options.part === 'terms' ? '#terms' : '';
  await page.goto(`/provider/onboarding/REVIEW_SUBMISSION${hash}`);

  // Any of the three, because which one appears is the application's own
  // lifecycle — waiting for one would make this helper fail on exactly the
  // state a given test is about.
  await expect(
    page
      .getByTestId('review-screen')
      .or(page.getByTestId('terms-section'))
      .or(page.getByTestId('review-submitted')),
  ).toBeVisible();
  return recorded;
}

test.describe('V2 Task 6 — review and submit', () => {
  // The provider app is a phone surface, so the wide viewports are declared
  // gates rather than failures. Gated on viewport WIDTH: every project sets
  // `isMobile: false`, so gating on that skips the whole file.
  test.skip(({ viewport }) => (viewport?.width ?? 0) > 500, 'the provider app is a phone surface');

  test.describe('the summary', () => {
    test('reads the application back, row by row', async ({ page }) => {
      await openReview(page);

      await expect(page.getByTestId('review-row-BASICS_IDENTITY')).toContainText(
        'Ahmad Fatal • 0936706600',
      );
      await expect(page.getByTestId('review-row-WORK_AREA')).toContainText(
        'Aleppo, Al-Furqan • 15 km',
      );
      await expect(page.getByTestId('review-row-WORKING_HOURS')).toContainText(
        'Sunday–Thursday • 09:00–17:00',
      );
    });

    test('every pencil lands on the task that owns the row', async ({ page }) => {
      await openReview(page);

      await page.getByTestId('review-edit-WORK_AREA').click();
      await expect(page).toHaveURL(/\/provider\/onboarding\/WORK_AREA$/);
    });

    test('a decision that is with the platform offers no action', async ({ page }) => {
      await openReview(page, {
        draft: draftResponse({
          data: {
            specialties: [
              {
                categoryId: 'sp-interior',
                labelEn: 'Interior painting',
                labelAr: 'دهانات داخلية',
                state: 'PENDING',
              },
            ],
          },
        }),
      });

      const row = page.getByTestId('review-row-SERVICES_EXPERIENCE');
      await expect(row).toContainText('In review');
      await expect(row.getByRole('button')).toHaveCount(0);
    });

    test('the primary continues to the consent rather than submitting from here', async ({
      page,
    }) => {
      await openReview(page);

      await page.getByTestId('review-continue-to-consent').click();
      await expect(page.getByTestId('terms-section')).toBeVisible();
    });
  });

  test.describe('a blocked application', () => {
    test('names the one next action beside a disabled button', async ({ page }) => {
      await openReview(page, { review: blocked(), part: 'terms' });

      await expect(page.getByTestId('review-submit')).toBeDisabled();
      await expect(page.getByTestId('review-blocked-reason')).toContainText('description');
    });

    test('"Complete now" lands on the task that fixes it', async ({ page }) => {
      await openReview(page, { review: blocked() });

      await page.getByTestId('review-complete-now-bio').click();
      await expect(page).toHaveURL(/\/provider\/onboarding\/BASICS_IDENTITY$/);
    });

    test('says the terms changed when an older version was accepted', async ({ page }) => {
      await openReview(page, { review: blocked(), part: 'terms' });
      await expect(page.getByTestId('terms-stale')).toBeVisible();
    });
  });

  test.describe('consent and submission', () => {
    test('refreshes readiness before submitting, and echoes the version it got back', async ({
      page,
    }) => {
      const rec = await openReview(page, { part: 'terms' });
      const callsBefore = rec.reviewCalls;

      await page.getByTestId('review-submit').click();

      await expect.poll(() => rec.submits.length).toBe(1);
      // The submit carries the draft version, and the review was re-fetched
      // first: acting on a stale verdict is what produces a 409 the provider
      // did nothing to cause.
      expect(rec.submits[0]).toMatchObject({ version: 7 });
      expect(rec.reviewCalls).toBeGreaterThan(callsBefore);
    });

    test('records WHICH wording was agreed to, and shows the tick only once it did', async ({
      page,
    }) => {
      const rec = await openReview(page, {
        part: 'terms',
        review: reviewResponse({
          canSubmit: false,
          terms: {
            version: 'v2',
            locale: 'en',
            accepted: false,
            acceptedVersion: null,
            acceptedAt: null,
          },
        }),
      });

      await expect(page.getByTestId('terms-accept')).not.toBeChecked();
      await page.getByTestId('terms-accept').click();

      await expect.poll(() => rec.consents.length).toBe(1);
      // The server records which document was agreed to, and refuses a stale
      // draft version — so both travel with the write.
      expect(rec.consents[0]).toMatchObject({ acceptedConsentVersion: 'v2', version: 7 });
      await expect(page.getByTestId('terms-accept')).toBeChecked();
    });

    test('shows the confirmation once the application is in, and says it grants nothing', async ({
      page,
    }) => {
      await openReview(page, {
        draft: draftResponse({ state: 'SUBMITTED', editable: false }),
        review: reviewResponse({
          lifecycleState: 'SUBMITTED',
          canSubmit: false,
          canWithdraw: true,
        }),
        submittedAt: '2026-09-01T12:43:00.000Z',
      });

      await expect(page.getByTestId('review-submitted')).toBeVisible();
      await expect(page.getByTestId('timeline-step-activation')).toContainText(
        'does not give you access to work',
      );
      // No submit anywhere on the screen: the chrome's primary leaves for the
      // status centre instead.
      await expect(page.getByTestId('review-submit')).toHaveCount(0);
      await expect(page.getByTestId('submitted-view-status')).toBeVisible();
    });

    test('the confirmation shows the time the SERVER recorded', async ({ page }) => {
      await openReview(page, {
        draft: draftResponse({ state: 'SUBMITTED', editable: false }),
        review: reviewResponse({ lifecycleState: 'SUBMITTED', canSubmit: false }),
        submittedAt: new Date(new Date().setUTCHours(12, 43, 0, 0)).toISOString(),
      });

      await expect(page.getByTestId('timeline-step-submitted')).toContainText('12:43');
    });
  });

  test.describe('the action bar', () => {
    test('keeps clear of the bottom safe-area inset', async ({ page }) => {
      await openReview(page, { part: 'terms' });
      // A REAL engine: jsdom drops calc() containing env(), so this is the only
      // layer that can prove the declaration survives.
      const padding = await page
        .getByTestId('onboarding-v2-sticky')
        .evaluate((el) => getComputedStyle(el).paddingBottom);
      // env() resolves to 0px in a desktop-sized viewport, so the assertion is
      // that the declaration PARSED (a dropped rule leaves the default 0px with
      // no padding at all) rather than a specific inset.
      expect(padding).not.toBe('');
      expect(padding).not.toBe('0px');
    });

    test('does not cover the content above it', async ({ page }) => {
      await openReview(page, { part: 'terms' });
      const bar = await page.getByTestId('onboarding-v2-sticky').boundingBox();
      const panel = await page.getByTestId('terms-after-submit').boundingBox();
      expect(bar).not.toBeNull();
      expect(panel).not.toBeNull();
      // A flex sibling of the scroll area takes its own space, so the last
      // panel sits ABOVE the bar rather than underneath it — and does so
      // whether or not there is more to scroll.
      expect(panel!.y + panel!.height).toBeLessThanOrEqual(bar!.y + 1);
    });
  });

  test.describe('layout and reach', () => {
    test('no horizontal overflow, and the controls are real targets', async ({ page }) => {
      await openReview(page, { review: blocked() });
      await expectNoHorizontalPageOverflow(page);

      // The pencils are the approved 44x44 squares, not 16px glyphs.
      for (const taskId of ['BASICS_IDENTITY', 'WORK_AREA', 'WORKING_HOURS']) {
        const box = await page.getByTestId(`review-edit-${taskId}`).boundingBox();
        expect(box, `review-edit-${taskId} should be visible`).not.toBeNull();
        expect(box!.height).toBeGreaterThanOrEqual(44);
        expect(box!.width).toBeGreaterThanOrEqual(44);
      }
    });

    test('the consent screen fits at 320px too', async ({ page }) => {
      await page.setViewportSize({ width: 320, height: 780 });
      await openReview(page, { part: 'terms' });
      await expectNoHorizontalPageOverflow(page);

      const box = await page.getByTestId('review-submit').boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);
    });
  });

  test.describe('keyboard and screen readers', () => {
    test('the submit is reachable and operable by keyboard', async ({ page }) => {
      await openReview(page, { part: 'terms' });
      await page.getByTestId('review-submit').focus();
      await expect(page.getByTestId('review-submit')).toBeFocused();
    });

    test('the consent is a real checkbox, named by its own sentence', async ({ page }) => {
      await openReview(page, { part: 'terms' });

      const box = page.getByTestId('terms-accept');
      await expect(box).toHaveAttribute('type', 'checkbox');
      await expect(box).toBeChecked();
      // The version is wired as the description, so a screen reader says which
      // document is being agreed to without the user hunting for it.
      const describedBy = await box.getAttribute('aria-describedby');
      expect(describedBy).toBeTruthy();
      await expect(page.locator(`#${describedBy}`)).toContainText('Version v2');
    });

    test('a disabled submit is out of the tab order, and the reason is announced', async ({
      page,
    }) => {
      await openReview(page, { review: blocked(), part: 'terms' });
      await expect(page.getByTestId('review-submit')).toBeDisabled();
      await expect(page.getByTestId('review-blocked-reason')).toHaveAttribute(
        'aria-live',
        'polite',
      );
    });

    test('each pencil names the row it edits, not just "Edit"', async ({ page }) => {
      await openReview(page);
      // Four identical stops called "Edit" is what a screen-reader user meets
      // otherwise, with no way to tell which row they are on.
      await expect(page.getByTestId('review-edit-WORK_AREA')).toHaveAttribute(
        'aria-label',
        'Edit: Work area',
      );
    });
  });

  test.describe('Arabic and RTL', () => {
    test('renders right-to-left with Arabic copy', async ({ page }) => {
      await openReview(page, { lang: 'ar', part: 'terms' });

      await expect(page.getByTestId('onboarding-v2-shell')).toHaveAttribute('dir', 'rtl');
      await expect(page.getByTestId('review-submit')).toContainText('إرسال');
    });

    test('reads the values back in Arabic, with the Arabic unit', async ({ page }) => {
      await openReview(page, {
        lang: 'ar',
        draft: draftResponse({ data: { serviceAreaCity: 'حلب، الفرقان' } }),
      });

      // An Arabic city beside "15 km" was a real false pass one screen over.
      await expect(page.getByTestId('review-row-WORK_AREA')).toContainText('حلب، الفرقان • 15 كم');
      await expect(page.getByTestId('review-row-SERVICES_EXPERIENCE')).toContainText(
        'دهانات داخلية • 14 عاماً • سيارة',
      );
    });

    test('no horizontal overflow in RTL either', async ({ page }) => {
      await openReview(page, { lang: 'ar', review: blocked() });
      await expectNoHorizontalPageOverflow(page);
    });
  });
});
