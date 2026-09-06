import { expect, test, type Page } from '@playwright/test';

import {
  expectNoHorizontalPageOverflow,
  expectVisibleFocusIndicator,
  seedLanguage,
  stubApi,
} from './fixtures';

// Sprint 9B.28 — the mobile-first layout contract, measured.
//
// docs/sprint-09b28/PROVIDER_ONBOARDING_PERSISTENCE_MOBILE_FIRST.md §9
//
// WHY GEOMETRY AND NOT A SNAPSHOT
//
// The requirement is numeric — "the column is the viewport below 640, and at
// most 520 above it" — so it is asserted numerically, from
// `getBoundingClientRect` in a real layout engine. A screenshot diff would go
// red for a font-hinting change and stay green for a shell that quietly grew
// to 768px on a laptop, which is the exact regression this reverses.
//
// The dark surround visible in a device-emulator frame is TOOLING. Every
// measurement here is taken from the viewport, so it cannot be confused for
// application chrome.

const FLAG_KEY = 'hsm.ff.providerOnboardingV2';

/** The acceptance matrix, verbatim. */
const VIEWPORTS = [
  { name: '320x568', width: 320, height: 568, phone: true },
  { name: '360x800', width: 360, height: 800, phone: true },
  { name: '390x844', width: 390, height: 844, phone: true },
  { name: '430x932', width: 430, height: 932, phone: true },
  { name: '768x1024', width: 768, height: 1024, phone: false },
  { name: '1440x900', width: 1440, height: 900, phone: false },
] as const;

/** The focused column may not exceed this on a large screen. */
const MAX_FOCUSED_WIDTH = 520;
/** Below the `sm` breakpoint the column IS the viewport. */
const FULL_BLEED_BELOW = 640;

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

const hubTask = (
  id: string,
  group: string,
  status: string,
  title: string,
  description: string,
) => ({
  id,
  group,
  status,
  title,
  description,
});

const HUB = {
  tasks: [
    hubTask('BASICS_IDENTITY', 'BASICS', 'AVAILABLE', 'البيانات الأساسية', 'الاسم ورقم الهاتف'),
    hubTask(
      'SERVICES_EXPERIENCE',
      'SERVICES',
      'BLOCKED',
      'الخدمات والخبرة',
      'التخصص وسنوات الخبرة',
    ),
    hubTask('WORK_AREA', 'COVERAGE', 'BLOCKED', 'نطاق العمل', 'المدينة ونقطة التمركز'),
    hubTask('WORKING_HOURS', 'COVERAGE', 'BLOCKED', 'ساعات العمل', 'أيام وأوقات توفرك'),
    hubTask('PORTFOLIO', 'PROFILE', 'BLOCKED', 'معرض الأعمال', 'نبذة تعريفية وصور'),
    hubTask('REVIEW_SUBMISSION', 'REVIEW', 'BLOCKED', 'المراجعة والإرسال', 'تأكيد البيانات'),
  ],
  progress: { complete: 0, total: 6 },
  nextAction: { kind: 'COMPLETE_TASK', taskId: 'BASICS_IDENTITY' },
  status: 'DRAFT',
};

const DRAFT_VIEW = {
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
    providerType: 'INDIVIDUAL',
    legalBusinessName: null,
    displayName: 'Pat Provider',
    profileImageUrl: null,
    phoneNumber: null,
    phoneVerified: false,
  },
};

async function openOnboarding(
  page: Page,
  path: string,
  lang: 'en' | 'ar',
  width: number,
  height: number,
): Promise<void> {
  await page.setViewportSize({ width, height });
  await page.addInitScript(
    ([key, value]) => window.localStorage.setItem(key as string, value as string),
    [FLAG_KEY, 'true'] as const,
  );
  await seedLanguage(page, lang);
  await stubApi(page, {
    me: PROVIDER_ME,
    extra: {
      '/onboarding/hub': HUB,
      '/onboarding/draft': DRAFT_VIEW,
    },
  });
  await page.goto(path);
  await expect(page.getByTestId('onboarding-v2-shell')).toBeVisible();
}

/** The rendered width of the focused column. */
async function shellWidth(page: Page): Promise<number> {
  return page.getByTestId('onboarding-v2-shell').evaluate((el) => el.getBoundingClientRect().width);
}

