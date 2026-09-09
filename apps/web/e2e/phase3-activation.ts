import { deflateSync } from 'node:zlib';

import { expect } from '@playwright/test';

import { adminJar, api, type Account, type Jar } from './real-api';

// Sprint 09B.29 Phase 3 — the canonical activation chain, over real HTTP.
//
// docs/provider-experience-v2/SPRINT_09B29_VERIFICATION.md §3.9.2
//
// Every function here drives a PUBLISHED endpoint with a genuine authenticated
// session and the CSRF token that session was issued — the same `api()` helper
// the rest of the real-API suite uses, which carries a cookie jar and echoes
// `X-CSRF-Token` exactly as the browser's own client does.
//
// The admin identity is the SEEDED `*@admin.com` account, signed in through
// `POST /v1/auth/login` (plus OTP where the account demands it). No role is
// granted behind the API's back, no guard is bypassed, and no decision or
// grant state is ever written with SQL.
//
// WHY THESE ARE API CALLS RATHER THAN UI CLICKS
//
// There is no admin UI in this application for the verification-case queue, so
// there is no screen to drive. The user-facing half of every journey below is
// driven through the real browser; the operator half is driven here, through
// the same HTTP surface an operator console would call.

/** The evidence a provider uploads. A genuinely valid 1×1 PNG — signature,
 *  IHDR, IDAT and IEND with real CRCs.
 *
 *  Not a padded signature: `validateEvidenceBytes` checks the TRAILER as well
 *  as the leading magic, and the scan sweep re-validates the stored object. A
 *  file with filler bytes uploads happily and is then REJECTED at scan time,
 *  which looks like a scanner fault rather than a bad fixture. */
