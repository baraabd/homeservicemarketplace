import { expect, test, type Page } from '@playwright/test';

import {
  expectNoHorizontalPageOverflow,
  expectVisibleFocusIndicator,
  htmlLangDir,
  seedLanguage,
  stubApi,
} from './fixtures';

// Sprint 9B.16 — the full-screen shell and the hub, in a real browser.
//
// The component suite proves behaviour. This proves the things a DOM shim
// cannot see and the acceptance criteria are written in terms of: geometry at
// 320px, touch-target size, focus visibility, bidi layout, and what survives a
// reload. It also proves the flag in the only way that counts — by loading the
// built bundle with it off and watching the route refuse to exist.

const FLAG_KEY = 'hsm.ff.providerOnboardingV2';

const PROVIDER_ME = {
  id: 'u-provider',
  email: 'provider@example.com',
  firstName: 'Pat',
  lastName: 'Provider',
  // The ACCOUNT is fine; the APPLICATION is what is unfinished. Two axes.
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

/** The canonical 9B.15 response. */
const HUB = {
  tasks: [
    {
      id: 'BASICS_IDENTITY',
      group: 'BASICS',
      status: 'AVAILABLE',
      title: 'البيانات الأساسية',
      description: 'الاسم، رقم الهاتف، والصورة الشخصية',
    },
    {
      id: 'SERVICES_EXPERIENCE',
      group: 'SERVICES',
      status: 'BLOCKED',
      title: 'الخدمات والخبرة',
      description: 'التخصص، سنوات الخبرة، ووسيلة النقل',
    },
    {
      id: 'WORK_AREA',
      group: 'COVERAGE',
      status: 'BLOCKED',
      title: 'نطاق العمل',
      description: 'المدينة ونقطة التمركز الخاصة بك',
    },
    {
      id: 'WORKING_HOURS',
      group: 'COVERAGE',
      status: 'BLOCKED',
      title: 'ساعات العمل',
      description: 'أيام وأوقات توفرك لاستقبال الطلبات',
    },
    {
      id: 'PORTFOLIO',
      group: 'PROFILE',
      status: 'BLOCKED',
      title: 'معرض الأعمال',
      description: 'نبذة تعريفية وصور من أعمالك السابقة',
    },
    {
      id: 'REVIEW_SUBMISSION',
      group: 'REVIEW',
      status: 'BLOCKED',
      title: 'المراجعة والإرسال',
      description: 'تأكيد البيانات والموافقة على الشروط',
    },
  ],
  progress: { complete: 0, total: 6 },
  nextAction: { kind: 'COMPLETE_TASK', taskId: 'BASICS_IDENTITY' },
  status: 'DRAFT',
};

/** Seed the flag before the app boots — the same mechanism seedLanguage uses.
 *  The flag is otherwise fixed at BUILD time, and both states have to be
 *  provable against the one bundle this suite builds. */
async function seedFlag(page: Page, on: boolean): Promise<void> {
  await page.addInitScript(
    ([key, value]) => window.localStorage.setItem(key as string, value as string),
    [FLAG_KEY, on ? 'true' : 'false'],
  );
}

/** Sprint 9B.17 — BASICS_IDENTITY now renders a real form, which reads the
 *  onboarding DRAFT. Without this the task route would get the catch-all
 *  `{items: []}` and render its load-failure state, and the resume tests below
 *  would be asserting against a broken screen rather than a working one. */
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
    providerType: null,
    legalBusinessName: null,
    displayName: 'Pat Provider',
    profileImageUrl: null,
    phoneNumber: null,
  },
};

async function stubProvider(
  page: Page,
  hub: unknown = HUB,
  over: { profile?: unknown; draft?: unknown } = {},
): Promise<void> {
  await stubApi(page, {
    me: PROVIDER_ME,
    extra: {
      '/me/provider/onboarding/hub': hub,
      '/me/provider/onboarding/draft': over.draft ?? DRAFT_VIEW,
      '/me/provider/profile': over.profile ?? DRAFT_PROFILE,
    },
  });
}

/** A returned application: the operator's note lives on the PROFILE. */
const RETURNED_PROFILE = (rejectionReason: string | null) => ({
  profile: { ...DRAFT_PROFILE.profile, status: 'REJECTED', rejectionReason },
});

