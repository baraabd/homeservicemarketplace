import { expect, test, type Page } from '@playwright/test';

import { expectNoHorizontalPageOverflow, htmlLangDir, seedLanguage, stubApi } from './fixtures';

// Sprint 9B.18 — V2 Task 2 in a real browser.
//
// The component suite covers behaviour against a DOM shim. This layer covers
// what a shim cannot see: that the picker still fits a 320px phone once a
// catalogue with real depth is loaded into it, that the four review states are
// visually separable, and that Arabic lays out without overflow.

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
      id: 'SERVICES_EXPERIENCE',
      group: 'SERVICES',
      status: 'AVAILABLE',
      title: 'الخدمات والخبرة',
      description: 'التخصص، سنوات الخبرة، ووسيلة النقل',
    },
  ],
  progress: { complete: 1, total: 6 },
  nextAction: { kind: 'COMPLETE_TASK', taskId: 'SERVICES_EXPERIENCE' },
  status: 'DRAFT',
};

/** A catalogue with enough depth that a flat chip cloud would be unusable —
 *  which is the situation this screen was built for. */
const CATEGORIES = [
  {
    id: 'g-1',
    slug: 'plumbing-group',
    labelEn: 'Plumbing',
    labelAr: 'سباكة',
    icon: '',
    sortOrder: 1,
    parentId: null,
    isLeaf: false,
  },
  {
    id: 'leak',
    slug: 'plumbing',
    labelEn: 'Leak repair',
    labelAr: 'إصلاح تسريب',
    icon: '',
    sortOrder: 1,
    parentId: 'g-1',
    isLeaf: true,
  },
  {
    id: 'drains',
    slug: 'drains',
    labelEn: 'Drain unblocking',
    labelAr: 'تسليك مجاري',
    icon: '',
    sortOrder: 2,
    parentId: 'g-1',
    isLeaf: true,
  },
  {
    id: 'g-2',
    slug: 'electrical-group',
    labelEn: 'Electrical',
    labelAr: 'كهرباء',
    icon: '',
    sortOrder: 2,
    parentId: null,
    isLeaf: false,
  },
  {
    id: 'wiring',
    slug: 'electrical',
    labelEn: 'Wiring',
    labelAr: 'تمديدات',
    icon: '',
    sortOrder: 1,
    parentId: 'g-2',
    isLeaf: true,
  },
  {
    id: 'sockets',
    slug: 'sockets',
    labelEn: 'Sockets and switches',
    labelAr: 'مقابس ومفاتيح',
    icon: '',
    sortOrder: 2,
    parentId: 'g-2',
    isLeaf: true,
  },
];

const EQUIPMENT = [
  { id: 'e-1', code: 'LADDER', labelEn: 'Ladder', labelAr: 'سلّم', categoryId: null, sortOrder: 1 },
];

const specialty = (id: string, state: string) => ({
  categoryId: id,
  state,
  labelEn: 'Label ' + id,
  labelAr: 'تسمية ' + id,
  parentId: 'g-1',
  decidedAt: null,
});

const draft = (over: Record<string, unknown> = {}) => ({
  state: 'DRAFT',
  currentStep: 'SPECIALTIES',
  steps: [],
  completedSteps: [],
  percentComplete: 0,
  nextAction: { kind: 'COMPLETE_STEP', step: 'SPECIALTIES' },
  complete: false,
  missing: [],
  version: 4,
  policyVersion: 'sprint-08',
  lastSavedAt: null,
  editable: true,
  data: {
    primaryGroupIds: [],
    specialtyLeafIds: [],
    pendingSpecialtyIds: [],
    specialties: [],
    primarySpecialtyId: null,
    maxSpecialties: 3,
    suggestedTitle: null,
    yearsOfExperience: null,
    professionSince: null,
    equipmentCodes: [],
    transportMode: null,
    transportModes: [],
    headline: null,
    ...((over.data as Record<string, unknown>) ?? {}),
  },
  ...over,
});

interface Recorded {
  patches: Array<{ url: string; body: Record<string, unknown> }>;
}

async function openTask(
  page: Page,
  options: { lang?: 'en' | 'ar'; draftOver?: Record<string, unknown> } = {},
): Promise<Recorded> {
  const recorded: Recorded = { patches: [] };

  await page.addInitScript(
    ([key, value]) => window.localStorage.setItem(key as string, value as string),
    [FLAG_KEY, 'true'],
  );
  await seedLanguage(page, options.lang ?? 'en');

  await stubApi(page, { me: PROVIDER_ME, extra: { '/me/provider/onboarding/hub': HUB } });

  await page.route('**/v1/services**', async (route) => {
    const url = route.request().url();
    const body = url.includes('/equipment') ? { items: EQUIPMENT } : { items: CATEGORIES };
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  });

  await page.route('**/v1/me/provider/onboarding/**', async (route) => {
    const url = route.request().url();
    const json = (b: unknown) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });

    if (url.includes('/onboarding/hub')) return json(HUB);
    if (url.includes('/onboarding/steps/')) {
      recorded.patches.push({ url, body: JSON.parse(route.request().postData() ?? '{}') });
      return json(draft(options.draftOver));
    }
    return json(draft(options.draftOver));
  });

  await page.goto('/provider/onboarding/SERVICES_EXPERIENCE');
  await expect(page.getByTestId('services-task')).toBeVisible();
  return recorded;
}

