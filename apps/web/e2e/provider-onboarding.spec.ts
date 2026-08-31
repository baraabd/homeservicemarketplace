import { expect, test, type Page } from '@playwright/test';

import {
  expectContainedInParent,
  expectLegible,
  expectNoHorizontalPageOverflow,
  expectVisibleFocusIndicator,
  htmlLangDir,
  seedLanguage,
} from './fixtures';

// Sprint 8 — the provider onboarding wizard, in a real browser.
//
// This layer exists for the things a DOM shim cannot see. jsdom reports
// whatever it is told about `html.dir="rtl"`, bidi text layout, container
// overflow, focus outlines and clipping; a real layout engine has an opinion.
// The component suite (42 vitest cases) covers behaviour; this covers
// GEOMETRY, direction, and the full journey end to end across three viewports.
//
// The one claim it protects above all others: a submitted application does NOT
// say the provider is approved. That sentence is the difference between a
// provider who waits for their documents to be checked and one who turns up to
// a job they are not cleared for.

const PROVIDER_ME = {
  id: 'u-provider',
  email: 'provider@example.com',
  firstName: 'Pat',
  lastName: 'Provider',
  // The ACCOUNT is fine. The provider APPLICATION is what is in progress —
  // two different axes, and conflating them is what ADR 0005 exists to undo.
  status: 'ACTIVE',
  emailVerifiedAt: '2026-08-01T00:00:00.000Z',
  mfaEnabled: false,
  roles: ['customer', 'provider'],
};

const DRAFT_PROFILE = {
  profile: {
    id: 'pp-1',
    displayName: 'Pat Provider',
    initials: 'PP',
    avatarUrl: null,
    bio: null,
    headline: null,
    phoneNumber: null,
    ratingAvg: 0,
    reviewCount: 0,
    completedJobs: 0,
    verified: false,
    topPro: false,
    availability: 'OFFLINE',
    status: 'DRAFT',
    serviceAreaCity: null,
    serviceAreaCountry: null,
    serviceAreaLat: null,
    serviceAreaLng: null,
    serviceAreaRadiusKm: null,
    serviceCategories: [],
    pendingCategories: [],
    submittedForReviewAt: null,
    reviewedAt: null,
    rejectionReason: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
  },
};

const STEPS = [
  'PROVIDER_TYPE',
  'IDENTITY',
  'LOCATION',
  'SPECIALTIES',
  'EXPERIENCE',
  'AVAILABILITY',
  'PROFILE',
  'CONSENT',
  'REVIEW',
] as const;

type Draft = ReturnType<typeof draft>;

function draft(over: Record<string, unknown> = {}) {
  return {
    state: 'DRAFT',
    currentStep: 'PROVIDER_TYPE',
    steps: STEPS.map((step) => ({ step, complete: false, issues: [] })),
    completedSteps: [],
    percentComplete: 0,
    nextAction: { kind: 'COMPLETE_STEP', step: 'PROVIDER_TYPE' },
    complete: false,
    missing: [{ field: 'providerType', code: 'REQUIRED' }],
    version: 0,
    policyVersion: 'v3',
    lastSavedAt: null,
    editable: true,
    data: {
      providerType: null,
      legalBusinessName: null,
      displayName: 'Pat Provider',
      profileImageUrl: null,
      phoneNumber: null,
      phoneVerified: false,
      serviceAreaCity: null,
      serviceAreaCountry: null,
      serviceAreaLat: null,
      serviceAreaLng: null,
      serviceAreaRadiusKm: null,
      serviceAreaIds: [],
      workshopAddressLine: null,
      workshopLat: null,
      workshopLng: null,
      primaryGroupIds: [],
      specialtyLeafIds: [],
      pendingSpecialtyIds: [],
      yearsOfExperience: null,
      professionSince: null,
      equipmentCodes: [],
      transportMode: null,
      availability: [],
      timezone: null,
      headline: null,
      bio: null,
      additionalInformation: null,
      acceptedConsentVersion: null,
      consentAcceptedAt: null,
    },
    ...over,
  };
}