/** The hub of a returned application: five tasks done, one sent back. */
const RETURNED_HUB = (taskId: string | null = 'BASICS_IDENTITY') => ({
  ...HUB,
  tasks: HUB.tasks.map((t) =>
    t.id === taskId ? { ...t, status: 'AVAILABLE' } : { ...t, status: 'COMPLETE' },
  ),
  progress: { complete: 5, total: 6 },
  nextAction: taskId ? { kind: 'COMPLETE_TASK', taskId } : { kind: 'NONE' },
  status: 'ACTION_REQUIRED',
});

async function openHub(page: Page, opts: { lang?: 'en' | 'ar'; hub?: unknown } = {}) {
  await seedFlag(page, true);
  await seedLanguage(page, opts.lang ?? 'en');
  await stubProvider(page, opts.hub ?? HUB);
  await page.goto('/provider/onboarding');
  await expect(page.getByTestId('hub-task-list')).toBeVisible();
}

// The two widths the criteria name: the narrowest phone still in use, and an
// ordinary modern one.
const PHONES = [
  { name: 'narrow phone (320px)', width: 320, height: 640 },
  { name: 'wider phone (430px)', width: 430, height: 932 },
];

test.describe('onboarding v2 — the full-screen shell', () => {
  for (const phone of PHONES) {
    test(`${phone.name}: no horizontal overflow, and the header does not overlap`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: phone.width, height: phone.height });
      await openHub(page);

      await expectNoHorizontalPageOverflow(page);

      // The title and the progress line are stacked, never on top of each
      // other. This is the "overlapping header/progress" criterion, measured.
      const title = page.getByRole('heading', { level: 1 });
      const progress = page.getByTestId('onboarding-v2-progress');
      const titleBox = (await title.boundingBox())!;
      const progressBox = (await progress.boundingBox())!;
      expect(
        progressBox.y,
        'progress line overlaps the title instead of sitting under it',
      ).toBeGreaterThanOrEqual(titleBox.y + titleBox.height - 1);
    });

    test(`${phone.name}: every control clears 44x44`, async ({ page }) => {
      await page.setViewportSize({ width: phone.width, height: phone.height });
      await openHub(page);

      const controls = [
        page.getByTestId('onboarding-v2-close'),
        page.getByTestId('task-row-BASICS_IDENTITY'),
        // The approved hub action names its destination — "Start: <section>"
        // — so the section of the task the SERVER nominated is in the label.
        page.getByRole('button', { name: 'Start: Basics' }),
      ];
      for (const control of controls) {
        const box = (await control.boundingBox())!;
        expect(box.width, 'touch target too narrow').toBeGreaterThanOrEqual(44);
        expect(box.height, 'touch target too short').toBeGreaterThanOrEqual(44);
      }
    });

    test(`${phone.name}: task rows stack, they are not a chip cloud`, async ({ page }) => {
      await page.setViewportSize({ width: phone.width, height: phone.height });
      await openHub(page);

      // Each row starts below the previous one. Wrapped inline chips would
      // share a row and fail this.
      const rows = page.locator('[data-testid^="task-row-"]');
      const count = await rows.count();
      expect(count).toBe(6);

      let previousBottom = -1;
      for (let i = 0; i < count; i += 1) {
        const box = (await rows.nth(i).boundingBox())!;
        expect(box.y, `row ${i} shares a line with the row above`).toBeGreaterThanOrEqual(
          previousBottom - 1,
        );
        previousBottom = box.y + box.height;
      }
    });
  }

  test('renders no bottom application navigation', async ({ page }) => {
    await openHub(page);

    // The provider tab bar, by its labels. None of them belongs on a form.
    //
    // Checked without naming a role. The workspace nav became LINKS in Mode B,
    // and an assertion that only looked for buttons would have gone on passing
    // for the wrong reason — it would report "no bottom nav" just as happily if
    // the whole bar were rendered here as links. The nav's own test id is
    // checked too, so this fails if the bar returns under any markup.
    for (const label of ['Jobs', 'My Bids', 'Chat', 'Wallet']) {
      await expect(page.getByText(label, { exact: true })).toHaveCount(0);
    }
    await expect(page.getByTestId('provider-bottom-nav')).toHaveCount(0);
  });

  test('the close control returns to the provider surface', async ({ page }) => {
    await openHub(page);
    await page.getByTestId('onboarding-v2-close').click();
    await expect(page).toHaveURL(/\/provider\/status$/);
  });
});

