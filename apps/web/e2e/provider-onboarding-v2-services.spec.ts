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

// Sprint 09B.29 Phase 5A — the approved services screen is a FLAT, searchable
// list, not a group browser, and moderation is one sentence rather than a
// section per state. The tests below are rewritten onto that design; every
// behavioural intent they carried is preserved and two are stricter.

test.describe('task 2 — the picker at catalogue scale', () => {
  test('offers every selectable leaf, and nothing that is not one', async ({ page }) => {
    await openTask(page);

    // SUPERSEDED: this asserted a group browser that opened one group at a
    // time. The approved screen lists the leaves directly and puts a search
    // above them, so "you cannot see a leaf until you open its group" is no
    // longer true and is no longer the thing worth protecting.
    //
    // What IS worth protecting survives, and is asserted harder: a GROUP must
    // never be selectable. `isLeaf` is a server fact the screen reads rather
    // than derives, and the failure this guards is a parent whose last child
    // was retired quietly becoming a competency a provider can claim.
    await expect(page.getByTestId('specialty-choice-leak')).toBeVisible();
    await expect(page.getByTestId('specialty-choice-sockets')).toBeVisible();
    await expect(page.getByTestId('specialty-choice-g-1')).toHaveCount(0);
  });

  test('search narrows the list to what was typed', async ({ page }) => {
    await openTask(page);
    await page.getByTestId('specialty-search').fill('sockets');

    await expect(page.getByTestId('specialty-choice-sockets')).toBeVisible();
    await expect(page.getByTestId('specialty-choice-leak')).toHaveCount(0);
  });

  test('saves the selection to the SPECIALTIES step', async ({ page }) => {
    const rec = await openTask(page);
    // click(), not check(): the checkbox reflects the SERVER's specialty list,
    // and this stub returns an unchanged draft. What is being asserted is the
    // save that goes out, not an optimistic tick.
    // The row, which is what a provider presses. The input behind it is
    // `sr-only` — focusable and announced, but not a pointer target.
    await page.getByTestId('specialty-choice-leak').click();

    await expect.poll(() => rec.patches.length).toBeGreaterThan(0);
    expect(rec.patches[0].url).toContain('/steps/SPECIALTIES');
    expect(rec.patches[0].body.specialtyLeafIds).toEqual(['leak']);
  });

  test('every choice is a real checkbox, so the group is genuinely multi-select', async ({
    page,
  }) => {
    await openTask(page);
    // The approved screen marks more than one service at once. A radio group
    // could not express that, and `aria-pressed` on a button would describe
    // the control rather than the choice.
    const input = page.getByTestId('specialty-choice-leak').locator('input');
    await expect(input).toHaveAttribute('type', 'checkbox');
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

  test('says once that moderation is separate, not once per state', async ({ page }) => {
    await openTask(page, { draftOver: mixed });

    // SUPERSEDED: four labelled sections, one per state. The approved screen
    // carries a single sentence instead — and the sentence is the load-bearing
    // one, because it is what stops a PENDING specialty reading as a mistake
    // the provider has to fix before they can submit.
    await expect(page.getByTestId('specialty-moderation-notice')).toHaveCount(1);
    await expect(page.getByTestId('specialty-moderation-notice')).toContainText(
      'will not block submission',
    );
  });

  test('a refusal still says so on its own row', async ({ page }) => {
    await openTask(page, { draftOver: mixed });

    // The regression this replaces the state sections with. PENDING is covered
    // by the notice above and carries no alarm of its own; REJECTED and
    // INACTIVE are outcomes a provider must be able to see, so they travel on
    // the row itself rather than disappearing with the section that held them.
    await expect(page.getByTestId('specialty-choice-r')).toContainText('Not approved');
    await expect(page.getByTestId('specialty-choice-p')).not.toContainText('Not approved');
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

  test('offers it and says it can be changed later', async ({ page }) => {
    const rec = await openTask(page, { draftOver: withSuggestion });
    // The panel lives on the SECOND approved screen of this task.
    await page.goto('/provider/onboarding/SERVICES_EXPERIENCE#experience');
    await expect(page.getByTestId('experience-section')).toBeVisible();

    await expect(page.getByTestId('title-suggestion-text')).toContainText('Plumber');
    await expect(page.getByTestId('title-suggestion-text')).toContainText('editable later');
    // Rendering a suggestion must write nothing.
    expect(rec.patches.filter((patch) => 'headline' in patch.body)).toHaveLength(0);
  });

  // SUPERSEDED CONTRACT, recorded rather than deleted.
  //
  // These drove an EDITABLE title: accepting a suggestion into a box, and
  // refusing "Certified Plumber" inline. Ruling C1 makes the generated title
  // server-owned, and the approved experience screen presents it as a panel
  // that says it can be changed later on the surface that owns it.
  //
  // The replacement is stricter: the old tests proved the editor behaved, this
  // proves no editor can be reached, so no unverifiable credential can be
  // typed here at all.
  test('offers no control to accept or edit it', async ({ page }) => {
    const rec = await openTask(page, { draftOver: withSuggestion });
    await page.goto('/provider/onboarding/SERVICES_EXPERIENCE#experience');
    await expect(page.getByTestId('experience-section')).toBeVisible();

    await expect(page.getByTestId('title-suggestion-text')).toBeVisible();
    await expect(page.getByTestId('title-accept')).toHaveCount(0);
    await expect(page.getByTestId('title-edit')).toHaveCount(0);
    await expect(page.getByTestId('title-input')).toHaveCount(0);

    // Still writes nothing: showing a suggestion is not publishing it.
    expect(rec.patches.filter((patch) => 'headline' in patch.body)).toHaveLength(0);
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

      // No group to open any more — the approved screen lists the leaves.
      await expectNoHorizontalPageOverflow(page);

      const box = (await page.getByTestId('specialty-search').boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(44);

      // The choice rows are targets too, and they are the controls a provider
      // actually presses on this screen.
      const choice = (await page.getByTestId('specialty-choice-leak').boundingBox())!;
      expect(choice.height, 'a choice row is a touch target').toBeGreaterThanOrEqual(44);
    });
  }

  test('Arabic renders RTL without overflow', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 900 });
    await openTask(page, {
      lang: 'ar',
      draftOver: { data: { specialties: [specialty('p', 'PENDING')] } },
    });

    expect(await htmlLangDir(page)).toEqual({ lang: 'ar', dir: 'rtl' });
    // The per-state sections are gone with the approved design; the sentence
    // that replaced them is what has to read correctly in Arabic, and it is
    // the one a provider with a specialty in moderation depends on.
    await expect(page.getByTestId('specialty-moderation-notice')).toContainText(
      'تُراجع التخصصات لاحقاً',
    );
    await expectNoHorizontalPageOverflow(page);
  });
});
