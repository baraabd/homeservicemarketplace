import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import type {
  AdminPortfolioListResponse,
  AdminProviderReviewHistoryResponse,
  CurrentVerificationCaseResponse,
  ProviderOnboardingReview,
} from '@homeservicemarketplace/contracts';
import { openReviewTask } from './admin-review-tabs';
import {
  enterAdmin,
  openSubmittedProvider,
  recordAdminEvidence,
  submittedProvider,
} from './admin-review-real-api';
import {
  capabilitiesOf,
  providerApplicationReview,
  submitVerificationCase,
  supplyEvidence,
  waitForEvidenceClean,
} from './phase3-activation';
import {
  adminJar,
  api,
  newJar,
  REAL_API,
  registerProvider,
  type Account,
  type Jar,
} from './real-api';

// Public HTTP setup and real browser interaction only. In particular these
// cases cannot backdate retention or grant reviewer permissions with SQL.
async function resubmitApplication(account: Account) {
  const readiness = await api<ProviderOnboardingReview>(
    account.jar,
    '/v1/me/provider/onboarding/review',
  );
  expect(readiness.status).toBe(200);
  expect(readiness.body.canSubmit, JSON.stringify(readiness.body)).toBe(true);
  const result = await api(account.jar, '/v1/me/provider/onboarding/submit', {
    method: 'POST',
    body: { version: readiness.body.draftVersion },
  });
  expect(result.status, JSON.stringify(result.body)).toBe(200);
}

async function readBytes(jar: Jar, path: string) {
  return fetch(`${REAL_API}${path}`, {
    headers: { Cookie: [...jar].map(([name, value]) => `${name}=${value}`).join('; ') },
  });
}