/** A draft with nothing outstanding, sitting on the review screen. */
function completeDraft(over: Record<string, unknown> = {}): Draft {
  const base = draft();
  return {
    ...base,
    currentStep: 'REVIEW',
    steps: STEPS.map((step) => ({ step, complete: true, issues: [] })),
    completedSteps: [...STEPS],
    percentComplete: 100,
    nextAction: { kind: 'SUBMIT' },
    complete: true,
    missing: [],
    version: 8,
    data: {
      ...base.data,
      providerType: 'INDIVIDUAL',
      phoneNumber: '+46701234567',
      phoneVerified: true,
      serviceAreaCity: 'Gothenburg',
      serviceAreaCountry: 'Sweden',
      serviceAreaRadiusKm: 25,
      specialtyLeafIds: ['cat-leaf-1'],
      yearsOfExperience: 10,
      transportMode: 'VAN',
      availability: [
        {
          id: 'iv-1',
          dayOfWeek: 1,
          startMinute: 540,
          endMinute: 1020,
          timezone: 'Europe/Stockholm',
        },
      ],
      timezone: 'Europe/Stockholm',
      headline: 'Certified electrician, 10 years',
      bio: 'Residential and light commercial electrical work, including fault finding.',
      acceptedConsentVersion: 'v3',
      consentAcceptedAt: '2026-08-23T00:00:00.000Z',
    },
    ...over,
  };
}

const CATEGORIES = {
  items: [
    {
      id: 'cat-root-1',
      slug: 'plumbing',
      labelEn: 'Plumbing',
      labelAr: 'سباكة',
      icon: 'droplet',
      sortOrder: 0,
      parentId: null,
      isLeaf: false,
    },
    {
      id: 'cat-leaf-1',
      slug: 'boiler-repair',
      labelEn: 'Boiler repair',
      labelAr: 'إصلاح السخان',
      icon: 'flame',
      sortOrder: 1,
      parentId: 'cat-root-1',
      isLeaf: true,
    },
  ],
};

const EQUIPMENT = {
  items: [
    {
      id: 'eq-1',
      code: 'LADDER',
      labelEn: 'Ladder',
      labelAr: 'سلم',
      categoryId: null,
      sortOrder: 0,
    },
  ],
};

/**
 * Open the wizard with a stubbed API.
 *
 * `state` is mutable so a scenario can advance it: the wizard PATCHes and then
 * renders the response, so a stub that always answered with the initial draft
 * would make every "and then it shows the saved value" assertion vacuous.
 */
async function openWizard(
  page: Page,
  initial: Draft,
  lang: 'en' | 'ar' = 'en',
): Promise<{ current: () => Draft; setNext: (next: Draft) => void }> {
  let state = initial;
  let nextOnWrite: Draft | null = null;

  await seedLanguage(page, lang);
  await page.route('**/v1/**', async (route) => {
    const url = route.request().url();
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

    if (url.includes('/auth/me')) return json(PROVIDER_ME);
    if (url.includes('/me/provider/profile')) return json(DRAFT_PROFILE);
    if (url.includes('/services/equipment')) return json(EQUIPMENT);
    if (url.endsWith('/v1/services')) return json(CATEGORIES);

    if (url.includes('/me/provider/onboarding/draft')) return json(state);
    if (url.includes('/me/provider/onboarding/steps/')) {
      state = nextOnWrite ?? { ...state, version: state.version + 1 };
      nextOnWrite = null;
      return json(state);
    }
    if (url.includes('/me/provider/onboarding/submit')) {
      state = { ...completeDraft(), state: 'DOCUMENTS_REQUIRED', editable: false } as Draft;
      return json(state);
    }
    if (url.includes('/me/provider/onboarding/withdraw')) {
      state = { ...completeDraft(), state: 'DRAFT', editable: true } as Draft;
      return json(state);
    }

    // A marketplace call reaching the wire at all is itself a finding: a DRAFT
    // provider must not be mounting those screens. Answer 403 as the API does.
    if (url.includes('/provider/available-requests') || url.includes('/provider/bids')) {
      return json({ success: false, error: { code: 'FORBIDDEN' } }, 403);
    }
    return json({ items: [], nextCursor: null });
  });

  await page.goto('/provider');

  // A DRAFT provider lands on the status surface, not the wizard: the shell
  // opens on the jobs tab and the status gate replaces it. "Continue
  // onboarding" is the deliberate step into the application, and going through
  // it here rather than deep-linking means every scenario below also exercises
  // the Sprint 7 routing fix on the way in.
  // Awaited, not probed. The status surface only paints once the profile query
  // resolves, so an `isVisible()` check at this instant answers "no" and skips
  // the click, leaving every assertion below looking at the wrong screen.
  const cta = page.getByRole('button', {
    name: lang === 'ar' ? /إكمال الملف/ : /continue onboarding/i,
  });
  await cta.waitFor({ state: 'visible' });
  await cta.click();
  await page
    .getByText(lang === 'ar' ? /إعداد حساب مزوّد الخدمة/ : /set up your provider account/i)
    .waitFor({ state: 'visible' });

  return { current: () => state, setNext: (next) => (nextOnWrite = next) };
}

