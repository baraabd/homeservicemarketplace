#!/usr/bin/env node

//
// Sprint 7.2 — runtime 500-elimination probe.
//
// Drives every endpoint the user reported as 500ing in their browser
// console after Sprint 7.1, against the LIVE API on localhost:4000,
// with a single admin bearer token. Asserts 200 (or the appropriate
// 2xx) on each one. Hard fails on any 5xx, prints the response body,
// and exits non-zero so CI / a pre-commit hook can catch regressions.
//
// What this harness DOES NOT do:
//   - Boot the API. Operator must have it running on :4000.
//   - Apply migrations or run `prisma generate`. Operator runbook in
//     docs/sprints/sprint-7.2-runtime-500-elimination-review.md §3.
//   - Mint or rotate credentials. Operator pre-supplies adminToken
//     via env (see usage below).
//
// Usage:
//   ADMIN_TOKEN=eyJ... node scripts/runtime/verify-runtime-500-elimination.cjs
// or
//   pnpm runtime:verify-500
//
// Optional override:
//   API_URL=http://localhost:4000  (default)

const API_URL = process.env.API_URL || 'http://localhost:4000';
const TOKEN = process.env.ADMIN_TOKEN;

if (!TOKEN) {
  console.error('ADMIN_TOKEN env var required. Mint it from /v1/auth/login + /v1/auth/verify-otp.');
  process.exit(2);
}

async function ping(path, opts = {}) {
  const res = await fetch(`${API_URL}${path}`, {
    method: opts.method || 'GET',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'X-Client-Kind': 'mobile',
      ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  return { status: res.status, body, text };
}

const ENDPOINTS = [
  // Admin surface — everything the user reported as 500.
  { label: 'GET  /v1/admin/analytics/overview', path: '/v1/admin/analytics/overview' },
  { label: 'GET  /v1/admin/providers', path: '/v1/admin/providers' },
  {
    label: 'GET  /v1/admin/financials/provider-earnings',
    path: '/v1/admin/financials/provider-earnings',
  },
  { label: 'GET  /v1/admin/financials/bookings', path: '/v1/admin/financials/bookings' },
  { label: 'GET  /v1/admin/financials/summary', path: '/v1/admin/financials/summary' },
  { label: 'GET  /v1/admin/disputes', path: '/v1/admin/disputes' },
  { label: 'GET  /v1/admin/settings', path: '/v1/admin/settings' },
  {
    label: 'GET  /v1/admin/audit-logs?action=ADMIN_SETTING_UPDATED',
    path: '/v1/admin/audit-logs?action=ADMIN_SETTING_UPDATED',
  },
  // Provider surface — admin@admin.com has all three roles + an
  // ACTIVE provider profile in the dev DB so these all return 200.
  { label: 'GET  /v1/me/provider/profile', path: '/v1/me/provider/profile' },
  { label: 'GET  /v1/provider/available-requests', path: '/v1/provider/available-requests' },
  { label: 'GET  /v1/provider/bids', path: '/v1/provider/bids' },
  { label: 'GET  /v1/me/provider/bids (legacy)', path: '/v1/me/provider/bids' },
  { label: 'GET  /v1/provider/bookings', path: '/v1/provider/bookings' },
  { label: 'GET  /v1/provider/earnings/summary', path: '/v1/provider/earnings/summary' },
  { label: 'GET  /v1/provider/earnings/transactions', path: '/v1/provider/earnings/transactions' },
  {
    label: 'GET  /v1/provider/earnings/chart?range=30d',
    path: '/v1/provider/earnings/chart?range=30d',
  },
  // Audit DTO enum-validation regression check (Sprint 7.1 fix):
  // garbage value must come back 400, not 500.
  {
    label: 'GET  /v1/admin/audit-logs?action=NOT_REAL  (must be 400, never 500)',
    path: '/v1/admin/audit-logs?action=NOT_REAL',
    expected: 400,
  },
];

(async () => {
  console.log(`API=${API_URL}\n`);
  const failures = [];
  for (const e of ENDPOINTS) {
    const expected = e.expected ?? 200;
    const r = await ping(e.path, { method: e.method, body: e.body });
    const ok = r.status === expected;
    const tag = ok ? 'PASS' : 'FAIL';
    const detail = ok ? `${r.status}` : `${r.status} (expected ${expected})`;
    console.log(`[${tag}] ${e.label}  →  ${detail}`);
    if (!ok) {
      failures.push({ label: e.label, expected, got: r.status, body: r.body ?? r.text });
      // If we got a 5xx, dump the body so the operator can match it
      // against the API terminal stack trace.
      if (r.status >= 500) {
        console.log(`        body: ${r.text.slice(0, 400)}`);
      }
    }
  }
  console.log('');
  if (failures.length === 0) {
    console.log(`✅ All ${ENDPOINTS.length} endpoints returned the expected status. Zero 5xx.`);
    process.exit(0);
  } else {
    console.log(`❌ ${failures.length}/${ENDPOINTS.length} failed:`);
    for (const f of failures) {
      console.log(`   - ${f.label}: got ${f.got}`);
    }
    process.exit(1);
  }
})().catch((e) => {
  console.error('runtime probe crashed:', e.message);
  process.exit(2);
});
