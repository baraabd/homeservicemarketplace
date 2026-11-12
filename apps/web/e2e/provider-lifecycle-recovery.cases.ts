import { setTimeout as delay } from 'node:timers/promises';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import type {
  AdminProviderReview,
  AdminProviderReviewHistoryResponse,
  CurrentVerificationCaseResponse,
  FinalizeEvidenceUploadResponse,
} from '@homeservicemarketplace/contracts';

import { openReviewTask } from './admin-review-tabs';
import {
  enterAdmin,
  openSubmittedProvider,
  recordAdminEvidence,
  submittedProvider,
} from './admin-review-real-api';
import { expectNoHorizontalPageOverflow, seedLanguage } from './fixtures';
import {
  capabilitiesOf,
  EVIDENCE_PNG,
  providerApplicationReview,
  supplyEvidence,
  waitForEvidenceClean,
} from './phase3-activation';
import {
  adminJar,
  api,
  approveCategoriesFor,
  loginViaUi,
  REAL_API,
  type Account,
} from './real-api';

const CASE_PATH = '/v1/me/provider/verification/case';
const WIDTHS = [320, 390, 430, 768, 1024, 1440] as const;
const COPY = {
  en: {
    returned: 'Returned for changes',
    rejected: 'Rejected',
    nextStep:
      'The provider must review the corrections and resubmit the joining application from their account. The new submission can then be reviewed here; identity approval does not resubmit it automatically.',
    correction: 'Please send a clear identity document before resubmitting your application.',
    upload: 'Upload identity documents',
    start: 'Start verification',
    add: 'Add a document',
    submit: 'Send for review',
    continueApplication: 'Review and send application',
    reviewApplication: 'Review and resubmit',
    applicationStatus: 'View application status',
    workspace: 'Open workspace',
    identity: 'Identity verified — Yes',
    cannotWork: 'Can take work — Not yet',
    canWork: 'Can take work — Yes',
  },
  ar: {
    returned: 'أُعيد للتعديل',
    rejected: 'مرفوض',
    nextStep:
      'على المهني مراجعة التعديلات وإعادة إرسال طلب الانضمام من حسابه. بعد الإرسال يصبح الطلب الجديد متاحًا للمراجعة هنا؛ توثيق الهوية لا يعيد إرسال الطلب تلقائيًا.',
    correction: 'يرجى إرسال وثيقة هوية واضحة ثم إعادة إرسال طلب الانضمام.',
    upload: 'رفع وثائق الهوية',
    start: 'ابدأ التوثيق',
    add: 'إضافة مستند',
    submit: 'إرسال للمراجعة',
    continueApplication: 'مراجعة طلب الانضمام وإرساله',
    reviewApplication: 'المراجعة وإعادة الإرسال',
    applicationStatus: 'متابعة حالة طلب الانضمام',
    workspace: 'فتح مساحة العمل',
    identity: 'الهوية موثّقة — نعم',
    cannotWork: 'يمكنك استلام الأعمال — ليس بعد',
    canWork: 'يمكنك استلام الأعمال — نعم',
  },
} as const;
type Language = keyof typeof COPY;

/** Compare all persisted application content, without the read-time timestamp.
 * Identity decisions are a separate axis and cannot require a spurious edit. */
function applicationContent(review: AdminProviderReview) {
  const { capturedAt: _capturedAt, ...content } = review.current;
  return content;
}

function observeRuntimeErrors(page: Page, errors: string[]) {
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (
      /validateDOMNesting|cannot (appear|be).*descendant|hydration failed/i.test(message.text())
    ) {
      errors.push(message.text());
    }
  });
}

async function capture(page: Page, testInfo: TestInfo, name: string, lang: Language) {
  await expect(page.locator('html')).toHaveAttribute('lang', lang);
  await expect(page.locator('html')).toHaveAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr');
  await expectNoHorizontalPageOverflow(page);
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: 'instant' }));
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path, fullPage: true, animations: 'disabled' });
  await testInfo.attach(name, { path, contentType: 'image/png' });
}

async function assertReturnedAdmin(page: Page, lang: Language) {
  const status = page.getByTestId('review-application-status');
  await expect(status.locator('.ar-badge')).toHaveText(COPY[lang].returned);
  await expect(status.locator('.ar-badge')).toHaveClass(/ar-badge-warning/);
  await expect(status.locator('.ar-badge-danger')).toHaveCount(0);
  await expect(status).not.toContainText(COPY[lang].rejected);
  await expect(page.getByTestId('review-recorded-decision')).toContainText(COPY[lang].returned);
  await expect(page.getByTestId('review-next-step').locator('p')).toHaveText(COPY[lang].nextStep);
  await expect(page.getByTestId('review-approve')).toHaveCount(0);
  await expect(page.getByTestId('review-request-changes')).toHaveCount(0);
}

