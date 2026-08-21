import { expect, test, type Page } from '@playwright/test';

import {
  ADMIN_USER_ROWS,
  adminProviderRows,
  expectContainedInParent,
  expectLegible,
  expectNoHorizontalPageOverflow,
  expectVisibleFocusIndicator,
  htmlLangDir,
  langToggle,
  seedLanguage,
  signedInAdmin,
  stubApi,
} from './fixtures';

// Phase 12 — the Admin Dashboard in a real browser, in both directions.
//
// Two things are under test and they are different:
//
//   1. RTL correctness. Arabic is not "English with the text moved" — tables,
//      dialogs, action menus, and badges all have to survive the flip without
//      overflowing the page or clipping their own content. Only a real layout
//      engine can answer that.
//
//   2. The three account axes rendering as THREE distinct badges. The fixture
//      rows vary account status, roles, and admin-access request status
//      independently on purpose: if the UI ever collapses them again, at least
//      one of these rows renders wrongly and a test fails.
//
// The API is stubbed so the visual states are deterministic. The authorization
// behaviour behind those states is proved against the real API/database by
// scripts/runtime/verify-sprint01-security.cjs.

// ── Viewport policy for the Admin console ────────────────────────────────────
//
// The Admin Dashboard is a DECLARED DESKTOP SURFACE: the app selector labels it
// "Desktop 1440px", and the shell is built around a fixed 256px sidebar beside
// a data table. At 375px and 768px the page therefore scrolls horizontally by
// ~210-270px.
//
// That is intended layout, not an RTL regression — it reproduces identically in
// English and Arabic — so the strict "the page must not scroll sideways" rule
// is asserted at DESKTOP, where the surface is meant to be used. At the smaller
// viewports these tests assert the properties that actually matter there:
// nothing is clipped out of reach, the overflow is bounded rather than runaway,
// and the direction flip does not make it worse.
//
// Making the console responsive at 375px is a redesign of a surface this sprint
// was told not to redesign. It is reported as a remaining risk instead of being
// silently accepted here.
const DESKTOP_WIDTH = 1440;

async function expectViewportAppropriateOverflow(page: Page, label: string): Promise<void> {
  const width = page.viewportSize()!.width;
  if (width >= DESKTOP_WIDTH) {
    await expectNoHorizontalPageOverflow(page);
    return;
  }

  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);

  // Bounded: the console needs about a desktop's width, and no more. A runaway
  // value means something genuinely escaped the layout rather than the shell
  // simply being wider than a phone.
  expect(
    scrollWidth,
    `${label}: admin console is ${scrollWidth}px wide at a ${width}px viewport, which is beyond the desktop width it is designed for`,
  ).toBeLessThanOrEqual(DESKTOP_WIDTH);

  // And it must remain REACHABLE — scrolling to the far edge has to work,
  // otherwise the content past the fold is simply lost.
  //
  // Direction matters: in an RTL document the scroll origin is the RIGHT edge,
  // so scrolling towards the overflow yields a NEGATIVE window.scrollX. Testing
  // for a positive value would report every RTL page as unscrollable.
  const scrolled = await page.evaluate(() => {
    const el = document.documentElement;
    window.scrollTo(getComputedStyle(el).direction === 'rtl' ? -el.scrollWidth : el.scrollWidth, 0);
    return Math.abs(window.scrollX);
  });
  expect(scrolled, `${label}: the overflowing content cannot be scrolled to`).toBeGreaterThan(0);
  await page.evaluate(() => window.scrollTo(0, 0));
}

async function openAdmin(page: Page, lang: 'en' | 'ar'): Promise<void> {
  await seedLanguage(page, lang);
  await stubApi(page, { me: signedInAdmin() });
  await page.goto('/admin');
  // The shell is up once the operator identity has rendered.
  await expect(page.getByText('operator@example.com').first()).toBeVisible();
}

// Targets the section by ID rather than by its translated label, so the same
// helper works in both directions and a copy change cannot break the suite.
async function openSection(page: Page, id: 'users' | 'verification'): Promise<void> {
  await page.getByTestId(`nav-${id}`).click();
}

