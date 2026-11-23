import { expect, type Page, type TestInfo } from '@playwright/test';
import type {
  AdminProviderReview,
  CurrentVerificationCaseResponse,
  FinalizeEvidenceUploadResponse,
} from '@homeservicemarketplace/contracts';

import { openReviewTask } from './admin-review-tabs';
import { recordAdminEvidence } from './admin-review-real-api';
import { expectNoHorizontalPageOverflow } from './fixtures';
import {
  capabilitiesOf,
  EVIDENCE_PNG,
  providerApplicationReview,
  waitForEvidenceClean,
} from './phase3-activation';
import { api, REAL_API, type Account } from './real-api';

const COPY = {
  en: {
    start: 'Start verification',
    add: 'Add a document',
    replace: 'Replace the document',
    submit: 'Send for review',
    resubmit: 'Send updates for review',
    returnToApplication: 'Return to application',
    reviewApplication: 'Review and resubmit',
    identityDocuments: 'Identity documents',
  },
  ar: {
    start: 'ابدأ التوثيق',
    add: 'إضافة مستند',
    replace: 'استبدال المستند',
    submit: 'إرسال للمراجعة',
    resubmit: 'إرسال التعديلات للمراجعة',
    returnToApplication: 'العودة إلى طلب الانضمام',
    reviewApplication: 'المراجعة وإعادة الإرسال',
    identityDocuments: 'وثائق الهوية',
  },
} as const;

/** Continue the actual correction link through upload and submission. The API
 * owns every state transition; this helper never supplies evidence by API or
 * changes scan, case, application or grant state behind the browser. */