async function assertProviderContinuation(page: Page, lang: Language) {
  await expect(page.getByTestId('verification-VERIFIED_NO_ACCESS')).toBeVisible();
  await expect(page.getByTestId('axis-identityVerified')).toHaveText(COPY[lang].identity);
  await expect(page.getByTestId('axis-identityVerified')).toHaveAttribute('data-active', 'true');
  await expect(page.getByTestId('axis-workAccessActive')).toHaveText(COPY[lang].cannotWork);
  await expect(page.getByTestId('axis-workAccessActive')).toHaveAttribute('data-active', 'false');
  await expect(
    page.getByRole('button', { name: COPY[lang].continueApplication, exact: true }),
  ).toBeEnabled();
  await expect(page.getByRole('button', { name: COPY[lang].start, exact: true })).toHaveCount(0);
  await expect(page.locator('input[type="file"]')).toHaveCount(0);
}

/** The same protected document and separately authorized identity decision a
 * reviewer uses. This never clicks final application approval. */
async function approveIdentityThroughBrowser(page: Page, review: AdminProviderReview) {
  await openReviewTask(page, 'BASICS_IDENTITY');
  const document = review.verification!.documents.find((item) => !item.supersededAt)!;
  expect(document.viewable).toBe(true);
  const opener = page.getByTestId(`review-evidence-${document.id}`);
  const content = page.waitForResponse(
    (response) =>
      response.url() === `${REAL_API}/v1/verification/documents/${document.id}/content` &&
      response.request().method() === 'GET',
  );
  await opener.click();
  const bytes = await content;
  expect(bytes.status()).toBe(200);
  expect(bytes.headers()['cache-control']).toContain('no-store');
  await expect
    .poll(() =>
      page
        .getByTestId('identity-evidence-image')
        .evaluate((element) => (element as HTMLImageElement).naturalWidth),
    )
    .toBeGreaterThan(0);
  await page.keyboard.press('Escape');
  await expect(opener).toBeFocused();

  await page.getByTestId('review-case-approve').click();
  await page
    .getByRole('dialog')
    .getByRole('combobox')
    .selectOption('DOCUMENTS_COMPLETE_AND_LEGIBLE');
  const approved = page.waitForResponse(
    (response) =>
      response.url() ===
        `${REAL_API}/v1/admin/verification/cases/${review.verification!.id}/approve` &&
      response.request().method() === 'POST',
  );
  await page.getByTestId('review-case-confirm').click();
  const response = await approved;
  expect(response.status()).toBe(200);
  expect(response.request().postDataJSON()).toMatchObject({
    expectedState: review.verification!.state,
    reasonCode: 'DOCUMENTS_COMPLETE_AND_LEGIBLE',
  });
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByTestId('review-case-approve')).toHaveCount(0);
}

async function approveApplicationThroughBrowser(page: Page, review: AdminProviderReview) {
  await expect(page.getByTestId('review-approve')).toBeEnabled();
  await page.getByTestId('review-approve').click();
  await page.getByTestId('review-approval-ack').check();
  const approved = page.waitForResponse(
    (response) =>
      response.url() === `${REAL_API}/v1/admin/providers/${review.provider.id}/review/approve` &&
      response.request().method() === 'POST',
  );
  await page.getByTestId('review-confirm').click();
  const response = await approved;
  expect(response.status()).toBe(200);
  expect(response.request().postDataJSON()).toMatchObject({
    submissionId: review.submission!.id,
    expectedRevision: review.revision,
  });
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByTestId('review-approve')).toHaveCount(0);
}

