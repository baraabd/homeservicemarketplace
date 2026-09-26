import { expect, test } from '@playwright/test';
import type {
  AdminPortfolioListResponse,
  AdminProviderReviewMutationResponse,
  ProviderOnboardingDraftView,
} from '@homeservicemarketplace/contracts';
import { openReviewTask } from './admin-review-tabs';
import { enterAdmin, openSubmittedProvider, recordAdminEvidence, submittedProvider } from './admin-review-real-api';
import { capabilitiesOf, providerApplicationReview } from './phase3-activation';
import { adminJar, api, loginViaUi, REAL_API } from './real-api';
import { seedLanguage } from './fixtures';

// Registered by the existing real-API suite entrypoint only. No page.route,
// injected sessions, permission grants or direct database writes are used.
for (const scenario of [
  { name: 'missing identity', kind: 'identity', evidence: false, portfolio: false, lang: 'en', width: 1440 },
  { name: 'submitted identity', kind: 'identity', evidence: true, portfolio: false, lang: 'en', width: 1440 },
  { name: 'portfolio replacement Arabic mobile', kind: 'portfolio', evidence: false, portfolio: true, lang: 'ar', width: 390 },
] as const) {
  test(`protected media correction: ${scenario.name} reaches the provider without granting work`, async ({ page, browser }, testInfo) => {
    const account = await submittedProvider({ evidence: scenario.evidence, portfolio: scenario.portfolio });
    await enterAdmin(page);
    const original = await openSubmittedProvider(page, account);
    expect(original.availableActions).toContain('requestChanges');
    if (!scenario.evidence) expect(original.verification).toBeNull();
    await page.setViewportSize({ width: scenario.width, height: 900 });
    if (scenario.lang === 'ar') {
      await page.getByRole('button', { name: 'Switch language', exact: true }).click();
    }
    await openReviewTask(page, scenario.kind === 'identity' ? 'BASICS_IDENTITY' : 'PORTFOLIO');
    let itemId: string | undefined;
    if (scenario.kind === 'portfolio') {
      const portfolio = await api<AdminPortfolioListResponse>(
        await adminJar(), `/v1/admin/providers/${account.profileId}/portfolio`,
      );
      expect(portfolio.status).toBe(200);
      expect(portfolio.body.items).toHaveLength(1);
      itemId = portfolio.body.items[0].id;
      const media = page.waitForResponse((response) =>
        response.url() === `${REAL_API}/v1/admin/providers/${account.profileId}/portfolio/${itemId}/media` &&
        response.request().method() === 'GET',
      );
      await page.getByTestId(`review-portfolio-open-${itemId}`).click();
      expect((await media).status()).toBe(200);
      const image = page.getByRole('dialog').getByRole('img');
      await expect.poll(() => image.evaluate((element) => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
      await page.getByRole('dialog').getByRole('button', { name: 'إغلاق', exact: true }).click();
    } else if (scenario.evidence) {
      const document = original.verification!.documents.find((entry) => entry.viewable)!;
      expect(document).toBeTruthy();
      const media = page.waitForResponse((response) =>
        response.url() === `${REAL_API}/v1/verification/documents/${document.id}/content` &&
        response.request().method() === 'GET',
      );
      await page.getByTestId(`review-evidence-${document.id}`).click();
      expect((await media).status()).toBe(200);
      const image = page.getByTestId('identity-evidence-image');
      await expect.poll(() => image.evaluate((element) => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
      await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
    }

    const opener = page.getByTestId(scenario.kind === 'identity'
      ? 'review-identity-request-replacement' : `review-portfolio-request-replacement-${itemId}`);
    await opener.click();
    const dialog = page.getByRole('dialog');
    const message = scenario.lang === 'ar'
      ? 'يرجى إرسال صورة أوضح للعمل دون إظهار عنوان العميل.'
      : 'Please upload a clear replacement identity photo with all edges visible.';
    await dialog.getByRole('textbox').fill(message);
    await recordAdminEvidence(page, testInfo, `media-correction-${scenario.kind}-${scenario.evidence ? 'submitted' : 'missing'}-${scenario.lang}`, original, {
      accessibilityScope: '[role="dialog"]', fullPage: false,
    });
    const responsePromise = page.waitForResponse((response) =>
      response.url() === `${REAL_API}/v1/admin/providers/${account.profileId}/review/request-changes` &&
      response.request().method() === 'POST',
    );
    await page.getByTestId('review-evidence-correction-send').click();
    const response = await responsePromise;
    expect(response.status()).toBe(200);
    const decision = await response.json() as AdminProviderReviewMutationResponse;
    expect(decision.review.submission?.decision).toBe('RETURNED');
    expect(response.request().postDataJSON()).not.toHaveProperty('note');
    await expect(dialog).toHaveCount(0);

    const persisted = await providerApplicationReview(account);
    const target = {
      taskId: scenario.kind === 'identity' ? 'BASICS_IDENTITY' : 'PORTFOLIO',
      field: scenario.kind === 'identity' ? 'identityDocument' : 'portfolio',
      ...(itemId ? { itemId } : {}),
      providerMessage: message,
    };
    expect(persisted.submission?.feedback?.items).toEqual([expect.objectContaining(target)]);
    expect(persisted.provider.onboardingState).toBe('RETURNED');
    expect(persisted.canWork).toBe(false);
    expect((await capabilitiesOf(account.jar)).allowed).not.toContain('SUBMIT_BID');
    if (scenario.evidence) expect(persisted.verification?.state).toBe('ACTION_REQUIRED');
    else expect(persisted.verification).toBeNull();
    if (itemId) {
      expect(persisted.current.portfolio.find((entry) => entry.id === itemId)?.moderationState).toBe('PENDING');
    }
    const draft = await api<ProviderOnboardingDraftView>(account.jar, '/v1/me/provider/onboarding/draft');
    expect(draft.status).toBe(200);
    expect(draft.body.reviewFeedback?.items).toEqual(persisted.submission?.feedback?.items);
    const notifications = await api<{ items: Array<{ resourceId: string | null; deepLink: string | null }> }>(
      account.jar, '/v1/me/notifications?experience=provider',
    );
    expect(notifications.status).toBe(200);
    expect(notifications.body.items).toContainEqual(expect.objectContaining({
      resourceId: account.profileId, deepLink: '/provider/onboarding',
    }));

    const context = await browser.newContext({ baseURL: testInfo.project.use.baseURL });
    try {
      const providerPage = await context.newPage();
      await seedLanguage(providerPage, 'en');
      await providerPage.goto('/provider/onboarding');
      await expect(providerPage).toHaveURL(/\/login(?:\?|$)/);
      await loginViaUi(providerPage, account);
      await expect(providerPage.getByTestId('review-feedback')).toContainText(message);
      await providerPage.reload();
      await expect(providerPage.getByTestId('review-feedback')).toContainText(message);
      await providerPage.getByTestId('review-feedback').getByRole('button', { name: /^Review this task:/ }).click();
      await expect(providerPage).toHaveURL(scenario.kind === 'identity'
        ? /\/provider\/verification(?:\?|$)/ : /\/provider\/onboarding\/PORTFOLIO/);
    } finally {
      await context.close();
    }
  });
}