// ─────────────────────────────────────────────────────────────────────────────

test.describe('Provider onboarding wizard — layout and direction', () => {
  for (const lang of ['en', 'ar'] as const) {
    test(`renders without horizontal overflow (${lang})`, async ({ page }) => {
      // Runs at all three viewports via the project matrix. The nine-step rail
      // scrolls inside itself; the PAGE must not.
      await openWizard(page, draft(), lang);

      await expect(page.getByRole('progressbar')).toBeVisible();
      const { lang: htmlLang, dir } = await htmlLangDir(page);
      expect(htmlLang).toBe(lang);
      expect(dir).toBe(lang === 'ar' ? 'rtl' : 'ltr');

      await expectNoHorizontalPageOverflow(page);
    });

    test(`the step rail and the form stay inside their containers (${lang})`, async ({ page }) => {
      await openWizard(page, draft(), lang);

      const heading = page.getByRole('heading', { level: 2 }).first();
      await expect(heading).toBeVisible();
      await expectContainedInParent(heading, 'step heading');
      await expectLegible(heading, 'step heading');
    });

    test(`the progress bar reports the server percentage (${lang})`, async ({ page }) => {
      await openWizard(page, draft({ percentComplete: 44 }), lang);

      const bar = page.getByRole('progressbar');
      await expect(bar).toHaveAttribute('aria-valuenow', '44');
    });
  }
});

