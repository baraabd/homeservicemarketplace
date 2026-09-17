import { expect, type Page, type TestInfo } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import type {
  AdminProviderReview,
  ListAdminProvidersResponse,
} from '@homeservicemarketplace/contracts';

import {
  acceptTerms,
  adminJar,
  addPortfolioPhoto,
  api,
  approveCategoriesFor,
  completeDraft,
  loginViaUi,
  newJar,
  REAL_API,
  registerProvider,
  type Account,
} from './real-api';
import { expectNoHorizontalPageOverflow } from './fixtures';
import { verifyApprovalHome } from './admin-approval-home-evidence';
import {
  providerApplicationReview,
  submitVerificationCase,
  supplyEvidence,
  waitForEvidenceClean,
} from './phase3-activation';

/** Public HTTP setup only. No direct database state, role writes or browser stubs. */
export async function submittedProvider(options: { evidence?: boolean; portfolio?: boolean } = {}) {
  const account = await registerProvider();
  await completeDraft(account);
  if (options.portfolio) await addPortfolioPhoto(account.jar, 'Kitchen electrical installation');
  await acceptTerms(account);
  const readiness = await api<{ canSubmit: boolean; draftVersion: number }>(
    account.jar,
    '/v1/me/provider/onboarding/review',
  );
  expect(readiness.status).toBe(200);
  expect(readiness.body.canSubmit, JSON.stringify(readiness.body)).toBe(true);
  const submitted = await api(account.jar, '/v1/me/provider/onboarding/submit', {
    method: 'POST',
    body: { version: readiness.body.draftVersion },
  });
  expect(submitted.status, JSON.stringify(submitted.body)).toBe(200);

  if (options.evidence) {
    await approveCategoriesFor(account);
    await supplyEvidence(account);
    // The running API's worker scans the uploaded bytes. The harness never
    // calls a scanner service or marks the document clean itself.
    await waitForEvidenceClean(account);
    await submitVerificationCase(account);
  }
  return account;
}

/** The normal protected entry must take a fresh browser through login and OTP. */
export async function enterAdmin(page: Page): Promise<void> {
  // Each test supplies a fresh browser context. Keep the product's initial
  // language and persisted UI choices; a recurring language init script would
  // silently reset an Arabic choice to English on every subsequent reload.
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/login(?:\?|$)/);
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await loginViaUi(page, {
    email: 'test1@admin.com',
    password: 'DevAdmin123!',
    jar: newJar(),
    profileId: '',
  });
  await expect(page).toHaveURL(/\/admin(?:\?|$)/);
  await expect(page.locator('#admin-content')).toBeVisible();
  await verifyApprovalHome(page);
}

export async function adminNavigation(page: Page, section: string): Promise<void> {
  const desktopLink = page.getByTestId(`nav-${section}`);
  if (await desktopLink.isVisible()) {
    await desktopLink.click();
  } else {
    await page.getByRole('button', { name: /^(Open navigation|فتح القائمة)$/ }).click();
    await page.getByTestId(`mobile-nav-${section}`).click();
  }
}

/** Search real list data, then compare the DOM's date with a separate HTTP read. */
export async function findSubmittedProvider(
  page: Page,
  account: Account,
  lang: 'en' | 'ar' = 'en',
) {
  await adminNavigation(page, 'reviews');
  const directory = page.getByTestId('admin-review-directory');
  await expect(directory).toBeVisible();
  await directory.getByRole('searchbox').fill(account.email);
  await directory
    .getByRole('button', { name: lang === 'ar' ? 'بحث' : 'Search', exact: true })
    .click();
  const row = page.getByTestId(`provider-row-${account.profileId}`);
  await expect(row).toBeVisible();
  const review = await providerApplicationReview(account);
  expect(review.submission).not.toBeNull();
  const list = await api<ListAdminProvidersResponse>(
    await adminJar(),
    `/v1/admin/providers?status=PENDING_REVIEW&query=${encodeURIComponent(account.email)}`,
  );
  expect(list.status).toBe(200);
  const summary = list.body.items.find((item) => item.id === account.profileId);
  expect(summary?.submittedForReviewAt).toEqual(expect.any(String));
  // The profile's submission timestamp and the immutable submission row's
  // DB-default timestamp can differ by milliseconds; assert the actual list
  // contract used by this screen, not equality between distinct DB columns.
  await expect(row.locator('time')).toHaveAttribute('datetime', summary!.submittedForReviewAt!);
  expect(list.body.total).toBe(1);
  await expect(directory.getByTestId('directory-total')).toHaveText((1).toLocaleString(lang));
  await expect(row).not.toContainText(lang === 'ar' ? 'لم يُرسل بعد' : 'Not submitted yet');
  return { row, review };
}

