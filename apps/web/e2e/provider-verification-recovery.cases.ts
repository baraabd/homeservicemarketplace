import { expect, test, type Page, type TestInfo } from '@playwright/test';
import type {
  CurrentVerificationCaseResponse,
  FinalizeEvidenceUploadResponse,
  GetProviderProfileResponse,
  ProviderCapabilitiesResponse,
  ProviderOnboardingHubView,
  UpgradeToProviderResponse,
} from '@homeservicemarketplace/contracts';

import { expectNoHorizontalPageOverflow, seedLanguage } from './fixtures';
import { LEGAL_ACCEPTANCE } from './legal-acceptance';
import { EVIDENCE_PNG, waitForEvidenceClean } from './phase3-activation';
import {
  acceptTerms,
  api,
  completeDraft,
  loginViaUi,
  newJar,
  otpFor,
  REAL_API,
  type Account,
} from './real-api';

const CASE_PATH = '/v1/me/provider/verification/case';
const CAPS_PATH = '/v1/me/provider/capabilities';
const COPY = {
  en: {
    continueRegistration: 'Continue sign-up',
    start: 'Start verification',
    add: 'Add a document',
    submit: 'Send for review',
    returnToApplication: 'Return to application',
    profileRequired:
      'Complete the missing details in your application, then return here to send your documents for review.',
    profileAndTermsRequired:
      'Complete the missing application details and accept the current terms, then return here to send your documents for review.',
  },
  ar: {
    continueRegistration: 'متابعة التسجيل',
    start: 'ابدأ التوثيق',
    add: 'إضافة مستند',
    submit: 'إرسال للمراجعة',
    returnToApplication: 'العودة إلى طلب الانضمام',
    profileRequired:
      'أكمل البيانات الناقصة في طلب الانضمام، ثم عد إلى هنا لإرسال مستنداتك للمراجعة.',
    profileAndTermsRequired:
      'أكمل بيانات طلب الانضمام الناقصة ووافق على الشروط الحالية، ثم عد إلى هنا لإرسال مستنداتك للمراجعة.',
  },
} as const;

/** Registration and OTP only. A provider profile or a refreshed provider role
 * here would skip the recovery and activation that this regression must prove. */
async function registerApplicant(): Promise<Account> {
  const jar = newJar();
  const email = `identity-recovery-${Date.now()}-${Math.floor(Math.random() * 1e6)}@itest.local`;
  const password = 'a-reasonable-passphrase-1';
  const registered = await api<{ challengeId: string }>(jar, '/v1/auth/register', {
    method: 'POST',
    body: {
      email,
      password,
      firstName: 'Nour',
      lastName: 'Applicant',
      legalAcceptance: LEGAL_ACCEPTANCE,
    },
  });
  expect(registered.status, 'registration should succeed').toBeLessThan(400);
  const verified = await api(jar, '/v1/auth/verify-otp', {
    method: 'POST',
    body: { challengeId: registered.body.challengeId, code: await otpFor(email) },
  });
  expect(verified.status, 'registration OTP should verify').toBe(200);
  return { email, password, jar, profileId: '' };
}

async function capture(page: Page, testInfo: TestInfo, name: string, lang: 'en' | 'ar') {
  await expect(page.locator('html')).toHaveAttribute('lang', lang);
  await expect(page.locator('html')).toHaveAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr');
  await expectNoHorizontalPageOverflow(page);
  await page.evaluate(() => document.fonts.ready);
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path, fullPage: true, animations: 'disabled' });
  await testInfo.attach(name, { path, contentType: 'image/png' });
}

