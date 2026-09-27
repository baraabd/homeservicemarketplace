'use strict';
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');
async function main() {
  const root = 'http://127.0.0.1:18080';
  let healthy = false;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await fetch(`${root}/health/live`, { signal: AbortSignal.timeout(1000) });
      if (response.status === 204) { healthy = true; break; }
    } catch { /* Only startup readiness is polled; semantic failures are not retried. */ }
    await delay(1000);
  }
  assert.equal(healthy, true, 'The actual Nginx process must serve health');
  const index = await fetch(`${root}/index.html`);
  assert.equal(index.status, 200);
  assert.equal(index.headers.get('cache-control'), 'no-store');
  const html = await index.text();
  const deepLink = await fetch(`${root}/seeker/profile`);
  assert.equal(deepLink.status, 200);
  assert.equal(await deepLink.text(), html, 'Client-side deep links must serve the same SPA');
  assert.equal((await fetch(`${root}/assets/not-a-real-file.js`)).status, 404);
  assert.equal((await fetch(`${root}/v1/auth/me`)).status, 404, 'The web server must not disguise missing API routing as HTML 200');
  const info = await fetch(`${root}/build-info.json`);
  assert.equal(info.headers.get('cache-control'), 'no-store');
  const sourceSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  assert.deepEqual(await info.json(), { sourceSha, apiUrl: process.env.EXPECTED_API_URL, onboardingV2: false });
  console.log('PASS real non-root Nginx image routes and source/flag identity (CI, not staging acceptance)');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