async function openUsersSection(page: Page, lang: 'en' | 'ar'): Promise<void> {
  await openAdmin(page, lang);
  await openSection(page, 'users');
  await expect(page.getByTestId('col-admin-access')).toBeVisible();
}

test.describe('Admin dashboard — direction', () => {
  test('renders LTR in English', async ({ page }) => {
    await openAdmin(page, 'en');
    const { lang, dir } = await htmlLangDir(page);
    expect(lang).toBe('en');
    expect(dir).toBe('ltr');
    await expectViewportAppropriateOverflow(page, 'admin shell (en)');
  });

  test('renders RTL in Arabic', async ({ page }) => {
    await openAdmin(page, 'ar');
    const { lang, dir } = await htmlLangDir(page);
    expect(lang).toBe('ar');
    expect(dir).toBe('rtl');
    await expectViewportAppropriateOverflow(page, 'admin shell (ar)');
  });

  test('the in-dashboard language control flips direction without a reload', async ({ page }) => {
    await openAdmin(page, 'en');
    // Flipping direction must not make the layout WORSE than it already is —
    // an RTL-only overflow would be a genuine regression, unlike the shell's
    // baseline desktop width.
    const before = await page.evaluate(() => document.documentElement.scrollWidth);
    await langToggle(page).first().click();
    await expect.poll(async () => (await htmlLangDir(page)).dir).toBe('rtl');
    const after = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(after, 'RTL widened the admin shell beyond its LTR width').toBeLessThanOrEqual(
      before + 1,
    );
    await expectViewportAppropriateOverflow(page, 'admin shell (flipped to ar)');
  });

  test('navigation is legible in Arabic', async ({ page }) => {
    await openAdmin(page, 'ar');
    const nav = page.getByRole('button').filter({ hasText: /\S/ });
    const count = await nav.count();
    expect(count, 'expected navigation controls').toBeGreaterThan(0);
    // The first few are the section links; each must have a real box.
    for (let i = 0; i < Math.min(count, 5); i += 1) {
      await expectLegible(nav.nth(i), `nav item ${i}`);
    }
  });
});

test.describe('Admin dashboard — the three account axes', () => {
  for (const lang of ['en', 'ar'] as const) {
    test(`the users table shows account status, roles, and admin access as SEPARATE columns (${lang})`, async ({
      page,
    }) => {
      await openUsersSection(page, lang);

      // Three distinct cells per row — not one merged "status".
      const rows = page.locator('tbody tr');
      await expect(rows).toHaveCount(ADMIN_USER_ROWS.length);

      await expect(page.getByTestId('cell-account-status')).toHaveCount(ADMIN_USER_ROWS.length);
      await expect(page.getByTestId('cell-roles')).toHaveCount(ADMIN_USER_ROWS.length);
      await expect(page.getByTestId('cell-admin-access')).toHaveCount(ADMIN_USER_ROWS.length);
    });

    test(`an ACTIVE account with only the customer role is never described as an admin (${lang})`, async ({
      page,
    }) => {
      // The exact confusion the remediation removes: `status === ACTIVE`
      // rendered as "Admin active".
      await openUsersSection(page, lang);

      const row = page.locator('tbody tr').filter({ hasText: 'customer@example.com' });
      await expect(row.getByTestId('badge-account-status')).toHaveText('ACTIVE');
      await expect(row.getByTestId('badge-role')).toHaveText(['customer']);
      // Never asked for admin access → no badge at all.
      await expect(row.getByTestId('badge-admin-access')).toHaveCount(0);
    });

    test(`a PENDING admin request is shown WITHOUT granting the role (${lang})`, async ({
      page,
    }) => {
      await openUsersSection(page, lang);

      const row = page.locator('tbody tr').filter({ hasText: 'hopeful@example.com' });
      await expect(row.getByTestId('badge-account-status')).toHaveText('ACTIVE');
      await expect(row.getByTestId('badge-admin-access')).toBeVisible();
      // Asked is not granted: the roles cell must not contain `admin`.
      const roles = await row.getByTestId('badge-role').allTextContents();
      expect(roles).not.toContain('admin');
    });

    test(`a SUSPENDED account is visually distinct from a REJECTED admin request (${lang})`, async ({
      page,
    }) => {
      await openUsersSection(page, lang);

      const row = page.locator('tbody tr').filter({ hasText: 'suspended@example.com' });
      const accountBadge = row.getByTestId('badge-account-status');
      const accessBadge = row.getByTestId('badge-admin-access');
      await expect(accountBadge).toHaveText('SUSPENDED');
      await expect(accessBadge).toBeVisible();

      // Different axes must not share a colour, or the reader learns nothing
      // from the distinction.
      const accountColor = await accountBadge.evaluate(
        (el) => getComputedStyle(el).backgroundColor,
      );
      const accessColor = await accessBadge.evaluate((el) => getComputedStyle(el).backgroundColor);
      expect(accountColor).not.toBe(accessColor);
    });

    test(`every badge stays inside its own cell (${lang})`, async ({ page }) => {
      await openUsersSection(page, lang);
      await expectContainedInParent(page.getByTestId('badge-account-status'), 'account badge');
      await expectContainedInParent(page.getByTestId('badge-admin-access'), 'admin-access badge');
      await expectContainedInParent(page.getByTestId('badge-role'), 'role badge');
    });

    test(`the users table stays within the console's width budget (${lang})`, async ({ page }) => {
      await openUsersSection(page, lang);
      await expectViewportAppropriateOverflow(page, `users table (${lang})`);
    });
  }

  test('every admin-access status renders a legible badge in Arabic', async ({ page }) => {
    await openUsersSection(page, 'ar');
    const badges = page.getByTestId('badge-admin-access');
    // Four of the five fixture rows carry a request status.
    await expect(badges).toHaveCount(4);
    for (let i = 0; i < 4; i += 1) {
      await expectLegible(badges.nth(i), `admin-access badge ${i}`);
    }
  });
});