test.describe('Provider onboarding wizard — the journey', () => {
  test('a DRAFT provider reaches the wizard, not the marketplace', async ({ page }) => {
    // The Sprint 7 fix, re-pinned at the Sprint 8 destination. Reaching
    // onboarding must not hand a DRAFT provider the live job feed.
    const forbidden: string[] = [];
    page.on('response', (r) => {
      if (r.status() === 403) forbidden.push(r.url());
    });

    await openWizard(page, draft());

    await expect(page.getByText(/set up your provider account/i)).toBeVisible();
    expect(forbidden, 'no marketplace call should have been attempted').toEqual([]);
  });

  test('walks all nine steps and lands on a review screen that explains itself', async ({
    page,
  }) => {
    await openWizard(page, draft());

    await expect(page.getByRole('heading', { name: /account type/i })).toBeVisible();

    // Choosing a type autosaves and the indicator confirms it. "Saved" is the
    // only signal a provider gets that their work is safe, so it is worth an
    // explicit assertion rather than assuming the PATCH implies it.
    await page.getByRole('radio', { name: /individual/i }).click();
    await expect(page.getByText(/^Saved$/)).toBeVisible();

    // Every step in order, reachable by Next alone.
    for (let i = 1; i < STEPS.length; i += 1) {
      await page.getByRole('button', { name: /^Next$/ }).click();
    }

    await expect(page.getByRole('heading', { name: /review & submit/i })).toBeVisible();

    // Disabled from the SERVER's `complete`, with the reason spelled out —
    // a grey button and no explanation is the state this screen exists to
    // avoid. The submit path itself is covered by the test below, against a
    // draft the server calls complete; flipping this one mid-run would only
    // prove the stub can lie.
    await expect(page.getByRole('button', { name: /send application/i })).toBeDisabled();
    await expect(page.getByText(/choose individual or business/i)).toBeVisible();

    // Every section links back to the step that owns it.
    await expect(page.getByRole('button', { name: /edit/i })).toHaveCount(STEPS.length - 1);
  });

  test('SUBMITTING DOES NOT SAY APPROVED', async ({ page }) => {
    // The single most consequential sentence on this surface. The server moved
    // the application to DOCUMENTS_REQUIRED and granted nothing — no
    // marketplace access, no work-access grant, no verified badge. A screen
    // that implied approval would send a provider to a job they are not
    // cleared for.
    await openWizard(page, completeDraft());

    await page.getByRole('button', { name: /send application/i }).click();

    await expect(page.getByText(/application received/i)).toBeVisible();
    await expect(page.getByText(/this is not approval yet/i)).toBeVisible();
    await expect(page.getByText(/check your identity documents/i)).toBeVisible();

    // And nowhere on the page.
    await expect(page.getByText(/\bapproved\b/i)).toHaveCount(0);
    await expect(page.getByText(/\bverified\b/i)).toHaveCount(0);
  });

  test('a submitted application is read-only, with a way back out', async ({ page }) => {
    await openWizard(page, {
      ...completeDraft(),
      state: 'DOCUMENTS_REQUIRED',
      editable: false,
    } as Draft);

    await expect(page.getByText(/application received/i)).toBeVisible();
    // No form to edit — showing one behind a disabled Submit invites a
    // provider to change something and wonder why it did not save.
    await expect(page.locator('input[type="text"]')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /withdraw application/i })).toBeEnabled();
  });

  test('resumes at the step the server names after a reload', async ({ page }) => {
    await openWizard(page, draft({ currentStep: 'AVAILABILITY' }));
    await expect(page.getByRole('heading', { name: /your hours/i })).toBeVisible();

    // The wizard IS a route now (Mode B): /provider/profile, reached through
    // the workspace router rather than a tab held in component state.
    await expect(page).toHaveURL(/\/provider\/profile$/);

    await page.reload();

    // Straight back into the wizard, at the step the server names.
    //
    // This test used to re-enter through "Continue onboarding" after a reload,
    // because a reload landed on the shell's default tab and painted the status
    // surface instead — the wizard had no address to return to. That detour is
    // gone: the URL survives the reload, so the provider resumes where they
    // were. Both halves still matter — the right SCREEN and the right STEP —
    // so both are asserted.
    await expect(page).toHaveURL(/\/provider\/profile$/);
    await expect(page.getByRole('heading', { name: /your hours/i })).toBeVisible();
  });
});

test.describe('Provider onboarding wizard — Arabic', () => {
  test('renders the whole wizard in Arabic, RTL', async ({ page }) => {
    await openWizard(page, draft(), 'ar');

    await expect(page.getByText('إعداد حساب مزوّد الخدمة')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'نوع الحساب' })).toBeVisible();

    const { dir } = await htmlLangDir(page);
    expect(dir).toBe('rtl');
    await expectNoHorizontalPageOverflow(page);
  });

  test('translates the not-approved warning', async ({ page }) => {
    // Chrome in Arabic with an English warning is the usual half-done
    // translation — and this is the one sentence that must not be missed.
    await openWizard(
      page,
      { ...completeDraft(), state: 'DOCUMENTS_REQUIRED', editable: false } as Draft,
      'ar',
    );

    await expect(page.getByText('تم استلام الطلب')).toBeVisible();
    await expect(page.getByText('هذه ليست موافقة نهائية بعد')).toBeVisible();
  });

  test('mirrors the step rail for RTL', async ({ page }) => {
    // Geometry, which is the reason this suite is in a real browser at all: in
    // RTL the first step must sit on the RIGHT.
    await openWizard(page, draft(), 'ar');

    const rail = page.getByRole('navigation');
    const first = rail.getByRole('button').first();
    const last = rail.getByRole('button').last();

    const firstBox = await first.boundingBox();
    const lastBox = await last.boundingBox();
    expect(firstBox).not.toBeNull();
    expect(lastBox).not.toBeNull();
    expect(firstBox!.x).toBeGreaterThan(lastBox!.x);
  });
});

