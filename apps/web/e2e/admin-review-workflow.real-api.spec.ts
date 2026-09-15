import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import {
  ADMIN_PROVIDER_REVIEW_TASK_IDS,
  type AdminProviderReviewMutationResponse,
  type ListVerificationPoliciesResponse,
  type ProviderOnboardingDraftView,
} from '@homeservicemarketplace/contracts';

import { adminJar, api, loginViaUi, REAL_API, type Account } from './real-api';
import { capabilitiesOf, providerApplicationReview } from './phase3-activation';
import { seedLanguage } from './fixtures';
import {
  adminNavigation,
  enterAdmin,
  findSubmittedProvider,
  observeAdminTraffic,
  openSubmittedProvider,
  recordAdminEvidence,
  submittedProvider,
} from './admin-review-real-api';

// This suite is deliberately excluded when E2E_REAL_API is absent. It does
// not install routes, supply auth cookies, alter database state, or grant
// permissions. The CI job provides the normal seeded development identities,
// real Postgres/Redis/Mailpit and a SPA built against that API.
test.describe.configure({ mode: 'default', timeout: 240_000 });

test.beforeAll(() => {
  expect(
    process.env.VERIFICATION_ENFORCED,
    'Admin acceptance requires verification enforcement',
  ).toBe('true');
  expect(process.env.WORK_ACCESS_ENFORCED, 'Admin acceptance requires work-grant enforcement').toBe(
    'true',
  );
});

test('normal Admin entry reaches the submitted file, and a field correction reaches the provider', async ({
  page,
  browser,
}, testInfo) => {
  const account = await submittedProvider();
  const traffic = observeAdminTraffic(page);
  await enterAdmin(page);
  const original = await openSubmittedProvider(page, account);
  for (const task of ADMIN_PROVIDER_REVIEW_TASK_IDS) {
    await expect(page.locator(`#review-section-${task}`)).toBeVisible();
  }

  const message = 'Please confirm the city where you accept jobs.';
  const privateNote = 'Operator-only acceptance note.';
  await page.getByTestId('review-private-note').fill(privateNote);
  await page.getByTestId('review-request-changes').click();
  await page.getByTestId('review-correction-task-0').selectOption('WORK_AREA');
  await page.getByTestId('review-correction-field-0').selectOption('serviceAreaCity');
  await page.getByTestId('review-correction-message-0').fill(message);
  const responsePromise = page.waitForResponse(
    (response) =>
      response.url() ===
        `${REAL_API}/v1/admin/providers/${account.profileId}/review/request-changes` &&
      response.request().method() === 'POST',
  );
  await page.getByTestId('review-confirm').click();
  const response = await responsePromise;
  expect(response.status()).toBe(200);
  const decision = (await response.json()) as AdminProviderReviewMutationResponse;
  expect(decision.review.submission?.id).toBe(original.submission!.id);
  expect(decision.review.submission?.decision).toBe('RETURNED');

  await page.reload();
  await expect(page.getByTestId('admin-provider-review-workspace')).toContainText(message);
  await expect(page.getByTestId('review-history')).toContainText(
    'Application returned for changes',
  );
  const persisted = await providerApplicationReview(account);
  expect(persisted.submission?.feedback?.items).toEqual([
    expect.objectContaining({
      taskId: 'WORK_AREA',
      field: 'serviceAreaCity',
      providerMessage: message,
    }),
  ]);
  const providerDraft = await api<ProviderOnboardingDraftView>(
    account.jar,
    '/v1/me/provider/onboarding/draft',
  );
  expect(providerDraft.status).toBe(200);
  expect(providerDraft.body.reviewFeedback?.items).toEqual(persisted.submission?.feedback?.items);
  expect(JSON.stringify(providerDraft.body)).not.toContain(privateNote);
  expect((await capabilitiesOf(account.jar)).allowed).not.toContain('SUBMIT_BID');
  await page.getByRole('button', { name: 'Back to providers', exact: true }).click();
  await expect(page.getByTestId('admin-review-directory')).toBeVisible();
  await expect(page.getByTestId('directory-total')).toHaveText('0');
  await expect(page.getByTestId(`provider-row-${account.profileId}`)).toHaveCount(0);

  // A fresh provider browser has no Admin query cache or session to inherit.
  const providerContext = await browser.newContext({ baseURL: testInfo.project.use.baseURL });
  try {
    const providerPage = await providerContext.newPage();
    await seedLanguage(providerPage, 'en');
    await providerPage.goto('/provider/onboarding');
    await expect(providerPage).toHaveURL(/\/login(?:\?|$)/);
    await loginViaUi(providerPage, account);
    await expect(providerPage.getByTestId('review-feedback')).toContainText(message);
    await expect(providerPage.getByTestId('review-feedback')).not.toContainText(privateNote);
    await providerPage
      .getByTestId('review-feedback')
      .getByRole('button', { name: /^Review this task:/ })
      .click();
    await expect(providerPage).toHaveURL(/\/provider\/onboarding\/WORK_AREA/);
    await expect(providerPage.getByTestId('review-feedback')).toContainText(message);
    await providerPage.reload();
    await expect(providerPage.getByTestId('review-feedback')).toContainText(message);
  } finally {
    await providerContext.close();
  }

  expect(traffic).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ path: '/v1/admin/providers', status: 200 }),
      expect.objectContaining({
        path: `/v1/admin/providers/${account.profileId}/review/request-changes`,
        method: 'POST',
        status: 200,
      }),
    ]),
  );
  expect(traffic.filter((entry) => entry.status >= 400)).toEqual([]);
});