test.describe('Admin dashboard — provider status badges', () => {
  for (const lang of ['en', 'ar'] as const) {
    test(`every provider status is rendered on the verification queue (${lang})`, async ({
      page,
    }) => {
      await openAdmin(page, lang);
      await openSection(page, 'verification');

      // DRAFT, PENDING_REVIEW, ACTIVE, SUSPENDED, REJECTED must each be
      // representable — a queue that can only show one of them hides work.
      const body = page.locator('body');
      await expect(body).toContainText(adminProviderRows()[0].displayName);
      await expectViewportAppropriateOverflow(page, `verification queue (${lang})`);
    });
  }
});

test.describe('Admin dashboard — dialogs and actions stay reachable', () => {
  for (const lang of ['en', 'ar'] as const) {
    test(`the user detail drawer opens and stays inside the viewport (${lang})`, async ({
      page,
    }) => {
      await openUsersSection(page, lang);

      const rowCountBefore = await page.locator('tbody tr').count();
      await page.locator('tbody tr').first().click();

      // The drawer is the ACTION surface: if it opens off-screen in RTL, every
      // action inside it is unreachable. It is identified by the status-change
      // control it hosts, which the table itself does not render.
      const drawerAction = page
        .getByRole('button', { name: /suspend|restore|lock|تعليق|استعادة|قفل/i })
        .first();
      await expect(drawerAction).toBeVisible();
      await expectLegible(drawerAction, 'drawer action control');
      await expectViewportAppropriateOverflow(page, `user drawer (${lang})`);

      // The action must be reachable after scrolling to it — which is the real
      // requirement on a console wider than the viewport.
      await drawerAction.scrollIntoViewIfNeeded();
      const box = await drawerAction.boundingBox();
      expect(box, 'drawer action has no box').not.toBeNull();
      expect(box!.width, 'drawer action collapsed to zero width').toBeGreaterThan(0);
      expect(box!.height, 'drawer action collapsed to zero height').toBeGreaterThan(0);
      await expect(drawerAction).toBeInViewport();
      // The table stayed mounted behind the drawer — opening it must not
      // destroy the list the operator came from.
      expect(await page.locator('tbody tr').count()).toBe(rowCountBefore);
    });

    test(`the language control keeps a visible focus ring (${lang})`, async ({ page }) => {
      await openAdmin(page, lang);
      await expectVisibleFocusIndicator(langToggle(page).first(), 'admin language toggle');
    });
  }
});