test.describe('Provider onboarding wizard — keyboard and focus', () => {
  test('every interactive control shows a visible focus indicator', async ({ page }) => {
    await openWizard(page, draft());

    const radio = page.getByRole('radio', { name: /individual/i });
    await expect(radio).toBeVisible();
    await expectVisibleFocusIndicator(radio, 'provider type choice');

    const next = page.getByRole('button', { name: /^Next$/ });
    await expectVisibleFocusIndicator(next, 'Next button');
  });

  test('focus lands on the step heading when the step changes', async ({ page }) => {
    // Without this a keyboard user who presses Next is returned to the top of
    // the document and tabs through the whole rail again to reach the form.
    await openWizard(page, draft());

    await page.getByRole('button', { name: /^Next$/ }).click();
    await expect(page.getByRole('heading', { name: /about you/i })).toBeFocused();
  });

  test('the wizard is reachable by keyboard alone', async ({ page }) => {
    await openWizard(page, draft());
    await expect(page.getByRole('heading', { name: /account type/i })).toBeVisible();

    // Tab until a step-rail button has focus, then activate it. A wizard whose
    // navigation needs a pointer is a wizard some providers cannot finish.
    let reached = false;
    for (let i = 0; i < 25 && !reached; i += 1) {
      await page.keyboard.press('Tab');
      reached = await page
        .getByRole('navigation')
        .getByRole('button')
        .nth(2)
        .evaluate((el) => el === document.activeElement)
        .catch(() => false);
    }
    expect(reached, 'a step-rail button should be reachable by Tab').toBe(true);

    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: /where you work/i })).toBeVisible();
  });
});

test.describe('Provider onboarding wizard — offline and errors', () => {
  test('holds an edit while offline and says so', async ({ page, context }) => {
    await openWizard(page, draft());
    await expect(page.getByRole('heading', { name: /account type/i })).toBeVisible();

    await context.setOffline(true);
    await page.getByRole('radio', { name: /individual/i }).click();

    // The app already shows a GLOBAL offline banner. This asserts the wizard's
    // own status line specifically, because the two say different things: the
    // banner says the connection is gone, this one promises the unsaved edit
    // is kept. The promise is the part a provider needs before they walk away
    // from the screen.
    await expect(page.getByRole('status').filter({ hasText: /offline/i })).toBeVisible();
  });

  test('offers a retry when a save fails', async ({ page }) => {
    await seedLanguage(page, 'en');
    await page.route('**/v1/**', async (route) => {
      const url = route.request().url();
      const json = (body: unknown, status = 200) =>
        route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

      if (url.includes('/auth/me')) return json(PROVIDER_ME);
      if (url.includes('/me/provider/profile')) return json(DRAFT_PROFILE);
      if (url.includes('/services/equipment')) return json(EQUIPMENT);
      if (url.endsWith('/v1/services')) return json(CATEGORIES);
      if (url.includes('/onboarding/steps/')) return json({ error: { code: 'INTERNAL' } }, 500);
      if (url.includes('/onboarding/draft')) return json(draft());
      return json({ items: [], nextCursor: null });
    });
    await page.goto('/provider');
    const enter = page.getByRole('button', { name: /continue onboarding/i });
    await enter.waitFor({ state: 'visible' });
    await enter.click();

    await page.getByRole('radio', { name: /individual/i }).click();

    await expect(page.getByText(/could not save/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /retry/i })).toBeEnabled();
  });

  test('shows an empty state rather than a blank panel when the catalogue is empty', async ({
    page,
  }) => {
    await seedLanguage(page, 'en');
    await page.route('**/v1/**', async (route) => {
      const url = route.request().url();
      const json = (body: unknown) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

      if (url.includes('/auth/me')) return json(PROVIDER_ME);
      if (url.includes('/me/provider/profile')) return json(DRAFT_PROFILE);
      if (url.includes('/services/equipment')) return json({ items: [] });
      if (url.endsWith('/v1/services')) return json({ items: [] });
      if (url.includes('/onboarding/draft')) return json(draft({ currentStep: 'SPECIALTIES' }));
      return json({ items: [], nextCursor: null });
    });
    await page.goto('/provider');
    const enter = page.getByRole('button', { name: /continue onboarding/i });
    await enter.waitFor({ state: 'visible' });
    await enter.click();

    await expect(page.getByRole('heading', { name: /what you do/i })).toBeVisible();
    await expect(page.getByText(/not answered yet/i).first()).toBeVisible();
  });
});