test('reviewing protected identity then approving in the Admin UI persists acceptance and opens work', async ({
  page,
}) => {
  const account = await submittedProvider({ evidence: true });
  expect((await api(account.jar, '/v1/provider/bids')).status).toBe(403);
  await enterAdmin(page);
  const original = await openSubmittedProvider(page, account);
  expect(original.availableActions, JSON.stringify(original.blockers)).toContain('approve');
  expect(original.verification?.workAccess).toBeNull();
  expect(original.canWork).toBe(false);
  expect((await capabilitiesOf(account.jar)).allowed).not.toContain('SUBMIT_BID');

  const document = original.verification!.documents.find((item) => item.viewable)!;
  expect(document).toBeTruthy();
  await page.getByTestId(`review-evidence-${document.id}`).click();
  const viewer = page.getByTestId('identity-evidence-viewer');
  await expect(viewer).toBeVisible();
  const image = page.getByTestId('identity-evidence-image');
  await expect(image).toHaveAttribute('src', /^blob:/);
  await expect
    .poll(() => image.evaluate((element) => (element as HTMLImageElement).naturalWidth))
    .toBeGreaterThan(0);
  await page.getByTestId('identity-evidence-zoom-in').click();
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
  await expect(viewer).toHaveCount(0);

  await page.getByTestId('review-approve').click();
  await page.getByTestId('review-approval-ack').check();
  const responsePromise = page.waitForResponse(
    (response) =>
      response.url() === `${REAL_API}/v1/admin/providers/${account.profileId}/review/approve` &&
      response.request().method() === 'POST',
  );
  await page.getByTestId('review-confirm').click();
  expect((await responsePromise).status()).toBe(200);
  await page.reload();
  await expect(page.getByTestId('admin-provider-review-workspace')).toBeVisible();
  await expect(page.getByTestId('review-approve')).toHaveCount(0);

  const persisted = await providerApplicationReview(account);
  expect(persisted.submission).toMatchObject({ id: original.submission!.id, decision: 'ACCEPTED' });
  expect(persisted.provider).toMatchObject({
    providerStatus: 'ACTIVE',
    onboardingState: 'ACCEPTED',
  });
  expect(persisted.verification?.state).toBe('VERIFIED');
  expect(persisted.verification?.workAccess).toMatchObject({
    active: true,
    status: 'ACTIVE',
    grantedAt: expect.any(String),
    revokedAt: null,
  });
  expect(persisted.canWork).toBe(true);
  expect((await capabilitiesOf(account.jar)).allowed).toContain('SUBMIT_BID');
  expect((await api(account.jar, '/v1/provider/bids')).status).toBe(200);
});

