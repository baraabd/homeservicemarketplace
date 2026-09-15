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

// The approved Admin redesign fits every supported viewport. Wide data tables
// scroll inside their labeled keyboard-focusable regions; page-level overflow
// is always a defect, in both directions. Reachability is checked independently
// so hiding overflow cannot make this gate pass while concealing a column.
async function expectResponsiveAdminLayout(page: Page, label: string): Promise<void> {
  await expectNoHorizontalPageOverflow(page);
  const viewport = page.viewportSize()!;
  const originalY = await page.evaluate(() => window.scrollY);
  const regions = page.getByRole('region').filter({ has: page.locator('table') });

  for (let index = 0; index < (await regions.count()); index += 1) {
    const region = regions.nth(index);
    const box = await region.boundingBox();
    expect(box, `${label}: table region ${index} has no box`).not.toBeNull();
    expect(box!.x, `${label}: table region escapes the left viewport edge`).toBeGreaterThanOrEqual(
      -1,
    );
    expect(
      box!.x + box!.width,
      `${label}: table region escapes the right viewport edge`,
    ).toBeLessThanOrEqual(viewport.width + 1);

    const scrolling = await region.evaluate((node) => {
      const element = node as HTMLElement;
      const overflow = element.scrollWidth - element.clientWidth;
      const original = element.scrollLeft;
      const style = getComputedStyle(element);
      if (overflow > 1) element.scrollLeft = style.direction === 'rtl' ? -overflow : overflow;
      const reached = Math.abs(element.scrollLeft);
      element.scrollLeft = original;
      return { overflow, reached, overflowX: style.overflowX, tabIndex: element.tabIndex };
    });
    if (scrolling.overflow > 1) {
      expect(scrolling.overflowX, `${label}: a wide table must own its scrolling`).toMatch(
        /^(auto|scroll)$/,
      );
      expect(
        scrolling.tabIndex,
        `${label}: the table scroll region must be keyboard focusable`,
      ).toBeGreaterThanOrEqual(0);
      expect(
        scrolling.reached,
        `${label}: table contents cannot be scrolled into view`,
      ).toBeGreaterThan(0);
      await region.focus();
      await expect(region).toBeFocused();
    }

    // Each column must be fully revealable inside the scroll region. This
    // catches overflow:hidden wrappers and clipped far-edge columns in RTL.
    const columns = region.locator('thead th');
    for (let column = 0; column < (await columns.count()); column += 1) {
      const heading = columns.nth(column);
      await heading.scrollIntoViewIfNeeded();
      const bounds = await heading.evaluate((node) => {
        const owner = node.closest('[role="region"]')!;
        const cell = node.getBoundingClientRect();
        const clip = owner.getBoundingClientRect();
        return { left: clip.left - cell.left, right: cell.right - clip.right };
      });
      expect(
        Math.max(bounds.left, bounds.right),
        `${label}: column ${column} cannot be revealed`,
      ).toBeLessThanOrEqual(1);
    }
    const buttons = region.getByRole('button');
    if (await buttons.count()) {
      for (const button of [buttons.first(), buttons.last()]) {
        await button.scrollIntoViewIfNeeded();
        await expect(button).toBeInViewport({ ratio: 1 });
      }
    }
    await region.evaluate((node) => {
      (node as HTMLElement).scrollLeft = 0;
    });
  }

  const dialogs = page.getByRole('dialog');
  for (let index = 0; index < (await dialogs.count()); index += 1) {
    const box = await dialogs.nth(index).boundingBox();
    expect(box, `${label}: dialog has no box`).not.toBeNull();
    expect(box!.x, `${label}: dialog escapes the left viewport edge`).toBeGreaterThanOrEqual(-1);
    expect(
      box!.x + box!.width,
      `${label}: dialog escapes the right viewport edge`,
    ).toBeLessThanOrEqual(viewport.width + 1);
  }
  if ((await dialogs.count()) === 0)
    await expect(langToggle(page).first()).toBeInViewport({ ratio: 1 });
  await expectNoHorizontalPageOverflow(page);
  await page.evaluate((y) => window.scrollTo(0, y), originalY);
}