async function uploadIdentityThroughBrowser(page: Page, account: Account, lang: Language) {
  await expect(page.getByTestId('verification-NOT_STARTED')).toBeVisible();
  const creation = page.waitForResponse(
    (response) =>
      response.url() === `${REAL_API}${CASE_PATH}` && response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: COPY[lang].start, exact: true }).click();
  expect((await creation).status()).toBe(200);
  await expect(page.getByTestId('verification-EVIDENCE_REQUIRED')).toBeVisible();

  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: COPY[lang].add, exact: true }).click();
  const prepared = page.waitForResponse(
    (response) =>
      response.url() === `${REAL_API}/v1/me/provider/verification/evidence/prepare` &&
      response.request().method() === 'POST',
  );
  const uploaded = page.waitForResponse(
    (response) =>
      response.url().startsWith(`${REAL_API}/v1/me/provider/verification/evidence/`) &&
      response.url().endsWith('/content') &&
      response.request().method() === 'PUT',
  );
  const finalized = page.waitForResponse(
    (response) =>
      response.url().startsWith(`${REAL_API}/v1/me/provider/verification/evidence/`) &&
      response.url().endsWith('/finalize') &&
      response.request().method() === 'POST',
  );
  await (
    await chooser
  ).setFiles({
    name: `lifecycle-identity-${lang}.png`,
    mimeType: 'image/png',
    buffer: EVIDENCE_PNG,
  });
  const responses = await Promise.all([prepared, uploaded, finalized]);
  expect(responses.map((response) => response.status())).toEqual([200, 200, 200]);
  const document = (await responses[2].json()) as FinalizeEvidenceUploadResponse;
  await waitForEvidenceClean(account);
  const submit = page.getByRole('button', { name: COPY[lang].submit, exact: true });
  await expect(submit).toBeEnabled({ timeout: 15_000 });
  const submission = page.waitForResponse(
    (response) =>
      response.url() === `${REAL_API}${CASE_PATH}/submit` && response.request().method() === 'POST',
  );
  await submit.click();
  expect((await submission).status()).toBe(200);
  await expect(page.getByTestId('verification-PENDING_REVIEW')).toBeVisible();
  const ownCase = await api<CurrentVerificationCaseResponse>(account.jar, CASE_PATH);
  expect(ownCase.status).toBe(200);
  expect(ownCase.body.case?.state).toBe('SUBMITTED');
  expect(ownCase.body.case?.documents.filter((item) => !item.superseded)).toEqual([
    expect.objectContaining({ id: document.documentId, scanState: 'CLEAN' }),
  ]);
  return ownCase.body.case!.id;
}

