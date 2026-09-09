import { expect, test } from '@playwright/test';

import {
  acceptTerms,
  api,
  approveCategoriesFor,
  completeDraft,
  registerProvider,
  type Account,
} from './real-api';
import {
  approveProviderApplication,
  capabilitiesOf,
  reactivateProvider,
  supplyEvidence,
  submitVerificationCase,
  approveVerificationCase,
  suspendProvider,
  waitForEvidenceClean,
} from './phase3-activation';

// Sprint 09B.29 Phase 3 — the activation chain against a RUNNING API.
//
// docs/provider-experience-v2/SPRINT_09B29_VERIFICATION.md §3.12
//
// HOW THIS DIFFERS FROM THE INTEGRATION JOURNEY C
//
// `phase3-journey-c-activation.integration.spec.ts` builds a Nest module
// in-process and calls `EvidenceScanService.scanPending()` by hand. That proves
// the chain is CORRECT. It cannot prove the chain is REACHABLE, because an
// in-process test can call a service no deployed process ever calls — and that
// is exactly what was happening: `scanPending` had no production caller, so
// against a real API evidence was stored and never judged, submission stayed
// blocked on EVIDENCE_NOT_CLEAN forever, and no provider could be activated.
//
// This spec touches nothing directly. It registers a real account, drives real
// endpoints with real cookies and real CSRF, uploads real bytes, and then
// WAITS for the deployed API to clear them on its own. If `EvidenceScanJob` is
// missing or unarmed, `waitForEvidenceClean` times out and says so.
//
// Runs only with E2E_REAL_API set (see playwright.config.ts).

test.describe.configure({ mode: 'serial' });

test.describe('Phase 3 — the activation chain is reachable in a running API', () => {
  let account: Account;
  let caseId: string;

  test('a provider can be registered, filled in and submitted', async () => {
    account = await registerProvider();
    await completeDraft(account);
    await acceptTerms(account);

    const review = await api<{ canSubmit: boolean; draftVersion: number }>(
      account.jar,
      '/v1/me/provider/onboarding/review',
    );
    expect(review.body.canSubmit, 'a pending specialty must not block submission').toBe(true);

    const submitted = await api(account.jar, '/v1/me/provider/onboarding/submit', {
      method: 'POST',
      body: { version: review.body.draftVersion },
    });
    expect(submitted.status, JSON.stringify(submitted.body)).toBe(200);
  });

  test('work is refused before any decision, for the verification reason', async () => {
    const listed = await api(account.jar, '/v1/provider/bids');
    expect(listed.status).toBe(403);

    const caps = await capabilitiesOf(account.jar);
    expect(caps.primaryReason).toBe('VERIFICATION_REQUIRED');
    expect(caps.allowed).not.toContain('SUBMIT_BID');
  });

  test('provider-application approval alone does NOT open work', async () => {
    await approveProviderApplication(account);

    const listed = await api(account.jar, '/v1/provider/bids');
    expect(listed.status, 'approval is not verification and issues no grant').toBe(403);
    const caps = await capabilitiesOf(account.jar);
    expect(caps.primaryReason).toBe('VERIFICATION_REQUIRED');
  });

  test('specialty moderation is its own decision, and still opens no work', async () => {
    // Axis 3. It has to happen BEFORE the verification case: the case
    // readiness policy recomputes `evaluateOnboarding`, which raises a
    // provider-action `serviceCategories` issue while the provider holds no
    // GRANTED trade — a pending one is enough to submit the ONBOARDING
    // application (that is Phase 3's repair) but not to ask for identity
    // verification against a trade nobody has approved yet.
    await approveCategoriesFor(account);

    const listed = await api(account.jar, '/v1/provider/bids');
    expect(listed.status, 'a granted specialty is not work access either').toBe(403);
  });

  test('the running API clears uploaded evidence on its own', async () => {
    // THE ASSERTION THIS FILE EXISTS FOR. Nothing here calls the scanner; the
    // deployed `EvidenceScanJob` sweep has to do it.
    ({ caseId } = await supplyEvidence(account));
    await waitForEvidenceClean(account);
  });

  test('the case can then be submitted and approved', async () => {
    await submitVerificationCase(account);
    await approveVerificationCase(caseId);
  });

  test('the same endpoint that returned 403 now returns 200', async () => {
    const listed = await api(account.jar, '/v1/provider/bids');
    expect(listed.status).toBe(200);

    const caps = await capabilitiesOf(account.jar);
    expect(caps.primaryReason).toBeNull();
    expect(caps.allowed).toContain('VIEW_MARKETPLACE');
    expect(caps.allowed).toContain('SUBMIT_BID');
  });

  test('suspension returns work to 403 and reactivation restores it', async () => {
    await suspendProvider(account, 'Phase 3 browser acceptance.');
    expect((await api(account.jar, '/v1/provider/bids')).status).toBe(403);
    expect((await capabilitiesOf(account.jar)).primaryReason).toBe('PROVIDER_SUSPENDED');

    await reactivateProvider(account);
    expect((await api(account.jar, '/v1/provider/bids')).status).toBe(200);
    expect((await capabilitiesOf(account.jar)).primaryReason).toBeNull();
  });
});