export const EVIDENCE_PNG: Buffer = (() => {
  const table = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc32 = (buf: Buffer): number => {
    let c = 0xffffffff;
    for (const b of buf) c = table[(c ^ b) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer): Buffer => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8;
  ihdr[9] = 0;
  const idat = deflateSync(Buffer.from([0x00, 0x00]));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
})();

/** Axis 2 — the provider application decision. Moves status and the onboarding
 *  axis; issues NO grant and does NOT verify. */
export async function approveProviderApplication(account: Account): Promise<void> {
  const admin = await adminJar();
  const res = await api(admin, `/v1/admin/providers/${account.profileId}/approve`, {
    method: 'POST',
    body: { note: 'Phase 3 browser acceptance.' },
  });
  expect(res.status, `provider approval should be accepted: ${JSON.stringify(res.body)}`).toBe(200);
}

export async function suspendProvider(account: Account, reason: string): Promise<void> {
  const admin = await adminJar();
  const res = await api(admin, `/v1/admin/providers/${account.profileId}/suspend`, {
    method: 'POST',
    body: { reason },
  });
  expect(res.status, `suspension should be accepted: ${JSON.stringify(res.body)}`).toBe(200);
}

export async function reactivateProvider(account: Account): Promise<void> {
  const admin = await adminJar();
  const res = await api(admin, `/v1/admin/providers/${account.profileId}/reactivate`, {
    method: 'POST',
    body: {},
  });
  expect(res.status, `reactivation should be accepted: ${JSON.stringify(res.body)}`).toBe(200);
}

/**
 * Axis 3+4 — the verification case, end to end, as the provider and then the
 * reviewer.
 *
 * The provider half uses the provider's OWN session: open a case, reserve an
 * upload, PUT the bytes, finalize. The scan is NOT triggered here — it is left
 * to `EvidenceScanJob`, the sweep this sprint added, so the wait below is
 * genuine evidence that the running API scans what it is given.
 */
export async function supplyEvidence(account: Account): Promise<{ caseId: string }> {
  const { jar } = account;

  const created = await api<{ case: { id: string } }>(jar, '/v1/me/provider/verification/case', {
    method: 'POST',
    body: {},
  });
  expect(created.status, `case creation should be accepted: ${JSON.stringify(created.body)}`).toBe(
    200,
  );
  const caseId = created.body.case.id;

  const prepared = await api<{ assetId?: string; asset?: { id: string } }>(
    jar,
    '/v1/me/provider/verification/evidence/prepare',
    {
      method: 'POST',
      body: {
        kind: 'INDIVIDUAL_IDENTITY',
        declaredMimeType: 'image/png',
        sizeBytes: EVIDENCE_PNG.length,
        filename: 'identity.png',
      },
    },
  );
  expect(prepared.status, `prepare should be accepted: ${JSON.stringify(prepared.body)}`).toBe(200);
  const assetId = prepared.body.assetId ?? prepared.body.asset?.id;
  expect(assetId, 'prepare should name the asset it reserved').toBeTruthy();

  // The binary body. `api()` speaks JSON, so this one goes through fetch
  // directly — with the same cookies and the same CSRF token.
  const csrf = jar.get('hsm_csrf');
  const put = await fetch(
    `${process.env.E2E_REAL_API}/v1/me/provider/verification/evidence/${assetId}/content`,
    {
      method: 'PUT',
      headers: {
        Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; '),
        'Content-Type': 'image/png',
        ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
      },
      body: new Uint8Array(EVIDENCE_PNG),
    },
  );
  expect(put.status, 'the evidence bytes should be accepted').toBe(200);

  const finalized = await api(jar, `/v1/me/provider/verification/evidence/${assetId}/finalize`, {
    method: 'POST',
    body: {},
  });
  expect(finalized.status, `finalize should be accepted: ${JSON.stringify(finalized.body)}`).toBe(
    200,
  );

  return { caseId };
}

/**
 * Wait for the RUNNING API to clear the evidence.
 *
 * This is the assertion that `EvidenceScanJob` exists and is armed. Before this
 * sprint `scanPending` had no production caller at all, so this poll would have
 * run out — evidence uploaded through the real API was stored and never judged,
 * and no provider could ever be verified.
 *
 * Polls the provider's own case view rather than the database, so it observes
 * exactly what the provider's browser would see.
 */
export async function waitForEvidenceClean(account: Account, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let last = '';
  while (Date.now() < deadline) {
    const view = await api<unknown>(account.jar, '/v1/me/provider/verification/case');
    last = JSON.stringify(view.body);
    if (last.includes('CLEAN')) return;
    await new Promise((r) => setTimeout(r, 1_000));
  }
  throw new Error(
    `evidence never reached CLEAN within ${timeoutMs}ms — is EVIDENCE_SCAN_WORKER_ENABLED armed ` +
      `and EVIDENCE_SCANNER_DRIVER set? last case view: ${last}`,
  );
}

/** The provider hands the case in. */
export async function submitVerificationCase(account: Account): Promise<void> {
  const res = await api(account.jar, '/v1/me/provider/verification/case/submit', {
    method: 'POST',
    body: {},
  });
  expect(res.status, `case submission should be accepted: ${JSON.stringify(res.body)}`).toBe(200);
}

/**
 * Axis 4 — the decision that issues the work-access grant.
 *
 * Gated by the `verification:decide` PERMISSION rather than the admin role, so
 * this exercises a different guard from the provider-application approval
 * above. The seeded admin role carries it.
 */
export async function approveVerificationCase(caseId: string): Promise<void> {
  const admin = await adminJar();
  const res = await api(admin, `/v1/admin/verification/cases/${caseId}/approve`, {
    method: 'POST',
    body: {
      reasonCode: 'DOCUMENTS_COMPLETE_AND_LEGIBLE',
      note: 'Phase 3 browser acceptance.',
    },
  });
  expect(res.status, `verification approval should be accepted: ${JSON.stringify(res.body)}`).toBe(
    200,
  );
}

/** The whole verification half, in order. */
export async function verifyProvider(account: Account): Promise<void> {
  const { caseId } = await supplyEvidence(account);
  await waitForEvidenceClean(account);
  await submitVerificationCase(account);
  await approveVerificationCase(caseId);
}

/** The provider's own capability view — the canonical answer to "may I work?". */
export async function capabilitiesOf(jar: Jar): Promise<{
  allowed: string[];
  primaryReason: string | null;
}> {
  const res = await api<{ allowed: string[]; primaryReason: string | null }>(
    jar,
    '/v1/me/provider/capabilities',
  );
  expect(res.status, 'a provider can always read their own capabilities').toBe(200);
  return res.body;
}