export async function openSubmittedProvider(page: Page, account: Account) {
  const { row, review } = await findSubmittedProvider(page, account);
  await row.getByRole('link', { name: /^Open profile / }).click();
  await expect(page.getByTestId('admin-provider-review-workspace')).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/admin/providers/${account.profileId}\\?`));
  // Verify the actual route landing before any screenshot helper normalizes scroll.
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  const workspace = page.getByTestId('admin-provider-review-workspace');
  const back = workspace.getByRole('button', { name: 'Back to providers', exact: true });
  const heading = workspace.getByRole('heading', { level: 1 });
  await expect
    .poll(async () => {
      const [bar, backBox, headingBox] = await Promise.all([
        page.getByTestId('admin-topbar').boundingBox(),
        back.boundingBox(),
        heading.boundingBox(),
      ]);
      return Boolean(
        bar &&
        backBox &&
        headingBox &&
        backBox.y >= bar.y + bar.height - 1 &&
        headingBox.y >= bar.y + bar.height - 1,
      );
    })
    .toBe(true);
  return review;
}

/** Record only genuine API responses. Do not record cookies or request bodies. */
export function observeAdminTraffic(page: Page) {
  const responses: Array<{ path: string; method: string; status: number }> = [];
  page.on('response', (response) => {
    if (!response.url().startsWith(REAL_API)) return;
    const path = new URL(response.url()).pathname;
    if (!path.startsWith('/v1/admin/')) return;
    responses.push({ path, method: response.request().method(), status: response.status() });
  });
  return responses;
}

export async function recordAdminEvidence(
  page: Page,
  testInfo: TestInfo,
  name: string,
  source: Pick<AdminProviderReview, 'provider' | 'submission' | 'revision'>,
  options: { accessibilityScope?: string; fullPage?: boolean } = {},
) {
  await expectNoHorizontalPageOverflow(page);
  await page.evaluate(() => document.fonts.ready);
  const accessibility = await new AxeBuilder({ page })
    .include(options.accessibilityScope ?? '#admin-content')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();
  await testInfo.attach(`${name}-accessibility.json`, {
    contentType: 'application/json',
    body: Buffer.from(JSON.stringify(accessibility.violations)),
  });
  expect(accessibility.violations, `${name}: accessibility violations`).toEqual([]);
  if (options.fullPage !== false) {
    // Full-page screenshots retain the current sticky position. Normalize it
    // after accessibility analysis so the captured hero is the actual page top.
    await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: 'instant' }));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  }
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path, fullPage: options.fullPage ?? true, animations: 'disabled' });
  await testInfo.attach(name, { path, contentType: 'image/png' });
  await testInfo.attach(`${name}-runtime.json`, {
    contentType: 'application/json',
    body: Buffer.from(
      JSON.stringify({
        route: new URL(page.url()).pathname,
        viewport: page.viewportSize(),
        language: await page.locator('html').getAttribute('lang'),
        direction: await page.locator('html').getAttribute('dir'),
        commit: process.env.GITHUB_SHA ?? null,
        apiOrigin: REAL_API,
        providerProfileId: source.provider.id,
        submissionId: source.submission?.id,
        submittedAt: source.submission?.submittedAt,
        revision: source.revision,
        transport: 'real HTTP; no route interception',
        // The CI scanner is deterministic, not proof of malware detection.
        evidenceScanner: process.env.EVIDENCE_SCANNER_DRIVER ?? 'environment configured',
        enforcement: {
          verification: process.env.VERIFICATION_ENFORCED === 'true',
          workAccess: process.env.WORK_ACCESS_ENFORCED === 'true',
        },
      }),
    ),
  });
}