test.describe('onboarding v2 — the hub', () => {
  test('shows the six server tasks and the server progress count', async ({ page }) => {
    await openHub(page);

    await expect(page.locator('[data-testid^="task-row-"]')).toHaveCount(6);
    await expect(page.getByTestId('onboarding-v2-progress')).toHaveText('0 of 6 tasks complete');
  });

  test('renders the server count rather than counting the rows', async ({ page }) => {
    const tasks = HUB.tasks.map((t, i) => (i === 0 ? { ...t, status: 'COMPLETE' } : t));
    await openHub(page, { hub: { ...HUB, tasks, progress: { complete: 3, total: 6 } } });

    // One row reads COMPLETE; the server says three. The server wins.
    await expect(page.getByTestId('onboarding-v2-progress')).toHaveText('3 of 6 tasks complete');
  });

  test('only the available row is a button; blocked rows explain themselves', async ({ page }) => {
    await openHub(page);

    await expect(page.getByTestId('task-row-BASICS_IDENTITY')).toHaveAttribute(
      'data-actionable',
      'true',
    );
    const blocked = page.getByTestId('task-row-WORK_AREA');
    await expect(blocked).toHaveAttribute('data-actionable', 'false');
    await expect(page.getByTestId('task-explanation-WORK_AREA')).toBeVisible();
    // Not a button at all — not even a disabled one.
    await expect(blocked.locator('button')).toHaveCount(0);
  });
});

test.describe('onboarding v2 — keyboard', () => {
  test('the close control and the available row are focusable and show focus', async ({ page }) => {
    await openHub(page);

    await expectVisibleFocusIndicator(page.getByTestId('onboarding-v2-close'), 'close control');
    await expectVisibleFocusIndicator(
      page.getByTestId('task-row-BASICS_IDENTITY'),
      'available task row',
    );
  });

  test('a blocked row is not in the tab order', async ({ page }) => {
    await openHub(page);

    // Tab through the whole screen and collect what takes focus. A row the
    // provider cannot act on must never be a stop on that journey.
    const focused = new Set<string>();
    for (let i = 0; i < 12; i += 1) {
      await page.keyboard.press('Tab');
      const id = await page.evaluate(
        () => (document.activeElement as HTMLElement | null)?.dataset?.testid ?? '',
      );
      if (id) focused.add(id);
    }
    expect(focused.has('task-row-BASICS_IDENTITY')).toBe(true);
    expect(focused.has('task-row-WORK_AREA')).toBe(false);
  });

  test('the available row opens its task with the keyboard alone', async ({ page }) => {
    await openHub(page);

    await page.getByTestId('task-row-BASICS_IDENTITY').focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/provider\/onboarding\/BASICS_IDENTITY$/);
  });
});

test.describe('onboarding v2 — resume', () => {
  test('the CTA opens the task the server named', async ({ page }) => {
    await openHub(page);
    await page.getByRole('button', { name: 'Start: Basics' }).click();
    await expect(page).toHaveURL(/\/provider\/onboarding\/BASICS_IDENTITY$/);
  });

  test('a reload returns to the SAME task, not to the hub', async ({ page }) => {
    await openHub(page);
    await page.getByTestId('task-row-BASICS_IDENTITY').click();
    await expect(page.getByTestId('task-screen-BASICS_IDENTITY')).toBeVisible();

    await page.reload();
    await expect(page.getByTestId('task-screen-BASICS_IDENTITY')).toBeVisible();
    await expect(page).toHaveURL(/\/provider\/onboarding\/BASICS_IDENTITY$/);
  });

  test('browser back returns from a task to the hub', async ({ page }) => {
    await openHub(page);
    await page.getByTestId('task-row-BASICS_IDENTITY').click();
    await expect(page.getByTestId('task-screen-BASICS_IDENTITY')).toBeVisible();

    await page.goBack();
    await expect(page.getByTestId('hub-task-list')).toBeVisible();
    await expect(page).toHaveURL(/\/provider\/onboarding$/);
  });

  test('a task the server says is blocked cannot be entered by URL', async ({ page }) => {
    await seedFlag(page, true);
    await seedLanguage(page, 'en');
    await stubProvider(page);
    await page.goto('/provider/onboarding/WORK_AREA');

    await expect(page.getByTestId('task-screen-blocked')).toBeVisible();
    await expect(page.getByTestId('task-screen-pending')).toHaveCount(0);
  });
});