// Imported into the existing enforced real-API job. Setup uses published
// authenticated APIs; every correction, upload, identity decision, resubmission
// and final approval below is a real browser action. No route mocks, injected
// sessions, SQL state writes, manufactured grant or test-only policy overrides.
test.describe('Independent provider lifecycle recovery', () => {
  // These multi-actor journeys include evidence scanning and six viewport
  // captures. Own their existing four-minute test budget within this group.
  test.describe.configure({ timeout: 240_000 });

  test.beforeAll(async () => {
    // beforeAll has a separate project-default slot (60s), not the describe
    // test budget. Allow the 65s expiry wait plus 25s of runner scheduling.
    test.setTimeout(90_000);
    // These cases follow the existing Admin acceptance in the same worker and
    // share its loopback login IP. Let the unchanged 10/IP/minute budget expire
    // before creating any new fixture or session; do not reset its Redis keys.
    // The group uses four Admin UI logins, three Provider UI logins and at most
    // one initial memoized Admin API login (provider registration uses OTP).
    await delay(65_000);
  });

  for (const scenario of [
    { lang: 'ar', width: 390 },
    { lang: 'en', width: 1440 },
  ] as const) {
    test(`provider lifecycle recovery: ${scenario.lang} verified identity returns to the application and completes final approval`, async ({
      page,
      browser,
    }, testInfo) => {
      const { lang, width } = scenario;
      const copy = COPY[lang];
      const errors: string[] = [];
      observeRuntimeErrors(page, errors);
      const account = await submittedProvider();
      // The requested correction is identity only. Service moderation is an
      // independent prerequisite, completed before the recovery under test.
      await approveCategoriesFor(account);
      await enterAdmin(page);
      const original = await openSubmittedProvider(page, account);
      expect(original.verification).toBeNull();
      expect(original.availableActions).toContain('requestChanges');
      await page.setViewportSize({ width, height: 900 });
      if (lang === 'ar') await page.getByTestId('lang-toggle').click();
      await openReviewTask(page, 'BASICS_IDENTITY');
      await page.getByTestId('review-identity-request-replacement').click();
      await page.getByRole('dialog').getByRole('textbox').fill(copy.correction);
      const returnedResponse = page.waitForResponse(
        (response) =>
          response.url() ===
            `${REAL_API}/v1/admin/providers/${account.profileId}/review/request-changes` &&
          response.request().method() === 'POST',
      );
      await page.getByTestId('review-evidence-correction-send').click();
      expect((await returnedResponse).status()).toBe(200);
      await expect(page.getByRole('dialog')).toHaveCount(0);
      const returned = await providerApplicationReview(account);
      expect(returned.submission).toMatchObject({
        id: original.submission!.id,
        decision: 'RETURNED',
      });
      expect(returned.submission?.feedback?.items).toEqual([
        expect.objectContaining({
          taskId: 'BASICS_IDENTITY',
          field: 'identityDocument',
          providerMessage: copy.correction,
        }),
      ]);
      await assertReturnedAdmin(page, lang);

      const context = await browser.newContext({ baseURL: testInfo.project.use.baseURL });
      try {
        const providerPage = await context.newPage();
        observeRuntimeErrors(providerPage, errors);
        await providerPage.setViewportSize({ width, height: 900 });
        await providerPage.goto('/provider/onboarding');
        await expect(providerPage).toHaveURL(/\/login(?:\?|$)/);
        await loginViaUi(providerPage, account);
        await expect(providerPage).toHaveURL(/\/provider\/onboarding(?:\?|$)/);
        await expect(providerPage.getByTestId('review-feedback')).toBeVisible();
        await seedLanguage(providerPage, lang);
        await providerPage.reload();
        expect(
          await providerPage.evaluate(() => localStorage.getItem('hsm.ff.providerOnboardingV2')),
        ).toBeNull();
        const feedback = providerPage.getByTestId('review-feedback');
        await expect(feedback).toContainText(copy.correction);
        await feedback.getByRole('button', { name: copy.upload, exact: true }).click();
        await expect(providerPage).toHaveURL(/\/provider\/verification(?:\?|$)/);
        const caseId = await uploadIdentityThroughBrowser(providerPage, account, lang);

        const submittedIdentity = await providerApplicationReview(account);
        expect(submittedIdentity.submission?.decision).toBe('RETURNED');
        expect(submittedIdentity.verification).toMatchObject({ id: caseId, state: 'SUBMITTED' });
        expect(submittedIdentity.canWork).toBe(false);
        await page.reload();
        await approveIdentityThroughBrowser(page, submittedIdentity);
        const verified = await providerApplicationReview(account);
        expect(verified.provider).toMatchObject({
          providerStatus: 'REJECTED',
          onboardingState: 'RETURNED',
          verificationState: 'VERIFIED',
        });
        expect(verified.submission).toMatchObject({
          id: original.submission!.id,
          decision: 'RETURNED',
        });
        expect(verified.verification).toMatchObject({
          id: caseId,
          state: 'VERIFIED',
          workAccess: { active: true, source: 'VERIFIED_DOCUMENTS' },
        });
        expect(verified.verification!.decidedAt).toEqual(expect.any(String));
        expect(
          verified.verification!.decisions.filter((decision) => decision.toState === 'VERIFIED'),
        ).toHaveLength(1);
        expect(applicationContent(verified)).toEqual(applicationContent(returned));
        expect(verified.canWork).toBe(false);
        expect(verified.availableActions).not.toContain('approve');
        const blocked = await capabilitiesOf(account.jar);
        expect(blocked.primaryReason).toBe('ONBOARDING_INCOMPLETE');
        expect(blocked.allowed).toEqual(
          expect.arrayContaining([
            'COMPLETE_ONBOARDING',
            'SUBMIT_FOR_REVIEW',
            'MANAGE_VERIFICATION',
          ]),
        );
        expect(blocked.allowed).not.toContain('SUBMIT_BID');
        expect((await api(account.jar, '/v1/provider/bids')).status).toBe(403);

        // Reload independently: cached pre-decision capabilities must not be
        // mistaken for the fresh case, and a live grant must not imply work.
        await providerPage.reload();
        await assertProviderContinuation(providerPage, lang);
        await assertReturnedAdmin(page, lang);
        await expect(page.getByTestId('review-live-grant-blocked')).toBeVisible();
        for (const viewportWidth of WIDTHS) {
          await page.setViewportSize({ width: viewportWidth, height: 900 });
          await providerPage.setViewportSize({ width: viewportWidth, height: 900 });
          await assertReturnedAdmin(page, lang);
          await assertProviderContinuation(providerPage, lang);
          await capture(page, testInfo, `lifecycle-admin-returned-${lang}-${viewportWidth}`, lang);
          await capture(
            providerPage,
            testInfo,
            `lifecycle-provider-resubmit-${lang}-${viewportWidth}`,
            lang,
          );
        }
        await page.setViewportSize({ width, height: 900 });
        await providerPage.setViewportSize({ width, height: 900 });
        await recordAdminEvidence(
          page,
          testInfo,
          `lifecycle-admin-returned-${lang}-a11y`,
          verified,
        );
        const accessibility = await new AxeBuilder({ page: providerPage })
          .include('[data-testid="verification-VERIFIED_NO_ACCESS"]')
          .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
          .analyze();
        await testInfo.attach(`lifecycle-provider-${lang}-accessibility.json`, {
          contentType: 'application/json',
          body: JSON.stringify(accessibility.violations),
        });
        expect(accessibility.violations).toEqual([]);

        await page
          .getByRole('button', { name: lang === 'ar' ? 'الوضع الداكن' : 'Dark theme', exact: true })
          .click();
        await assertReturnedAdmin(page, lang);
        await recordAdminEvidence(
          page,
          testInfo,
          `lifecycle-admin-returned-${lang}-dark`,
          verified,
        );
        await page
          .getByRole('button', {
            name: lang === 'ar' ? 'الوضع الفاتح' : 'Light theme',
            exact: true,
          })
          .click();

        // Reach the action with real Tab presses and activate with Enter. There
        // are no edits to name, service, location, availability, bio or consent.
        await providerPage.reload();
        await assertProviderContinuation(providerPage, lang);
        const continuation = providerPage.getByRole('button', {
          name: copy.continueApplication,
          exact: true,
        });
        for (let tab = 0; tab < 15; tab++) {
          await providerPage.keyboard.press('Tab');
          if (await continuation.evaluate((element) => element === document.activeElement)) break;
        }
        await expect(continuation).toBeFocused();
        const target = await continuation.boundingBox();
        expect(target!.width).toBeGreaterThanOrEqual(44);
        expect(target!.height).toBeGreaterThanOrEqual(44);
        await capture(providerPage, testInfo, `lifecycle-provider-resubmit-${lang}-keyboard`, lang);
        await providerPage.keyboard.press('Enter');
        await expect(providerPage).toHaveURL(/\/provider\/onboarding(?:\?|$)/);
        await expect(feedback).toContainText(copy.correction);
        await feedback.getByRole('button', { name: copy.reviewApplication, exact: true }).click();
        await expect(providerPage.getByTestId('review-screen')).toBeVisible();
        await providerPage.getByTestId('review-continue-to-consent').click();
        await expect(providerPage.getByTestId('terms-accepted')).toBeVisible();
        await expect(providerPage.getByTestId('review-submit')).toBeEnabled();
        const applicationSubmitted = providerPage.waitForResponse(
          (response) =>
            response.url() === `${REAL_API}/v1/me/provider/onboarding/submit` &&
            response.request().method() === 'POST',
        );
        await providerPage.getByTestId('review-submit').click();
        expect((await applicationSubmitted).status()).toBe(200);
        await expect(providerPage.getByTestId('review-submitted')).toBeVisible();
        const pending = await providerApplicationReview(account);
        expect(pending.submission?.id).not.toBe(original.submission!.id);
        expect(pending.submission?.decision).toBeNull();
        expect(pending.provider).toMatchObject({
          providerStatus: 'PENDING_REVIEW',
          onboardingState: 'DOCUMENTS_REQUIRED',
        });
        expect(applicationContent(pending)).toEqual(applicationContent(returned));
        expect(pending.verification).toMatchObject({
          id: caseId,
          state: 'VERIFIED',
          decidedAt: verified.verification!.decidedAt,
          decisions: verified.verification!.decisions,
          workAccess: verified.verification!.workAccess,
        });
        expect(pending.blockers.map((blocker) => blocker.code)).not.toContain(
          'SUBMITTED_CONTENT_CHANGED',
        );
        expect(pending.availableActions).toContain('approve');
        expect(pending.canWork).toBe(false);
        expect((await capabilitiesOf(account.jar)).primaryReason).toBe('AWAITING_REVIEW');
        expect((await api(account.jar, '/v1/provider/bids')).status).toBe(403);

        await providerPage.goto('/provider/verification');
        await expect(providerPage.getByTestId('verification-VERIFIED_NO_ACCESS')).toBeVisible();
        const applicationStatus = providerPage.getByRole('button', {
          name: copy.applicationStatus,
          exact: true,
        });
        await expect(applicationStatus).toBeEnabled();
        await expect(providerPage.getByTestId('axis-identityVerified')).toHaveText(copy.identity);
        await capture(providerPage, testInfo, `lifecycle-provider-waiting-${lang}`, lang);
        await applicationStatus.click();
        await expect(providerPage).toHaveURL(/\/provider\/onboarding(?:\?|$)/);
        await expect(providerPage.getByTestId('hub-state-SUBMITTED')).toBeVisible();
        await expect(providerPage.getByTestId('review-feedback')).toHaveCount(0);
        await expect(providerPage.getByTestId('review-submit')).toHaveCount(0);

        await page.reload();
        await approveApplicationThroughBrowser(page, pending);
        const accepted = await providerApplicationReview(account);
        expect(accepted.submission).toMatchObject({
          id: pending.submission!.id,
          decision: 'ACCEPTED',
        });
        expect(accepted.provider).toMatchObject({
          providerStatus: 'ACTIVE',
          onboardingState: 'ACCEPTED',
        });
        expect(accepted.verification).toMatchObject({
          id: caseId,
          state: 'VERIFIED',
          decidedAt: verified.verification!.decidedAt,
          decisions: verified.verification!.decisions,
          workAccess: verified.verification!.workAccess,
        });
        expect(accepted.canWork).toBe(true);
        expect((await capabilitiesOf(account.jar)).allowed).toContain('SUBMIT_BID');
        expect((await api(account.jar, '/v1/provider/bids')).status).toBe(200);
        const history = await api<AdminProviderReviewHistoryResponse>(
          await adminJar(),
          `/v1/admin/providers/${account.profileId}/review/history`,
        );
        expect(history.status).toBe(200);
        expect(history.body.items).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              kind: 'CHANGES_REQUESTED',
              submission: expect.objectContaining({ id: original.submission!.id }),
            }),
            expect.objectContaining({
              kind: 'APPROVED',
              submission: expect.objectContaining({ id: pending.submission!.id }),
            }),
          ]),
        );
        expect(history.body.items.filter((item) => item.kind === 'IDENTITY_APPROVED')).toHaveLength(
          1,
        );
        await providerPage.goto('/provider/verification');
        await expect(providerPage.getByTestId('verification-VERIFIED_ACTIVE')).toBeVisible();
        await expect(providerPage.getByTestId('axis-workAccessActive')).toHaveText(copy.canWork);
        await expect(providerPage.getByTestId('axis-workAccessActive')).toHaveAttribute(
          'data-active',
          'true',
        );
        await capture(providerPage, testInfo, `lifecycle-provider-active-${lang}`, lang);
        const workspaceFeed = providerPage.waitForResponse(
          (response) =>
            response.url().startsWith(`${REAL_API}/v1/provider/available-requests`) &&
            response.request().method() === 'GET',
        );
        await providerPage.getByRole('button', { name: copy.workspace, exact: true }).click();
        await expect(providerPage).toHaveURL(/\/provider\/jobs(?:\?|$)/);
        expect((await workspaceFeed).status()).toBe(200);
        await expect(providerPage.getByTestId('pull-up-control')).toBeVisible();
        await testInfo.attach(`lifecycle-outcomes-${lang}.json`, {
          contentType: 'application/json',
          body: JSON.stringify({
            source: 'FINAL_REAL_API',
            commit: process.env.GITHUB_SHA ?? null,
            providerProfileId: account.profileId,
            caseId,
            originalSubmissionId: original.submission!.id,
            resubmissionId: pending.submission!.id,
            identityDecisionPreserved: true,
            applicationContentUnchanged: true,
            liveGrantBeforeApproval: verified.verification!.workAccess!.active,
            workBeforeApproval: verified.canWork,
            workAfterApproval: accepted.canWork,
            viewports: WIDTHS,
            language: lang,
          }),
        });
        expect(
          errors,
          'the complete recovery must not produce runtime or DOM nesting errors',
        ).toEqual([]);
      } finally {
        await context.close();
      }
    });
  }

  test('provider lifecycle recovery: independent identity approval keeps an undecided application reviewable without resubmission', async ({
    page,
  }) => {
    const account = await submittedProvider({ evidence: true });
    await enterAdmin(page);
    const pending = await openSubmittedProvider(page, account);
    expect(pending.submission?.decision).toBeNull();
    expect(pending.verification?.state).toBe('SUBMITTED');
    await approveIdentityThroughBrowser(page, pending);
    const verified = await providerApplicationReview(account);
    expect(verified.submission).toMatchObject({ id: pending.submission!.id, decision: null });
    expect(applicationContent(verified)).toEqual(applicationContent(pending));
    expect(verified.verification).toMatchObject({
      id: pending.verification!.id,
      state: 'VERIFIED',
      workAccess: { active: true },
    });
    expect(verified.blockers.map((blocker) => blocker.code)).not.toContain(
      'SUBMITTED_CONTENT_CHANGED',
    );
    expect(verified.availableActions).toContain('approve');
    expect(verified.canWork).toBe(false);
    expect((await capabilitiesOf(account.jar)).primaryReason).toBe('AWAITING_REVIEW');
    expect((await api(account.jar, '/v1/provider/bids')).status).toBe(403);
    await approveApplicationThroughBrowser(page, verified);
    const accepted = await providerApplicationReview(account);
    expect(accepted.submission).toMatchObject({ id: pending.submission!.id, decision: 'ACCEPTED' });
    expect(accepted.verification).toMatchObject({
      id: verified.verification!.id,
      state: 'VERIFIED',
      decidedAt: verified.verification!.decidedAt,
      decisions: verified.verification!.decisions,
      workAccess: verified.verification!.workAccess,
    });
    expect(accepted.canWork).toBe(true);
    expect((await api(account.jar, '/v1/provider/bids')).status).toBe(200);
  });

  test('guided provider verification: a clean draft leads to submission and one final Admin decision opens work', async ({
    page,
    browser,
  }, testInfo) => {
    const account = await submittedProvider();
    await approveCategoriesFor(account);
    const evidence = await supplyEvidence(account, 'guided-identity.png');
    await waitForEvidenceClean(account);
    const before = await providerApplicationReview(account);
    expect(before.verification).toMatchObject({ id: evidence.caseId, state: 'DRAFT' });
    expect(before.availableActions).not.toContain('approve');
    expect(before.canWork).toBe(false);
    expect((await api(account.jar, '/v1/provider/bids')).status).toBe(403);

    await enterAdmin(page);
    await openSubmittedProvider(page, account);
    await openReviewTask(page, 'BASICS_IDENTITY');
    const nextStep = page.getByTestId('review-identity-next-step');
    await expect(nextStep).toHaveAttribute('data-step', 'submit');
    await expect(page.getByTestId('review-case-approve')).toHaveCount(0);
    await expect(page.getByTestId('review-approve')).toHaveCount(0);

    const context = await browser.newContext({ baseURL: testInfo.project.use.baseURL });
    const providerPage = await context.newPage();
    const errors: string[] = [];
    observeRuntimeErrors(page, errors);
    observeRuntimeErrors(providerPage, errors);
    try {
      await providerPage.goto('/provider/status');
      await expect(providerPage).toHaveURL(/\/login(?:\?|$)/);
      await loginViaUi(providerPage, account);
      await expect(providerPage).toHaveURL(/\/provider\/status(?:\?|$)/);
      for (const lang of ['en', 'ar'] as const) {
        // Persist the real preference once per reload. Multiple addInitScript
        // setters on the same page have no defined execution order.
        await providerPage.evaluate((value) => localStorage.setItem('hsm.lang', value), lang);
        await page.evaluate((value) => localStorage.setItem('hsm.lang', value), lang);
        await providerPage.reload();
        await page.reload();
        await openReviewTask(page, 'BASICS_IDENTITY');
        await expect(providerPage.getByTestId('axis-verification')).toContainText(
          lang === 'ar' ? 'جاهزة للإرسال للمراجعة' : 'Ready to send for review',
        );
        await expect(providerPage.getByTestId('status-view-verification')).toBeEnabled();
        await expect(nextStep).toHaveAttribute('data-step', 'submit');
        for (const width of WIDTHS) {
          await providerPage.setViewportSize({ width, height: 900 });
          await page.setViewportSize({ width, height: 900 });
          await capture(
            providerPage,
            testInfo,
            `lifecycle-guided-provider-ready-${lang}-${width}`,
            lang,
          );
          await capture(page, testInfo, `lifecycle-guided-admin-next-step-${lang}-${width}`, lang);
        }
      }
      await providerPage.setViewportSize({ width: 390, height: 900 });
      await page.setViewportSize({ width: 1440, height: 900 });
      const accessibility = await new AxeBuilder({ page: providerPage })
        .include('[data-testid="provider-status-centre"]')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
        .analyze();
      expect(accessibility.violations).toEqual([]);
      await testInfo.attach('lifecycle-guided-status-accessibility.json', {
        contentType: 'application/json',
        body: JSON.stringify(accessibility.violations),
      });

      await providerPage.getByTestId('status-view-verification').click();
      await expect(providerPage).toHaveURL(/\/provider\/verification(?:\?|$)/);
      await expect(providerPage.getByTestId('verification-READY_TO_SUBMIT')).toBeVisible();
      const sent = providerPage.waitForResponse(
        (response) =>
          response.url() === `${REAL_API}${CASE_PATH}/submit` &&
          response.request().method() === 'POST',
      );
      await providerPage.getByRole('button', { name: COPY.ar.submit, exact: true }).click();
      expect((await sent).status()).toBe(200);
      await expect(providerPage.getByTestId('verification-PENDING_REVIEW')).toBeVisible();

      await page.getByTestId('review-refresh').click();
      await expect(nextStep).toHaveAttribute('data-step', 'review');
      const submitted = await providerApplicationReview(account);
      expect(submitted.verification).toMatchObject({ id: evidence.caseId, state: 'SUBMITTED' });
      expect(submitted.submission?.id).toBe(before.submission!.id);
      expect(submitted.availableActions).toContain('approve');
      const doc = submitted.verification!.documents.find(
        (item) => item.id === evidence.documentId,
      )!;
      expect(doc.viewable).toBe(true);
      const content = page.waitForResponse(
        (response) =>
          response.url() === `${REAL_API}/v1/verification/documents/${doc.id}/content` &&
          response.request().method() === 'GET',
      );
      await page.getByTestId(`review-evidence-${doc.id}`).click();
      expect((await content).status()).toBe(200);
      await expect
        .poll(() =>
          page
            .getByTestId('identity-evidence-image')
            .evaluate((image) => (image as HTMLImageElement).naturalWidth),
        )
        .toBeGreaterThan(0);
      await page.keyboard.press('Escape');

      // The normal final application command atomically verifies this submitted
      // case and creates work access. Do not issue a separate identity command.
      const decisions: string[] = [];
      page.on('request', (request) => {
        if (
          request.method() === 'POST' &&
          request.url().startsWith(REAL_API) &&
          /\/(review|verification\/cases\/[^/]+)\/approve$/.test(new URL(request.url()).pathname)
        ) {
          decisions.push(new URL(request.url()).pathname);
        }
      });
      await approveApplicationThroughBrowser(page, submitted);
      expect(decisions).toEqual([`/v1/admin/providers/${account.profileId}/review/approve`]);
      const accepted = await providerApplicationReview(account);
      expect(accepted.submission).toMatchObject({
        id: before.submission!.id,
        decision: 'ACCEPTED',
      });
      expect(accepted.verification).toMatchObject({
        id: evidence.caseId,
        state: 'VERIFIED',
        workAccess: { active: true, source: 'VERIFIED_DOCUMENTS' },
      });
      expect(
        accepted.verification!.decisions.filter((item) => item.toState === 'VERIFIED'),
      ).toHaveLength(1);
      expect(accepted.canWork).toBe(true);
      expect((await capabilitiesOf(account.jar)).allowed).toContain('SUBMIT_BID');
      expect((await api(account.jar, '/v1/provider/bids')).status).toBe(200);
      await providerPage.goto('/provider/status');
      await expect(providerPage.getByTestId('provider-workspace-unlocked')).toBeVisible();
      await capture(providerPage, testInfo, 'lifecycle-guided-provider-unlocked-ar', 'ar');
      const jobs = providerPage.waitForResponse(
        (response) =>
          response.url().startsWith(`${REAL_API}/v1/provider/available-requests`) &&
          response.request().method() === 'GET',
      );
      await providerPage.getByTestId('workspace-enter').click();
      await expect(providerPage).toHaveURL(/\/provider\/jobs(?:\?|$)/);
      expect((await jobs).status()).toBe(200);
      await testInfo.attach('lifecycle-guided-outcome.json', {
        contentType: 'application/json',
        body: JSON.stringify({
          source: 'FINAL_REAL_API',
          commit: process.env.GITHUB_SHA ?? null,
          caseId: evidence.caseId,
          submissionId: before.submission!.id,
          cleanDraftRequiredExplicitSubmit: true,
          finalApprovalCommands: decisions.length,
          identityDecisionCount: 1,
          applicationAccepted: true,
          workAccessAllowed: accepted.canWork,
        }),
      });
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });
});