// Imported by the existing real-API Admin acceptance entrypoint. No API route
// interception, injected session, direct database writes or permission grants.
for (const scenario of [
  { lang: 'ar', width: 390 },
  { lang: 'en', width: 1440 },
] as const) {
  test(`identity recovery: ${scenario.lang} applicant activates, uploads before profile completion and returns to submit`, async ({
    page,
  }, testInfo) => {
    const { lang, width } = scenario;
    const copy = COPY[lang];
    const name = `identity-recovery-${lang}`;
    const account = await registerApplicant();
    const before = await api<ProviderCapabilitiesResponse>(account.jar, CAPS_PATH);
    expect(before.status).toBe(200);
    expect(before.body.primaryReason).toBe('NO_PROVIDER_PROFILE');
    expect(before.body.nextActions).toContain('COMPLETE_PROFILE');
    expect(before.body.allowed).not.toContain('MANAGE_VERIFICATION');

    const runtimeErrors: string[] = [];
    const caseRequests: string[] = [];
    page.on('pageerror', (error) => runtimeErrors.push(error.message));
    page.on('console', (message) => {
      if (
        /validateDOMNesting|cannot (appear|be).*descendant|hydration failed/i.test(message.text())
      ) {
        runtimeErrors.push(message.text());
      }
    });
    page.on('request', (request) => {
      if (request.url().startsWith(`${REAL_API}${CASE_PATH}`)) {
        caseRequests.push(`${request.method()} ${new URL(request.url()).pathname}`);
      }
    });
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/provider/verification');
    await expect(page).toHaveURL(/\/login(?:\?|$)/);
    await loginViaUi(page, account);
    await expect(page).toHaveURL(/\/provider\/verification(?:\?|$)/);
    await seedLanguage(page, lang);
    await page.reload();
    await expect(page.getByTestId('verification-ONBOARDING_INCOMPLETE')).toBeVisible();
    await expect(
      page.getByRole('button', { name: copy.continueRegistration, exact: true }),
    ).toBeEnabled();
    await expect(page.getByRole('button', { name: copy.start, exact: true })).toHaveCount(0);
    await expect(page.locator('input[type="file"]')).toHaveCount(0);
    expect(
      caseRequests,
      'a profile-less applicant must not request the guarded case endpoint',
    ).toEqual([]);
    expect(
      await page.evaluate(() => localStorage.getItem('hsm.ff.providerOnboardingV2')),
    ).toBeNull();
    await capture(page, testInfo, `${name}-continue-registration`, lang);

    await page.getByRole('button', { name: copy.continueRegistration, exact: true }).click();
    await expect(page).toHaveURL(/\/provider\/activate(?:\?|$)/);
    await expect(page.getByTestId('activation-hero')).toBeVisible();
    const upgrade = page.waitForResponse(
      (response) =>
        response.url() === `${REAL_API}/v1/me/provider/upgrade` &&
        response.request().method() === 'POST',
    );
    const refresh = page.waitForResponse(
      (response) =>
        response.url() === `${REAL_API}/v1/auth/refresh` && response.request().method() === 'POST',
    );
    await page.getByTestId('activation-cta').click();
    const upgraded = await upgrade;
    expect(upgraded.status()).toBe(200);
    expect((await refresh).status()).toBe(200);
    account.profileId = ((await upgraded.json()) as UpgradeToProviderResponse).profile.id;
    await expect(page).toHaveURL(/\/provider\/onboarding(?:\?|$)/);
    await expect(page.getByTestId('hub-task-list')).toBeVisible();

    // Follow the session actually rotated by the UI. Nothing is installed in
    // the browser; independent HTTP reads use the browser's genuine cookies.
    account.jar.clear();
    for (const cookie of await page.context().cookies()) account.jar.set(cookie.name, cookie.value);
    const hub = await api<ProviderOnboardingHubView>(account.jar, '/v1/me/provider/onboarding/hub');
    expect(hub.status).toBe(200);
    expect(hub.body.status).toBe('DRAFT');
    expect(hub.body.progress.complete).toBeLessThan(hub.body.progress.total);
    const caps = await api<ProviderCapabilitiesResponse>(account.jar, CAPS_PATH);
    expect(caps.status).toBe(200);
    expect(caps.body.primaryReason).toBe('ONBOARDING_INCOMPLETE');
    expect(caps.body.allowed).toContain('MANAGE_VERIFICATION');
    expect(caps.body.allowed).not.toContain('SUBMIT_BID');
    const profile = await api<GetProviderProfileResponse>(account.jar, '/v1/me/provider/profile');
    expect(profile.status).toBe(200);
    expect(profile.body.profile).toMatchObject({ status: 'DRAFT', verified: false });

    await page.goto('/provider/verification');
    await expect(page.getByTestId('verification-NOT_STARTED')).toBeVisible();
    await expect(page.getByTestId('axis-onboardingComplete')).toHaveAttribute(
      'data-active',
      'false',
    );
    await expect(page.getByTestId('axis-workAccessActive')).toHaveAttribute('data-active', 'false');
    await capture(page, testInfo, `${name}-draft-start`, lang);
    const creation = page.waitForResponse(
      (response) =>
        response.url() === `${REAL_API}${CASE_PATH}` && response.request().method() === 'POST',
    );
    await page.getByRole('button', { name: copy.start, exact: true }).click();
    expect((await creation).status()).toBe(200);
    await expect(page.getByTestId('verification-EVIDENCE_REQUIRED')).toBeVisible();
    await capture(page, testInfo, `${name}-add-document`, lang);

    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: copy.add, exact: true }).click();
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
    ).setFiles({ name: `${name}.png`, mimeType: 'image/png', buffer: EVIDENCE_PNG });
    const responses = await Promise.all([prepared, uploaded, finalized]);
    expect(responses.map((response) => response.status())).toEqual([200, 200, 200]);
    const document = (await responses[2].json()) as FinalizeEvidenceUploadResponse;
    await waitForEvidenceClean(account);
    await expect(page.getByTestId('verification-READY_TO_SUBMIT')).toBeVisible();
    await capture(page, testInfo, `${name}-uploaded-before-profile-completion`, lang);

    const attemptedSubmission = page.waitForResponse(
      (response) =>
        response.url() === `${REAL_API}${CASE_PATH}/submit` &&
        response.request().method() === 'POST',
    );
    await page.getByRole('button', { name: copy.submit, exact: true }).click();
    const blocked = await attemptedSubmission;
    expect(blocked.status()).toBe(422);
    const refusal = (await blocked.json()) as {
      error: { code: string; details: { blockers: Array<{ code: string }> } };
    };
    expect(refusal.error.code).toBe('VALIDATION_ERROR');
    const blockerCodes = refusal.error.details.blockers.map((blocker) => blocker.code);
    expect(blockerCodes).toContain('ONBOARDING_INCOMPLETE');
    // Verification has a nullable consent setting. The review endpoint's v1
    // fallback is not proof that verification requires terms. Assert the
    // actual documented refusal and its corresponding recovery copy, without
    // installing an operator setting merely to manufacture a test condition.
    const termsRequired = blockerCodes.includes('TERMS_NOT_ACCEPTED');
    await expect(page.getByTestId('verification-error')).toHaveText(
      termsRequired ? copy.profileAndTermsRequired : copy.profileRequired,
    );
    await testInfo.attach(`${name}-readiness.json`, {
      contentType: 'application/json',
      body: JSON.stringify({
        source: 'FINAL_REAL_API',
        status: blocked.status(),
        code: refusal.error.code,
        blockerCodes,
        termsRequired,
      }),
    });
    await capture(page, testInfo, `${name}-application-required`, lang);
    await page.getByRole('link', { name: copy.returnToApplication, exact: true }).click();
    await expect(page).toHaveURL(/\/provider\/onboarding(?:\?|$)/);
    await expect(page.getByTestId('hub-task-list')).toBeVisible();
    const saved = await api<CurrentVerificationCaseResponse>(account.jar, CASE_PATH);
    expect(saved.status).toBe(200);
    expect(saved.body.case?.state).toBe('DRAFT');
    expect(saved.body.case?.documents).toEqual([
      expect.objectContaining({ id: document.documentId, scanState: 'CLEAN', superseded: false }),
    ]);

    // Only after proving early upload and actionable readiness errors do we
    // complete unrelated fields using the existing public-API fixture. The
    // browser must then submit and reload the same already-uploaded document.
    await completeDraft(account);
    await acceptTerms(account);
    await page.goto('/provider/verification');
    await expect(page.getByTestId('verification-READY_TO_SUBMIT')).toBeVisible();
    const submission = page.waitForResponse(
      (response) =>
        response.url() === `${REAL_API}${CASE_PATH}/submit` &&
        response.request().method() === 'POST',
    );
    await page.getByRole('button', { name: copy.submit, exact: true }).click();
    expect((await submission).status()).toBe(200);
    await expect(page.getByTestId('verification-PENDING_REVIEW')).toBeVisible();
    await page.reload();
    await expect(page.getByTestId('verification-PENDING_REVIEW')).toBeVisible();
    await expect(
      page.getByRole('link', { name: copy.returnToApplication, exact: true }),
    ).toBeVisible();
    await expect(page.getByTestId('axis-workAccessActive')).toHaveAttribute('data-active', 'false');
    await capture(page, testInfo, `${name}-submitted-return`, lang);
    const persisted = await api<CurrentVerificationCaseResponse>(account.jar, CASE_PATH);
    expect(persisted.status).toBe(200);
    expect(persisted.body.case).toMatchObject({ id: saved.body.case!.id, state: 'SUBMITTED' });
    expect(persisted.body.case?.documents).toEqual([
      expect.objectContaining({ id: document.documentId, scanState: 'CLEAN', superseded: false }),
    ]);
    const finalCaps = await api<ProviderCapabilitiesResponse>(account.jar, CAPS_PATH);
    expect(finalCaps.status).toBe(200);
    expect(finalCaps.body.allowed).not.toContain('SUBMIT_BID');
    const unapproved = await api<GetProviderProfileResponse>(
      account.jar,
      '/v1/me/provider/profile',
    );
    expect(unapproved.status).toBe(200);
    expect(unapproved.body.profile).toMatchObject({ status: 'DRAFT', verified: false });
    expect((await api(account.jar, '/v1/provider/bids')).status).toBe(403);
    expect(
      runtimeErrors,
      'recovery and upload must not produce runtime or DOM nesting errors',
    ).toEqual([]);
  });
}