test.describe('onboarding v2 — language parity', () => {
  test('English reader gets English prose in an LTR document', async ({ page }) => {
    await openHub(page, { lang: 'en' });

    expect(await htmlLangDir(page)).toEqual({ lang: 'en', dir: 'ltr' });
    // Scoped to the row rather than the page: the title text lives in a span
    // INSIDE the row button, so a bare getByText matches both and trips
    // strict mode. What is being asserted is that the row reads in English.
    await expect(page.getByTestId('task-row-BASICS_IDENTITY')).toContainText('Basic details');
    // The server sent Arabic titles; an English reader must not see them.
    await expect(page.getByText('البيانات الأساسية')).toHaveCount(0);
    await expectNoHorizontalPageOverflow(page);
  });

  test('Arabic reader gets Arabic prose in an RTL document', async ({ page }) => {
    await openHub(page, { lang: 'ar' });

    expect(await htmlLangDir(page)).toEqual({ lang: 'ar', dir: 'rtl' });
    await expect(page.getByTestId('task-row-BASICS_IDENTITY')).toContainText('البيانات الأساسية');
    // And no English leaked into the Arabic render.
    await expect(page.getByTestId('task-row-BASICS_IDENTITY')).not.toContainText('Your details');
    await expectNoHorizontalPageOverflow(page);
  });

  test('the shell mirrors: the close control moves to the other side in RTL', async ({ page }) => {
    await page.setViewportSize({ width: 430, height: 932 });

    await openHub(page, { lang: 'en' });
    const ltrBox = (await page.getByTestId('onboarding-v2-close').boundingBox())!;
    const ltrShell = (await page.getByTestId('onboarding-v2-shell').boundingBox())!;

    await openHub(page, { lang: 'ar' });
    const rtlBox = (await page.getByTestId('onboarding-v2-close').boundingBox())!;
    const rtlShell = (await page.getByTestId('onboarding-v2-shell').boundingBox())!;

    // Near the start edge in both, which is opposite sides of the shell.
    expect(ltrBox.x - ltrShell.x, 'close should hug the left edge in LTR').toBeLessThan(24);
    expect(
      rtlShell.x + rtlShell.width - (rtlBox.x + rtlBox.width),
      'close should hug the right edge in RTL',
    ).toBeLessThan(24);
  });
});