test('legacy entry has no policy editor; Settings publishes a scoped license policy and retires it', async ({
  page,
}) => {
  await enterAdmin(page);
  await page.goto('/admin/verification');
  await expect(page).toHaveURL(/\/admin\/reviews(?:\?|$)/);
  await expect(page.getByTestId('admin-review-directory')).toBeVisible();
  await expect(page.getByTestId('policy-panel')).toHaveCount(0);
  await expect(page.getByTestId('policy-publish-form')).toHaveCount(0);
  await adminNavigation(page, 'settings');
  await page.locator('a[href="/admin/settings/verification-policies"]').click();
  await expect(page.getByTestId('policy-panel')).toBeVisible();
  await page.getByTestId('policy-new-version').click();
  const version = `2026.09-e2e${randomUUID().slice(0, 8)}-v1`;
  await page.getByTestId('policy-version').fill(version);
  await page.getByTestId('policy-country').selectOption('SE');
  await page.getByTestId('policy-provider-type').selectOption('BUSINESS');
  const categories = page.getByTestId('policy-category').locator('option');
  const categoryId = await categories.evaluateAll((options) =>
    options.map((option) => (option as HTMLOptionElement).value).find(Boolean),
  );
  expect(categoryId).toBeTruthy();
  await page.getByTestId('policy-category').selectOption(categoryId!);
  await page.getByTestId('policy-kind-CATEGORY_LICENSE').check();
  await page.getByTestId('policy-publish').click();
  await page.getByTestId('policy-confirm').click();
  const retire = page.getByTestId(`policy-retire-${version}`);
  await expect(retire).toBeVisible();
  const before = await api<ListVerificationPoliciesResponse>(
    await adminJar(),
    '/v1/admin/verification/policies',
  );
  expect(before.status).toBe(200);
  expect(before.body.policies.find((item) => item.version === version)).toMatchObject({
    country: 'SE',
    providerType: 'BUSINESS',
    categoryId,
    retiredAt: null,
    state: 'ACTIVE',
    requirements: { documents: ['CATEGORY_LICENSE'], verificationRequired: true },
  });
  await retire.click();
  await page.getByTestId('policy-confirm').click();
  await expect(retire).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId('policy-panel')).toContainText(version);
  const after = await api<ListVerificationPoliciesResponse>(
    await adminJar(),
    '/v1/admin/verification/policies',
  );
  expect(after.status).toBe(200);
  expect(after.body.policies.find((item) => item.version === version)).toMatchObject({
    retiredAt: expect.any(String),
    state: 'RETIRED',
    requirements: { documents: ['CATEGORY_LICENSE'], verificationRequired: true },
  });
});

test('a provider cannot read or publish verification policies through the real API', async () => {
  const account = await submittedProvider();
  for (const path of [
    '/v1/admin/verification/policies',
    '/v1/admin/verification/policies/options',
  ]) {
    expect((await api(account.jar, path)).status).toBe(403);
  }
  const mutation = await api(account.jar, '/v1/admin/verification/policies', {
    method: 'POST',
    body: {
      version: `forbidden-${randomUUID()}`,
      requirements: { documents: ['INDIVIDUAL_IDENTITY'], verificationRequired: true },
    },
  });
  expect(mutation.status).toBe(403);
});

test.describe('real rendered Admin screens', () => {
  let account: Account;
  test.beforeAll(async () => {
    account = await submittedProvider({ evidence: true, portfolio: true });
  });

  for (const lang of ['en', 'ar'] as const) {
    for (const theme of ['light', 'dark'] as const) {
      test(`queue, six-step file and policy settings — ${lang} ${theme}`, async ({
        page,
      }, testInfo) => {
        await enterAdmin(page);
        if (lang === 'ar')
          await page.getByRole('button', { name: 'Switch language', exact: true }).click();
        if (theme === 'dark')
          await page
            .getByRole('button', {
              name: lang === 'ar' ? 'الوضع الداكن' : 'Dark theme',
              exact: true,
            })
            .click();
        await expect(page.locator('html')).toHaveAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr');
        const traffic = observeAdminTraffic(page);
        for (const width of [390, 768, 1440]) {
          await page.setViewportSize({ width, height: 1000 });
          const { row, review } = await findSubmittedProvider(page, account, lang);
          await recordAdminEvidence(page, testInfo, `queue-${lang}-${theme}-${width}`, review);
          await row.getByRole('link').click();
          const dossier = page.getByTestId('admin-provider-review-workspace');
          await expect(dossier).toBeVisible();
          await expect(page.getByTestId('review-approve')).toBeVisible();
          for (const task of ADMIN_PROVIDER_REVIEW_TASK_IDS)
            await expect(page.locator(`#review-section-${task}`)).toBeVisible();
          await expect(page.getByTestId('review-history')).toContainText(
            lang === 'ar' ? 'أُرسل الطلب للمراجعة' : 'Application submitted',
          );
          await recordAdminEvidence(page, testInfo, `dossier-${lang}-${theme}-${width}`, review);
          await adminNavigation(page, 'settings');
          await page.locator('a[href="/admin/settings/verification-policies"]').click();
          await expect(page.getByTestId('policy-panel')).toBeVisible();
          await expect(page.getByTestId('policy-loading')).toHaveCount(0);
          await expect(page.getByTestId('policy-new-version')).toBeEnabled();
          await recordAdminEvidence(page, testInfo, `policies-${lang}-${theme}-${width}`, review);
        }
        expect(traffic.length).toBeGreaterThan(0);
        expect(traffic.filter((entry) => entry.status >= 400)).toEqual([]);
      });
    }
  }
});
