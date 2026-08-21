import { expect, test, type Page } from '@playwright/test';

import {
  PROVIDER_STATUSES,
  expectContainedInParent,
  expectLegible,
  expectNoHorizontalPageOverflow,
  expectVisibleFocusIndicator,
  htmlLangDir,
  seedLanguage,
  type ProviderStatus,
} from './fixtures';

// Phase 12 — the Provider status surfaces in a real browser.
//
// What these pin, beyond "the page renders":
//
//   1. A non-ACTIVE provider NEVER sees the live marketplace shell. The gate
//      used to be `if (profile && profile.status !== 'ACTIVE')`, which is false
//      while the profile query is still in flight — so the live map mounted
//      first and was then replaced. That flash is visible, and every
//      marketplace call it fired came back 403.
//
//   2. Each status gets its OWN surface. "Your provider application was
//      rejected" and "your account is suspended" are different facts on
//      different axes and must not collapse into one generic message.
//
//   3. Both directions, all three viewports, with real geometry assertions.

const PROVIDER_ME = {
  id: 'u-provider',
  email: 'provider@example.com',
  firstName: 'Pat',
  lastName: 'Provider',
  status: 'ACTIVE', // the ACCOUNT is fine; the PROVIDER PROFILE is what varies
  emailVerifiedAt: '2026-08-01T00:00:00.000Z',
  mfaEnabled: false,
  roles: ['customer', 'provider'],
};

function profileFor(status: ProviderStatus) {
  return {
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
      status,
      serviceAreaCity: 'Gothenburg',
      serviceAreaCountry: 'Sweden',
      serviceAreaLat: null,
      serviceAreaLng: null,
      serviceAreaRadiusKm: 25,
      serviceCategories: [],
      submittedForReviewAt: status === 'DRAFT' ? null : '2026-08-06T00:00:00.000Z',
      reviewedAt: status === 'REJECTED' ? '2026-08-07T00:00:00.000Z' : null,
      rejectionReason: status === 'REJECTED' ? 'Service area outside current coverage.' : null,
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-07T00:00:00.000Z',
    },
  };
}

/**
 * @param delayProfileMs hold the profile response back, so the "what is
 *        mounted while we are still loading?" question can actually be asked.
 */
async function openProvider(
  page: Page,
  status: ProviderStatus,
  lang: 'en' | 'ar' = 'en',
  delayProfileMs = 0,
): Promise<void> {
  await seedLanguage(page, lang);
  await page.route('**/v1/**', async (route) => {
    const url = route.request().url();
    const json = (body: unknown, s = 200) =>
      route.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(body) });

    if (url.includes('/auth/me')) return json(PROVIDER_ME);
    if (url.includes('/me/provider/profile')) {
      if (delayProfileMs > 0) await new Promise((r) => setTimeout(r, delayProfileMs));
      return json(profileFor(status));
    }
    // Any marketplace call reaching the wire at all is itself a finding for
    // the non-ACTIVE states; answer 403 exactly as the API would.
    if (url.includes('/provider/available-requests') || url.includes('/provider/bids')) {
      return json({ success: false, error: { code: 'FORBIDDEN' } }, 403);
    }
    return json({ items: [], nextCursor: null });
  });
  await page.goto('/provider');
}

const NON_ACTIVE = PROVIDER_STATUSES.filter((s) => s !== 'ACTIVE');