test.describe('onboarding v2 — states', () => {
  test('submitted: no task list, and no claim of approval', async ({ page }) => {
    await seedFlag(page, true);
    await seedLanguage(page, 'en');
    await stubProvider(page, { ...HUB, status: 'SUBMITTED' });
    await page.goto('/provider/onboarding');

    await expect(page.getByTestId('hub-state-SUBMITTED')).toBeVisible();
    await expect(page.getByTestId('hub-task-list')).toHaveCount(0);
    // The sentence a provider acts on: submitted is not approved.
    await expect(page.getByText(/approved/i)).toHaveCount(0);
  });

  // Sprint 09B.29 Phase 5A — SUPERSEDED, and recorded rather than removed.
  //
  // This asserted `hub-state-ACTION_REQUIRED` — a notice drawn ABOVE the full
  // task list — on the reasoning that a banner is only useful if the provider
  // can act on it. The approved design answers that worry better and the
  // assertion moved with it: the screen names the ONE task the server flagged
  // and puts a button on it, rather than asking a provider to find their own
  // problem among five rows that are already done.
  //
  // What follows is STRICTER than what it replaces. The old test proved a
  // banner and a list existed. These prove the reason is readable, the button
  // reaches the right task, the provider's saved answers are still there when
  // it opens, the screen does not invent a submit the server has not offered,
  // and — the part that makes the rest mean anything — that a broken deep link
  // is detected instead of rendered as a dead control.
  test('action required: the reason is readable and names the task to fix', async ({ page }) => {
    await seedFlag(page, true);
    await seedLanguage(page, 'en');
    await stubProvider(page, RETURNED_HUB(), {
      profile: RETURNED_PROFILE('Replace the first work photo. The photo is unclear.'),
    });
    await page.goto('/provider/onboarding');

    const screen = page.getByTestId('onboarding-returned');
    await expect(screen).toBeVisible();

    // Both halves of the operator's note, in the two places the approved
    // screen puts them. A heading with no detail would lose the WHY.
    await expect(page.getByTestId('returned-reason')).toContainText('Replace the first work photo');
    await expect(page.getByTestId('returned-reason')).toContainText('The photo is unclear.');
    await expect(page.getByTestId('returned-todo')).toBeVisible();

    // Named, not "Complete now": the provider is being sent somewhere specific.
    const fix = page.getByTestId('returned-complete-now');
    await expect(fix).toBeVisible();
    await expect(fix).toContainText('Basic details');

    // The finished checklist is gone; the way to the flagged task is not.
    await expect(page.getByTestId('hub-task-list')).toHaveCount(0);
  });

  test("action required: the flagged task opens with the provider's data intact", async ({
    page,
  }) => {
    await seedFlag(page, true);
    await seedLanguage(page, 'en');
    await stubProvider(page, RETURNED_HUB(), {
      profile: RETURNED_PROFILE('Check the name customers will see.'),
    });
    await page.goto('/provider/onboarding');

    await page.getByTestId('returned-complete-now').click();

    // The router actually arrives...
    await expect(page).toHaveURL(/\/provider\/onboarding\/BASICS_IDENTITY$/);
    // ...and the task hydrates from the draft rather than opening blank. A
    // returned application that lost the provider's answers on the way to the
    // fix is the failure this guards.
    await expect(page.getByTestId('field-displayName')).toHaveValue('Pat Provider');
  });

  test('action required: no submit is offered while the server still wants a task', async ({
    page,
  }) => {
    await seedFlag(page, true);
    await seedLanguage(page, 'en');
    await stubProvider(page, RETURNED_HUB(), {
      profile: RETURNED_PROFILE('Check the name customers will see.'),
    });
    await page.goto('/provider/onboarding');
    await expect(page.getByTestId('onboarding-returned')).toBeVisible();

    // Readiness is the SERVER's. Its nextAction is COMPLETE_TASK, so the one
    // dominant action leads to that task — it does not offer to resubmit an
    // application the server has not said is ready.
    const primary = page.getByTestId('hub-primary-action');
    await expect(primary).toBeVisible();
    await expect(primary).not.toContainText(/submit/i);
  });

  // THE SENSITIVITY PROOF. Without this the three tests above could all pass
  // against a screen that renders a button unconditionally: they only ever ask
  // for a flagged task that exists. Here the server names a task that is NOT in
  // the list, which is the shape of a stale deep link, and the screen must
  // decline to draw a control that would lead nowhere.
  test('action required: a deep link to a task the hub is not showing is not drawn', async ({
    page,
  }) => {
    await seedFlag(page, true);
    await seedLanguage(page, 'en');
    await stubProvider(
      page,
      { ...RETURNED_HUB(), nextAction: { kind: 'COMPLETE_TASK', taskId: 'NOT_A_TASK' } },
      { profile: RETURNED_PROFILE('Something needs attention.') },
    );
    await page.goto('/provider/onboarding');

    await expect(page.getByTestId('onboarding-returned')).toBeVisible();
    // The reason still shows — the provider is still told what is wrong.
    await expect(page.getByTestId('returned-reason')).toBeVisible();
    // The button does not, because there is nowhere honest to send them.
    await expect(page.getByTestId('returned-complete-now')).toHaveCount(0);
  });

  test('action required: falls back to its own heading when the server sent no reason', async ({
    page,
  }) => {
    await seedFlag(page, true);
    await seedLanguage(page, 'en');
    await stubProvider(page, RETURNED_HUB(), { profile: RETURNED_PROFILE(null) });
    await page.goto('/provider/onboarding');

    // An empty alert with a blank heading is worse than a generic sentence.
    await expect(page.getByTestId('returned-reason')).toContainText(
      'Something needs your attention',
    );
  });

  test('already active: the hub steps aside', async ({ page }) => {
    await seedFlag(page, true);
    await seedLanguage(page, 'en');
    await stubProvider(page, { ...HUB, status: 'ACTIVE' });
    await page.goto('/provider/onboarding');

    await expect(page.getByTestId('hub-state-ALREADY_ACTIVE')).toBeVisible();
    await expect(page.getByTestId('hub-task-list')).toHaveCount(0);
  });
});

test.describe('onboarding v2 — the flag', () => {
  test('OFF: the route does not exist and the legacy wizard is untouched', async ({ page }) => {
    await seedFlag(page, false);
    await seedLanguage(page, 'en');
    await stubProvider(page);
    await page.goto('/provider/onboarding');

    // Bounced to /provider, and no V2 chrome anywhere.
    await expect(page).toHaveURL(/\/provider\/status$/);
    await expect(page.getByTestId('onboarding-v2-shell')).toHaveCount(0);
  });

  test('OFF: a deep task link is bounced too', async ({ page }) => {
    await seedFlag(page, false);
    await seedLanguage(page, 'en');
    await stubProvider(page);
    await page.goto('/provider/onboarding/BASICS_IDENTITY');

    await expect(page).toHaveURL(/\/provider\/status$/);
    await expect(page.getByTestId('onboarding-v2-shell')).toHaveCount(0);
  });

  test('ON: the shell renders', async ({ page }) => {
    await openHub(page);
    await expect(page.getByTestId('onboarding-v2-shell')).toBeVisible();
  });
});