test.describe('task 2 — the picker at catalogue scale', () => {
  test('browses by group rather than showing every leaf at once', async ({ page }) => {
    await openTask(page);

    await expect(page.getByTestId('specialty-group-g-1')).toBeVisible();
    // The old chip cloud rendered every selectable competency immediately.
    await expect(page.getByTestId('specialty-option-leak')).toHaveCount(0);

    await page.getByTestId('specialty-group-g-1').click();
    await expect(page.getByTestId('specialty-option-leak')).toBeVisible();
  });

  test('search finds a leaf in a group that was never opened', async ({ page }) => {
    await openTask(page);
    await page.getByTestId('specialty-search').fill('sockets');

    await expect(page.getByTestId('specialty-option-sockets')).toBeVisible();
    await expect(page.getByTestId('specialty-option-leak')).toHaveCount(0);
  });

  test('saves the selection to the SPECIALTIES step', async ({ page }) => {
    const rec = await openTask(page);
    await page.getByTestId('specialty-group-g-1').click();
    // click(), not check(): the checkbox reflects the SERVER's specialty list,
    // and this stub returns an unchanged draft. What is being asserted is the
    // save that goes out, not an optimistic tick.
    await page.getByTestId('specialty-option-leak').locator('input').click();

    await expect.poll(() => rec.patches.length).toBeGreaterThan(0);
    expect(rec.patches[0].url).toContain('/steps/SPECIALTIES');
    expect(rec.patches[0].body.specialtyLeafIds).toEqual(['leak']);
  });
});

test.describe('task 2 — review state is separate from selection', () => {
  const mixed = {
    data: {
      specialties: [
        specialty('a', 'APPROVED'),
        specialty('p', 'PENDING'),
        specialty('r', 'REJECTED'),
        specialty('x', 'INACTIVE'),
      ],
    },
  };

  test('each state is its own labelled section', async ({ page }) => {
    await openTask(page, { draftOver: mixed });

    for (const state of ['APPROVED', 'PENDING', 'REJECTED', 'INACTIVE']) {
      await expect(page.getByTestId('specialty-state-' + state)).toBeVisible();
    }
  });

  test('PENDING is not toned as a failure, and REJECTED is', async ({ page }) => {
    await openTask(page, { draftOver: mixed });

    await expect(page.getByTestId('specialty-row-p')).toHaveAttribute('data-tone', 'neutral');
    await expect(page.getByTestId('specialty-row-r')).toHaveAttribute('data-tone', 'negative');
  });

  test('the explanation appears ONCE per group, not per row', async ({ page }) => {
    await openTask(page, { draftOver: mixed });

    await expect(page.getByTestId('specialty-state-explain-PENDING')).toHaveCount(1);
    // And the row itself carries no repeated state text.
    await expect(page.getByTestId('specialty-row-p')).not.toContainText('With us for review');
  });
});

test.describe('task 2 — the title is suggested, never published', () => {
  const withSuggestion = {
    data: {
      specialties: [specialty('leak', 'APPROVED')],
      primarySpecialtyId: 'leak',
      suggestedTitle: { en: 'Plumber', ar: 'سبّاك' },
    },
  };

  test('offers it and says nothing is published', async ({ page }) => {
    const rec = await openTask(page, { draftOver: withSuggestion });

    await expect(page.getByTestId('title-suggestion-text')).toContainText('Plumber');
    await expect(page.getByTestId('title-not-published')).toBeVisible();
    // Rendering a suggestion must write nothing.
    expect(rec.patches.filter((p) => 'headline' in p.body)).toHaveLength(0);
  });

  test('accepting it fills the box without publishing', async ({ page }) => {
    const rec = await openTask(page, { draftOver: withSuggestion });
    await page.getByTestId('title-accept').click();

    await expect(page.getByTestId('title-input')).toHaveValue('Plumber');
    expect(rec.patches.filter((p) => 'headline' in p.body)).toHaveLength(0);
  });

  test('refuses an unverifiable credential inline', async ({ page }) => {
    await openTask(page, { draftOver: withSuggestion });
    await page.getByTestId('title-edit').click();
    await page.getByTestId('title-input').fill('Certified Plumber');

    await expect(page.getByTestId('title-help')).toContainText('credentials we have verified');
  });
});

test.describe('task 2 — geometry and language', () => {
  for (const width of [320, 430]) {
    test(`${width}px: the picker fits without horizontal overflow`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await openTask(page, {
        draftOver: {
          data: { specialties: [specialty('a', 'APPROVED'), specialty('p', 'PENDING')] },
        },
      });

      await page.getByTestId('specialty-group-g-1').click();
      await expectNoHorizontalPageOverflow(page);

      const box = (await page.getByTestId('specialty-search').boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(44);
    });
  }

  test('Arabic renders RTL without overflow', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 900 });
    await openTask(page, {
      lang: 'ar',
      draftOver: { data: { specialties: [specialty('p', 'PENDING')] } },
    });

    expect(await htmlLangDir(page)).toEqual({ lang: 'ar', dir: 'rtl' });
    // The HEADING names the state; the explanation says what it means for
    // them. Asserting the heading's words against the explanation was the
    // test's mistake, not the screen's.
    await expect(page.getByTestId('specialty-state-PENDING')).toContainText('قيد المراجعة');
    await expect(page.getByTestId('specialty-state-explain-PENDING')).toContainText(
      'لا حاجة إلى أي إجراء منك',
    );
    await expectNoHorizontalPageOverflow(page);
  });
});