export async function submitIdentityCorrectionThroughBrowser(input: {
  providerPage: Page;
  adminPage: Page;
  account: Account;
  original: AdminProviderReview;
  testInfo: TestInfo;
  lang: 'en' | 'ar';
  providerMessage: string;
}) {
  const { providerPage, adminPage, account, original, testInfo, lang, providerMessage } = input;
  const copy = COPY[lang];
  const replacing = original.verification !== null;
  const evidenceName = `provider-identity-${replacing ? 'replacement' : 'first'}-${lang}`;
  const captureProviderEvidence = async (state: string) => {
    const name = `${evidenceName}-${state}`;
    const screenshot = testInfo.outputPath(`${name}.png`);
    await providerPage.screenshot({ path: screenshot, fullPage: true, animations: 'disabled' });
    await testInfo.attach(name, { path: screenshot, contentType: 'image/png' });
  };
  await expect(providerPage.locator('html')).toHaveAttribute('lang', lang);
  await expect(providerPage.locator('html')).toHaveAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr');
  const capabilities = await capabilitiesOf(account.jar);
  // The overall work blocker must not hide a separately authorized task.
  expect(capabilities.primaryReason).toBe('ONBOARDING_INCOMPLETE');
  expect(capabilities.allowed).toContain('MANAGE_VERIFICATION');
  expect(capabilities.allowed).not.toContain('SUBMIT_BID');

  if (!replacing) {
    await expect(providerPage.getByTestId('verification-NOT_STARTED')).toBeVisible();
    const creation = providerPage.waitForResponse(
      (response) =>
        response.url() === `${REAL_API}/v1/me/provider/verification/case` &&
        response.request().method() === 'POST',
    );
    await providerPage.getByRole('button', { name: copy.start, exact: true }).click();
    expect((await creation).status()).toBe(200);
    await expect(providerPage.getByTestId('verification-EVIDENCE_REQUIRED')).toBeVisible();
  } else {
    await expect(providerPage.getByTestId('verification-CHANGES_REQUESTED')).toBeVisible();
    await expect(providerPage.getByTestId('verification-reason')).toBeVisible();
  }

  const filename = replacing ? 'identity-browser-replacement.png' : 'identity-browser-first.png';
  const chooser = providerPage.waitForEvent('filechooser');
  await providerPage
    .getByRole('button', {
      name: replacing ? copy.replace : copy.add,
      exact: true,
    })
    .click();
  const prepared = providerPage.waitForResponse(
    (response) =>
      response.url() === `${REAL_API}/v1/me/provider/verification/evidence/prepare` &&
      response.request().method() === 'POST',
  );
  const uploaded = providerPage.waitForResponse(
    (response) =>
      response.url().startsWith(`${REAL_API}/v1/me/provider/verification/evidence/`) &&
      response.url().endsWith('/content') &&
      response.request().method() === 'PUT',
  );
  const finalized = providerPage.waitForResponse(
    (response) =>
      response.url().startsWith(`${REAL_API}/v1/me/provider/verification/evidence/`) &&
      response.url().endsWith('/finalize') &&
      response.request().method() === 'POST',
  );
  await (await chooser).setFiles({ name: filename, mimeType: 'image/png', buffer: EVIDENCE_PNG });
  const uploadResponses = await Promise.all([prepared, uploaded, finalized]);
  expect(uploadResponses.map((response) => response.status())).toEqual([200, 200, 200]);
  const document = (await uploadResponses[2].json()) as FinalizeEvidenceUploadResponse;
  expect(document.documentId).toEqual(expect.any(String));
  expect(original.verification?.documents.map((entry) => entry.id) ?? []).not.toContain(
    document.documentId,
  );

  // The real worker scans the bytes. Its completion must reach the open UI,
  // rather than leaving the provider on an endless upload/wait screen.
  await waitForEvidenceClean(account);
  const submit = providerPage.getByRole('button', {
    name: replacing ? copy.resubmit : copy.submit,
    exact: true,
  });
  await expect(submit).toBeEnabled({ timeout: 15_000 });
  await providerPage.reload();
  await expect(submit).toBeEnabled();
  await expectNoHorizontalPageOverflow(providerPage);
  await captureProviderEvidence('ready');

  const submitted = providerPage.waitForResponse(
    (response) =>
      response.url() === `${REAL_API}/v1/me/provider/verification/case/submit` &&
      response.request().method() === 'POST',
  );
  await submit.click();
  const submittedResponse = await submitted;
  const submittedBody = (await submittedResponse.json()) as {
    error?: {
      code?: string;
      details?: {
        blockers?: Array<{ code?: string; field?: string; kind?: string; scanState?: string }>;
      };
    };
  };
  // Only authored public blocker codes/field names belong in diagnostics, not
  // arbitrary error messages, credentials, headers or response bodies.
  const blockers = submittedBody.error?.details?.blockers?.map(
    ({ code, field, kind, scanState }) => ({
      code,
      field,
      kind,
      scanState,
    }),
  );
  expect(
    submittedResponse.status(),
    `identity submission: ${JSON.stringify({ code: submittedBody.error?.code, blockers })}`,
  ).toBe(200);
  await expect(providerPage.getByTestId('verification-PENDING_REVIEW')).toBeVisible();

  const ownCase = await api<CurrentVerificationCaseResponse>(
    account.jar,
    '/v1/me/provider/verification/case',
  );
  expect(ownCase.status).toBe(200);
  expect(ownCase.body.case?.state).toBe('SUBMITTED');
  expect(ownCase.body.case?.submittedAt).toEqual(expect.any(String));
  if (replacing) expect(ownCase.body.case?.id).toBe(original.verification!.id);
  expect(ownCase.body.case?.documents.filter((entry) => !entry.superseded)).toEqual([
    expect.objectContaining({ id: document.documentId, scanState: 'CLEAN' }),
  ]);

  const review = await providerApplicationReview(account);
  expect(review.verification?.state).toBe('SUBMITTED');
  // Submitting identity does not silently resubmit/approve the application.
  expect(review.submission?.decision).toBe('RETURNED');
  expect(review.availableActions).not.toContain('approve');
  expect(review.canWork).toBe(false);
  expect((await capabilitiesOf(account.jar)).allowed).not.toContain('SUBMIT_BID');
  expect((await api(account.jar, '/v1/provider/bids')).status).toBe(403);
  const returnToApplication = providerPage.getByRole('link', {
    name: copy.returnToApplication,
    exact: true,
  });
  await expect(returnToApplication).toBeVisible();
  await expectNoHorizontalPageOverflow(providerPage);
  await captureProviderEvidence('submitted-return-available');

  await adminPage.reload();
  await openReviewTask(adminPage, 'BASICS_IDENTITY');
  const opener = adminPage.getByTestId(`review-evidence-${document.documentId}`);
  await expect(opener).toBeEnabled();
  // Reopening must re-enter the authorized, audited byte endpoint each time.
  for (let read = 0; read < 2; read++) {
    const content = adminPage.waitForResponse(
      (response) =>
        response.url() === `${REAL_API}/v1/verification/documents/${document.documentId}/content` &&
        response.request().method() === 'GET',
    );
    await opener.click();
    const response = await content;
    expect(response.status()).toBe(200);
    expect(response.headers()['cache-control']).toContain('no-store');
    const image = adminPage.getByTestId('identity-evidence-image');
    await expect
      .poll(() => image.evaluate((element) => (element as HTMLImageElement).naturalWidth))
      .toBeGreaterThan(0);
    if (read === 0) {
      await recordAdminEvidence(adminPage, testInfo, `${evidenceName}-admin-preview`, review, {
        accessibilityScope: '[role="dialog"]',
        fullPage: false,
      });
    }
    await adminPage.keyboard.press('Escape');
    await expect(opener).toBeFocused();
  }

  // Identity submission leaves the application returned. Follow the offered
  // route and hand the corrected application in through the ordinary UI.
  await returnToApplication.click();
  await expect(providerPage).toHaveURL(/\/provider\/onboarding(?:\?|$)/);
  const feedback = providerPage.getByTestId('review-feedback');
  await expect(feedback).toContainText(providerMessage);
  await expectNoHorizontalPageOverflow(providerPage);
  await feedback.getByRole('button', { name: copy.reviewApplication, exact: true }).click();
  await expect(providerPage.getByTestId('review-screen')).toBeVisible();
  await providerPage.getByTestId('review-continue-to-consent').click();
  await expect(providerPage.getByTestId('terms-accepted')).toBeVisible();
  const applicationSubmit = providerPage.getByTestId('review-submit');
  await expect(applicationSubmit).toBeEnabled();
  const applicationSubmitted = providerPage.waitForResponse(
    (response) =>
      response.url() === `${REAL_API}/v1/me/provider/onboarding/submit` &&
      response.request().method() === 'POST',
  );
  await applicationSubmit.click();
  expect((await applicationSubmitted).status()).toBe(200);
  await expect(providerPage.getByTestId('review-submitted')).toBeVisible();

  const resubmitted = await providerApplicationReview(account);
  // The submit command persists DOCUMENTS_REQUIRED; only the hub projects
  // that lifecycle as SUBMITTED. Identity still awaits a human decision.
  expect(resubmitted.provider.onboardingState).toBe('DOCUMENTS_REQUIRED');
  expect(resubmitted.submission?.id).not.toBe(original.submission!.id);
  expect(resubmitted.submission?.decision).toBeNull();
  expect(resubmitted.verification).toMatchObject({
    id: ownCase.body.case!.id,
    state: 'SUBMITTED',
  });
  expect(resubmitted.canWork).toBe(false);

  // The documented browser override changes only the UI. The legacy status
  // entry must expose this same server-authorized task with no workspace grant.
  await providerPage.addInitScript(() => {
    window.localStorage.setItem('hsm.ff.providerOnboardingV2', 'false');
  });
  await providerPage.goto('/provider/status');
  const legacyEntry = providerPage.getByTestId('provider-status-verification');
  await expect(legacyEntry).toHaveText(copy.identityDocuments);
  await expect(legacyEntry).toBeEnabled();
  await expectNoHorizontalPageOverflow(providerPage);
  await captureProviderEvidence('legacy-status-entry');
  await legacyEntry.click();
  await expect(providerPage).toHaveURL(/\/provider\/verification(?:\?|$)/);
  await expect(providerPage.getByTestId('verification-PENDING_REVIEW')).toBeVisible();
  await expect(providerPage.getByTestId('axis-workAccessActive')).toHaveAttribute(
    'data-active',
    'false',
  );
  const unchangedCase = await api<CurrentVerificationCaseResponse>(
    account.jar,
    '/v1/me/provider/verification/case',
  );
  expect(unchangedCase.status).toBe(200);
  expect(unchangedCase.body.case).toMatchObject({ id: ownCase.body.case!.id, state: 'SUBMITTED' });
  expect((await capabilitiesOf(account.jar)).allowed).not.toContain('SUBMIT_BID');
  expect((await api(account.jar, '/v1/provider/bids')).status).toBe(403);
}