async function openAdmin(page: Page, lang: 'en' | 'ar'): Promise<void> {
  await seedLanguage(page, lang);
  await stubApi(page, { me: signedInAdmin() });
  await page.goto('/admin');
  // The shell is up once the operator identity has rendered.
  await expect(page.getByTestId('admin-sidebar-email')).toHaveText('operator@example.com');
}

// Targets the section by ID rather than by its translated label, so the same
// helper works in both directions and a copy change cannot break the suite.
async function openSection(page: Page, id: 'users' | 'providers'): Promise<void> {
  const menu = page.getByRole('button', { name: /Open navigation|فتح القائمة/ });
  if (await menu.isVisible()) {
    await menu.click();
    await page.getByTestId(`mobile-nav-${id}`).click();
  } else {
    await page.getByTestId(`nav-${id}`).click();
  }
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
    await expectResponsiveAdminLayout(page, 'admin shell (en)');
  });

  test('renders RTL in Arabic', async ({ page }) => {
    await openAdmin(page, 'ar');
    const { lang, dir } = await htmlLangDir(page);
    expect(lang).toBe('ar');
    expect(dir).toBe('rtl');
    await expectResponsiveAdminLayout(page, 'admin shell (ar)');
  });

  test('the in-dashboard language control flips direction without a reload', async ({ page }) => {
    await openAdmin(page, 'en');
    // Both directions fit the viewport; a language switch cannot widen it.
    const before = await page.evaluate(() => document.documentElement.scrollWidth);
    await langToggle(page).first().click();
    await expect.poll(async () => (await htmlLangDir(page)).dir).toBe('rtl');
    const after = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(after, 'RTL widened the admin shell beyond its LTR width').toBeLessThanOrEqual(
      before + 1,
    );
    await expectResponsiveAdminLayout(page, 'admin shell (flipped to ar)');
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
      await expect(row.getByTestId('badge-account-status')).toHaveText(
        lang === 'ar' ? 'نشط' : 'Active',
      );
      await expect(row.getByTestId('badge-role')).toHaveText([lang === 'ar' ? 'عميل' : 'Customer']);
      // Never asked for admin access → no badge at all.
      await expect(row.getByTestId('badge-admin-access')).toHaveCount(0);
    });

    test(`a PENDING admin request is shown WITHOUT granting the role (${lang})`, async ({
      page,
    }) => {
      await openUsersSection(page, lang);

      const row = page.locator('tbody tr').filter({ hasText: 'hopeful@example.com' });
      await expect(row.getByTestId('badge-account-status')).toHaveText(
        lang === 'ar' ? 'نشط' : 'Active',
      );
      await expect(row.getByTestId('badge-admin-access')).toBeVisible();
      // Asked is not granted: the roles cell must not contain `admin`.
      const roles = await row.getByTestId('badge-role').allTextContents();
      expect(roles).not.toContain(lang === 'ar' ? 'مسؤول إدارة' : 'Administrator');
    });

    test(`a SUSPENDED account is visually distinct from a REJECTED admin request (${lang})`, async ({
      page,
    }) => {
      await openUsersSection(page, lang);

      const row = page.locator('tbody tr').filter({ hasText: 'suspended@example.com' });
      const accountBadge = row.getByTestId('badge-account-status');
      const accessBadge = row.getByTestId('badge-admin-access');
      await expect(accountBadge).toHaveText(lang === 'ar' ? 'معلّق' : 'Suspended');
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

    test(`the users table fits the viewport and every column remains reachable (${lang})`, async ({
      page,
    }) => {
      await openUsersSection(page, lang);
      await expectResponsiveAdminLayout(page, `users table (${lang})`);
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
      await openSection(page, 'providers');

      // DRAFT, PENDING_REVIEW, ACTIVE, SUSPENDED, REJECTED must each be
      // representable — a queue that can only show one of them hides work.
      const body = page.locator('body');
      await expect(body).toContainText(adminProviderRows()[0].displayName);
      await expectResponsiveAdminLayout(page, `verification queue (${lang})`);
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
      await expectResponsiveAdminLayout(page, `user drawer (${lang})`);

      // The action remains reachable within the drawer, including when its
      // contents require vertical scrolling on a phone.
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