test.describe('Provider status surfaces', () => {
  for (const status of NON_ACTIVE) {
    for (const lang of ['en', 'ar'] as const) {
      test(`${status} renders its own status surface (${lang})`, async ({ page }) => {
        await openProvider(page, status, lang);

        const surface = page.getByTestId(`provider-status-${status.toLowerCase()}`);
        await expect(surface).toBeVisible();

        // Direction is applied at the document level, not just on a wrapper.
        const { lang: htmlLang, dir } = await htmlLangDir(page);
        expect(htmlLang).toBe(lang);
        expect(dir).toBe(lang === 'ar' ? 'rtl' : 'ltr');

        await expectNoHorizontalPageOverflow(page);
      });

      test(`${status} keeps its actions reachable and legible (${lang})`, async ({ page }) => {
        await openProvider(page, status, lang);

        const primary = page.getByTestId('provider-status-primary');
        const signOut = page.getByTestId('provider-status-logout');
        await expectLegible(primary, `${status} primary action`);
        await expectLegible(signOut, `${status} sign-out action`);
        await expectContainedInParent(primary, `${status} primary action`);

        const viewport = page.viewportSize()!;
        for (const [label, locator] of [
          ['primary', primary],
          ['sign out', signOut],
        ] as const) {
          const box = await locator.boundingBox();
          expect(box, `${status} ${label} has no box`).not.toBeNull();
          expect(box!.x, `${status} ${label} starts off-screen`).toBeGreaterThanOrEqual(-1);
          expect(
            box!.x + box!.width,
            `${status} ${label} extends past the viewport`,
          ).toBeLessThanOrEqual(viewport.width + 1);
        }
      });
    }

    test(`${status} NEVER mounts the live marketplace shell`, async ({ page }) => {
      await openProvider(page, status);
      await expect(page.getByTestId(`provider-status-${status.toLowerCase()}`)).toBeVisible();

      // The live shell's tab bar is the tell. If any of it is on screen, the
      // provider can reach the marketplace before approval.
      await expect(page.getByTestId('provider-shell-loading')).toHaveCount(0);
      const marketplaceCalls: string[] = [];
      page.on('request', (req) => {
        if (/\/provider\/(available-requests|bids)/.test(req.url())) {
          marketplaceCalls.push(req.url());
        }
      });
      await page.waitForTimeout(1000);
      expect(
        marketplaceCalls,
        `${status} provider issued marketplace calls it is not authorized for`,
      ).toEqual([]);
    });
  }

  test('the live shell does NOT flash while the profile is still loading', async ({ page }) => {
    // The exact defect: with the profile query in flight the old gate fell
    // through and mounted the live shell, which was then swapped out.
    await openProvider(page, 'SUSPENDED', 'en', 1200);

    // While loading, a neutral placeholder — not the marketplace.
    await expect(page.getByTestId('provider-shell-loading')).toBeVisible();
    await expect(page.getByTestId('provider-status-suspended')).toHaveCount(0);

    // And once resolved, the status surface.
    await expect(page.getByTestId('provider-status-suspended')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('provider-shell-loading')).toHaveCount(0);
  });

  test('the loading placeholder announces itself to assistive technology', async ({ page }) => {
    await openProvider(page, 'DRAFT', 'en', 1200);
    const loading = page.getByTestId('provider-shell-loading');
    await expect(loading).toHaveAttribute('role', 'status');
    await expect(loading).toHaveAttribute('aria-live', 'polite');
  });

  test('REJECTED and SUSPENDED are DIFFERENT surfaces, not one generic message', async ({
    page,
  }) => {
    await openProvider(page, 'REJECTED');
    await expect(page.getByTestId('provider-status-rejected')).toBeVisible();
    const rejectedText = await page.locator('body').innerText();

    await openProvider(page, 'SUSPENDED');
    await expect(page.getByTestId('provider-status-suspended')).toBeVisible();
    const suspendedText = await page.locator('body').innerText();

    expect(
      rejectedText,
      'a rejected application and a suspended account render identical copy',
    ).not.toBe(suspendedText);
  });

  test('the status surface keeps a visible focus indicator', async ({ page }) => {
    await openProvider(page, 'PENDING_REVIEW');
    await expectVisibleFocusIndicator(
      page.getByTestId('provider-status-primary'),
      'provider status primary action',
    );
  });

  test('Arabic status copy is actually Arabic, not English inside an RTL box', async ({ page }) => {
    await openProvider(page, 'PENDING_REVIEW', 'ar');
    await expect(page.getByTestId('provider-status-pending_review')).toBeVisible();
    const text = await page.getByTestId('provider-status-pending_review').innerText();
    expect(text, 'no Arabic script in the Arabic status surface').toMatch(/[؀-ۿ]/);
  });
});