test('identity corrections preserve inspectable history while the latest replacement completes resubmission and final approval', async ({
  page,
}, testInfo) => {
  const account = await submittedProvider({ evidence: true });
  await enterAdmin(page);
  const original = await openSubmittedProvider(page, account);
  const originalDocument = original.verification!.documents.find(
    (document) => !document.supersededAt,
  )!;
  expect(originalDocument.viewable).toBe(true);
  const message = 'Please replace the identity document with a clear current photograph.';
  await page.getByTestId('review-identity-request-replacement').click();
  await page.getByRole('dialog').getByRole('textbox').fill(message);
  const returnedResponse = page.waitForResponse(
    (response) =>
      response.url() ===
        `${REAL_API}/v1/admin/providers/${account.profileId}/review/request-changes` &&
      response.request().method() === 'POST',
  );
  await page.getByTestId('review-evidence-correction-send').click();
  expect((await returnedResponse).status()).toBe(200);
  const returned = await providerApplicationReview(account);
  expect(returned.verification?.state).toBe('ACTION_REQUIRED');
  expect(returned.submission?.decision).toBe('RETURNED');
  expect((await capabilitiesOf(account.jar)).allowed).not.toContain('SUBMIT_BID');

  const firstReplacement = await supplyEvidence(account, 'identity-first-replacement.png');
  await waitForEvidenceClean(account);
  const latestReplacement = await supplyEvidence(account, 'identity-current.png');
  expect(firstReplacement.caseId).toBe(original.verification!.id);
  expect(latestReplacement.caseId).toBe(original.verification!.id);
  expect(latestReplacement.documentId).not.toBe(firstReplacement.documentId);
  await waitForEvidenceClean(account);
  const ownCase = await api<CurrentVerificationCaseResponse>(
    account.jar,
    '/v1/me/provider/verification/case',
  );
  expect(ownCase.status).toBe(200);
  expect(ownCase.body.case!.documents.filter((document) => !document.superseded)).toEqual([
    expect.objectContaining({ id: latestReplacement.documentId, scanState: 'CLEAN' }),
  ]);
  expect(
    ownCase.body
      .case!.documents.filter((document) => document.superseded)
      .map((document) => document.id),
  ).toEqual(expect.arrayContaining([originalDocument.id, firstReplacement.documentId]));
  await submitVerificationCase(account);
  await resubmitApplication(account);

  const resubmitted = await providerApplicationReview(account);
  expect(resubmitted.submission?.id).not.toBe(original.submission!.id);
  expect(resubmitted.submission?.decision).toBeNull();
  expect(resubmitted.verification?.state).toBe('SUBMITTED');
  expect(resubmitted.availableActions, JSON.stringify(resubmitted.blockers)).toContain('approve');
  expect(resubmitted.verification!.documents.filter((document) => !document.supersededAt)).toEqual([
    expect.objectContaining({ id: latestReplacement.documentId, viewable: true }),
  ]);
  expect((await api(account.jar, '/v1/provider/bids')).status).toBe(403);
  await page.reload();
  await openReviewTask(page, 'BASICS_IDENTITY');
  const identity = page.getByTestId('review-identity');
  const previous = identity
    .locator('details')
    .filter({ has: page.locator('summary', { hasText: 'Previous documents' }) });
  await expect(previous).toBeVisible();
  await expect(previous.locator('summary')).toContainText('2');
  await previous.locator('summary').click();
  await expect(previous).toContainText('were replaced');
  await expect(previous).not.toContainText('Pending review');
  for (const documentId of [originalDocument.id, firstReplacement.documentId]) {
    await expect(previous.getByTestId(`review-evidence-${documentId}`)).toBeEnabled();
    await expect(previous.getByTestId(`review-evidence-download-${documentId}`)).toBeEnabled();
  }
  // Historical evidence remains privately inspectable while retained; opening
  // it cannot change which current document satisfies the case requirement.
  const historicalBytes = page.waitForResponse(
    (response) =>
      response.url() === `${REAL_API}/v1/verification/documents/${originalDocument.id}/content` &&
      response.request().method() === 'GET',
  );
  await previous.getByTestId(`review-evidence-${originalDocument.id}`).click();
  expect((await historicalBytes).status()).toBe(200);
  await expect
    .poll(() =>
      page
        .getByTestId('identity-evidence-image')
        .evaluate((element) => (element as HTMLImageElement).naturalWidth),
    )
    .toBeGreaterThan(0);
  await page.keyboard.press('Escape');
  expect(
    (await providerApplicationReview(account))
      .verification!.documents.filter((document) => !document.supersededAt)
      .map((document) => document.id),
  ).toEqual([latestReplacement.documentId]);
  const latestOpener = page.getByTestId(`review-evidence-${latestReplacement.documentId}`);
  await expect(latestOpener).toBeEnabled();
  const bytes = page.waitForResponse(
    (response) =>
      response.url() ===
        `${REAL_API}/v1/verification/documents/${latestReplacement.documentId}/content` &&
      response.request().method() === 'GET',
  );
  await latestOpener.click();
  const inspected = await bytes;
  expect(inspected.status()).toBe(200);
  expect(inspected.headers()['cache-control']).toContain('no-store');
  const image = page.getByTestId('identity-evidence-image');
  await expect
    .poll(() => image.evaluate((element) => (element as HTMLImageElement).naturalWidth))
    .toBeGreaterThan(0);
  await page.keyboard.press('Escape');
  await expect(latestOpener).toBeFocused();
  const download = page.waitForEvent('download');
  await page.getByTestId(`review-evidence-download-${latestReplacement.documentId}`).click();
  expect((await download).suggestedFilename()).toBe('identity-current.png');
  await recordAdminEvidence(page, testInfo, 'identity-replaced-and-current-real-api', resubmitted);

  // A decision for the original submission cannot accept the replacement
  // application. This is an independent reviewer session, not a UI stub.
  const stale = await api(
    await adminJar(),
    `/v1/admin/providers/${account.profileId}/review/approve`,
    {
      method: 'POST',
      body: {
        submissionId: original.submission!.id,
        expectedRevision: original.revision,
        idempotencyKey: randomUUID(),
        reasonCode: 'DOCUMENTS_COMPLETE_AND_LEGIBLE',
      },
    },
  );
  expect(stale.status).toBe(409);
  expect((await capabilitiesOf(account.jar)).allowed).not.toContain('SUBMIT_BID');
  await page.getByTestId('review-approve').click();
  await page.getByTestId('review-approval-ack').check();
  const approvedResponse = page.waitForResponse(
    (response) =>
      response.url() === `${REAL_API}/v1/admin/providers/${account.profileId}/review/approve` &&
      response.request().method() === 'POST',
  );
  await page.getByTestId('review-confirm').click();
  const approved = await approvedResponse;
  expect(approved.status()).toBe(200);
  expect(approved.request().postDataJSON()).toMatchObject({
    submissionId: resubmitted.submission!.id,
    expectedRevision: resubmitted.revision,
  });
  const accepted = await providerApplicationReview(account);
  expect(accepted.submission).toMatchObject({
    id: resubmitted.submission!.id,
    decision: 'ACCEPTED',
  });
  expect(accepted.provider).toMatchObject({
    providerStatus: 'ACTIVE',
    onboardingState: 'ACCEPTED',
  });
  expect(accepted.verification?.state).toBe('VERIFIED');
  expect(accepted.verification?.workAccess?.active).toBe(true);
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
        submission: expect.objectContaining({ id: resubmitted.submission!.id }),
      }),
      expect.objectContaining({ kind: 'IDENTITY_APPROVED' }),
    ]),
  );
  await page.reload();
  await expect(page.getByTestId('review-approve')).toHaveCount(0);
});