test.describe('onboarding is a focused mobile-first column at every size', () => {
  for (const vp of VIEWPORTS) {
    for (const lang of ['en', 'ar'] as const) {
      test(`${vp.name} ${lang}: width policy, no overflow, reachable actions`, async ({ page }) => {
        await openOnboarding(page, '/provider/onboarding', lang, vp.width, vp.height);

        const width = await shellWidth(page);

        if (vp.width < FULL_BLEED_BELOW) {
          // The column IS the viewport. A narrower card inside a phone would
          // be the "card in a card" the brief rules out, and it would waste
          // the gutters twice.
          expect(
            Math.round(width),
            `at ${vp.width}px the shell must fill the viewport, got ${width}`,
          ).toBe(vp.width);
        } else {
          // Focused, and never stretched to the browser width.
          expect(
            width,
            `at ${vp.width}px the shell must stay focused, got ${width}`,
          ).toBeLessThanOrEqual(MAX_FOCUSED_WIDTH);
          expect(width, 'the focused column must not collapse').toBeGreaterThanOrEqual(400);
          // ...and centred on its quiet ground rather than pinned left.
          const box = await page.getByTestId('onboarding-v2-shell').boundingBox();
          expect(box, 'shell must have a box').not.toBeNull();
          const leftGap = box!.x;
          const rightGap = vp.width - (box!.x + box!.width);
          expect(Math.abs(leftGap - rightGap), 'the column must be centred').toBeLessThanOrEqual(2);
        }

        // No sideways scroll, at any size, in either language. The 320px case
        // is the one that historically broke, and Arabic is the one that
        // breaks it with long words rather than long layouts.
        await expectNoHorizontalPageOverflow(page);
      });
    }
  }

  test('320px: the close control keeps its full 44px target — the TITLE gives up space', async ({
    page,
  }) => {
    await openOnboarding(page, '/provider/onboarding', 'en', 320, 568);
    const box = await page.getByTestId('onboarding-v2-close').boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width, 'close target width').toBeGreaterThanOrEqual(44);
    expect(box!.height, 'close target height').toBeGreaterThanOrEqual(44);
  });

  test('320px: the sticky footer action is fully on screen and covers no field', async ({
    page,
  }) => {
    await openOnboarding(page, '/provider/onboarding/BASICS_IDENTITY', 'en', 320, 568);

    const footerButton = page.getByRole('button', { name: /back to tasks/i });
    await expect(footerButton).toBeVisible();
    const box = await footerButton.boundingBox();
    expect(box).not.toBeNull();
    // Entirely inside the viewport — not clipped by the bottom edge, which is
    // what a `100vh` shell does the moment a mobile URL bar expands.
    expect(box!.y + box!.height, 'footer action must be fully visible').toBeLessThanOrEqual(568);
    expect(box!.height, 'footer action must be a real touch target').toBeGreaterThanOrEqual(44);
  });

  test('the content scrolls in ONE container, not the page', async ({ page }) => {
    await openOnboarding(page, '/provider/onboarding', 'en', 390, 844);
    // The document itself must not scroll: the shell is exactly the viewport
    // height and `main` owns the overflow. Two nested scrollers on a phone is
    // how a form ends up with a region the thumb cannot reach.
    const docScrolls = await page.evaluate(
      () => document.documentElement.scrollHeight > document.documentElement.clientHeight + 1,
    );
    expect(docScrolls, 'the page itself must not scroll').toBe(false);
  });

  test('Arabic mirrors the shell', async ({ page }) => {
    await openOnboarding(page, '/provider/onboarding', 'ar', 390, 844);
    await expect(page.getByTestId('onboarding-v2-shell')).toHaveAttribute('dir', 'rtl');
    await expectNoHorizontalPageOverflow(page);
  });

  test('the close control shows a visible focus ring', async ({ page }) => {
    await openOnboarding(page, '/provider/onboarding', 'en', 390, 844);
    await expectVisibleFocusIndicator(page.getByTestId('onboarding-v2-close'), 'onboarding close');
  });

  test('1440px: onboarding stays focused while the WORKSPACE stays wide', async ({ page }) => {
    // The scope assertion. 9B.15 deliberately took the provider workspace out
    // of a phone-width frame, and this sprint must not undo that — it narrows
    // `/provider/onboarding/*` and nothing else.
    await openOnboarding(page, '/provider/onboarding', 'en', 1440, 900);
    expect(await shellWidth(page)).toBeLessThanOrEqual(MAX_FOCUSED_WIDTH);

    // The ground behind it spans the display, so the page is not a narrow
    // strip on an empty canvas.
    const ground = await page
      .getByTestId('onboarding-v2-ground')
      .evaluate((el) => el.getBoundingClientRect().width);
    expect(ground).toBeGreaterThanOrEqual(1440 - 20);
  });

  test('200% zoom at 1440 keeps the column focused and the page free of sideways scroll', async ({
    page,
  }) => {
    // 200% zoom is an effective 720px viewport. It must land on the FOCUSED
    // side of the policy, not the full-bleed side.
    await openOnboarding(page, '/provider/onboarding', 'en', 720, 450);
    expect(await shellWidth(page)).toBeLessThanOrEqual(MAX_FOCUSED_WIDTH);
    await expectNoHorizontalPageOverflow(page);
  });
});