test('protected identity and pending portfolio previews deny anonymous and other-provider access without exposing storage credentials', async () => {
  const owner = await submittedProvider({ evidence: true, portfolio: true });
  const stranger = await registerProvider();
  const review = await providerApplicationReview(owner);
  const document = review.verification!.documents.find((entry) => entry.viewable)!;
  const identityPath = `/v1/verification/documents/${document.id}/content`;
  const portfolio = await api<AdminPortfolioListResponse>(
    await adminJar(),
    `/v1/admin/providers/${owner.profileId}/portfolio`,
  );
  expect(portfolio.status).toBe(200);
  const item = portfolio.body.items[0]!;
  expect(item.moderationState).toBe('PENDING');
  const ownerImagePath = `/v1/me/provider/portfolio/${item.id}/media`;
  const adminImagePath = `/v1/admin/providers/${owner.profileId}/portfolio/${item.id}/media`;
  for (const path of [identityPath, ownerImagePath, adminImagePath]) {
    expect((await readBytes(newJar(), path)).status).toBe(401);
  }
  expect((await readBytes(stranger.jar, identityPath)).status).toBe(404);
  expect((await readBytes(stranger.jar, ownerImagePath)).status).toBe(404);
  expect((await readBytes(stranger.jar, adminImagePath)).status).toBe(403);
  expect((await api(stranger.jar, `/v1/admin/providers/${owner.profileId}/review`)).status).toBe(
    403,
  );
  for (const [jar, path] of [
    [owner.jar, identityPath],
    [owner.jar, ownerImagePath],
    [await adminJar(), adminImagePath],
  ] as const) {
    const response = await readBytes(jar, path);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('image/png');
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(response.headers.get('location')).toBeNull();
    expect((await response.arrayBuffer()).byteLength).toBeGreaterThan(0);
  }
  // Dossier/list contracts carry inspection resources and metadata, never
  // bucket keys, signed object-store credentials or restricted byte URLs.
  for (const metadata of [review, portfolio.body]) {
    const serialized = JSON.stringify(metadata);
    expect(serialized).not.toMatch(/"storageKey"|X-Amz-Signature|"readToken"/);
  }
  expect((await providerApplicationReview(owner)).canWork).toBe(false);
  expect((await capabilitiesOf(owner.jar)).allowed).not.toContain('SUBMIT_BID');
});

test('a provider edit during portfolio inspection produces a real revision conflict and keeps work blocked', async ({
  page,
}, testInfo) => {
  const account = await submittedProvider({ portfolio: true });
  await enterAdmin(page);
  const original = await openSubmittedProvider(page, account);
  const path = `/v1/admin/providers/${account.profileId}/portfolio`;
  const portfolio = await api<AdminPortfolioListResponse>(await adminJar(), path);
  const item = portfolio.body.items[0]!;
  await openReviewTask(page, 'PORTFOLIO');
  await page.getByTestId(`review-portfolio-open-${item.id}`).click();
  const dialog = page.getByRole('dialog');
  await expect
    .poll(() =>
      dialog.getByRole('img').evaluate((element) => (element as HTMLImageElement).naturalWidth),
    )
    .toBeGreaterThan(0);
  await page.getByTestId('review-portfolio-action-reject').click();
  const reason = 'Remove the customer address from this photograph.';
  await dialog.getByRole('textbox').fill(reason);
  const changed = await api(account.jar, `/v1/me/provider/portfolio/${item.id}`, {
    method: 'PATCH',
    body: { title: 'Updated installation description' },
  });
  expect(changed.status).toBe(200);
  const rejectedResponse = page.waitForResponse(
    (response) =>
      response.url() === `${REAL_API}${path}/${item.id}/review` &&
      response.request().method() === 'PATCH',
  );
  await page.getByTestId('review-portfolio-confirm').click();
  const rejected = await rejectedResponse;
  expect(rejected.status()).toBe(409);
  expect(rejected.request().postDataJSON()).toEqual({
    action: 'REJECT',
    expectedRevision: item.revision,
    reason,
  });
  await expect(dialog.getByRole('textbox')).toHaveValue(reason);
  await expect(page.getByTestId('review-portfolio-reload')).toBeVisible();
  await recordAdminEvidence(page, testInfo, 'portfolio-real-revision-conflict', original, {
    accessibilityScope: '[role="dialog"]',
    fullPage: false,
  });
  const persisted = await api<AdminPortfolioListResponse>(await adminJar(), path);
  expect(persisted.body.items[0]).toMatchObject({
    id: item.id,
    title: 'Updated installation description',
    moderationState: 'PENDING',
    revision: item.revision + 1,
  });
  expect(persisted.body.items[0].history).not.toContainEqual(
    expect.objectContaining({ action: 'REJECTED' }),
  );
  await page.getByTestId('review-portfolio-reload').click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId(`review-portfolio-${item.id}`)).toContainText(
    'Updated installation description',
  );
  const review = await providerApplicationReview(account);
  expect(review.submission?.snapshot?.portfolio.find((entry) => entry.id === item.id)?.title).toBe(
    item.title,
  );
  expect(review.blockers.map((blocker) => blocker.code)).toContain('SUBMITTED_CONTENT_CHANGED');
  expect(review.availableActions).not.toContain('approve');
  expect((await capabilitiesOf(account.jar)).allowed).not.toContain('SUBMIT_BID');
});
