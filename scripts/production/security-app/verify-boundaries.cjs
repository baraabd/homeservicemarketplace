const assert = require('node:assert/strict');
const { readFile, mkdir, writeFile } = require('node:fs/promises');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { buildWebCsp } = require('./web-csp.cjs');

async function main() {
  assert.equal(process.env.R26_ACCEPTANCE_SCOPE, 'isolated-ci');
  const sourceSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  assert.equal(
    sourceSha,
    process.env.R26_SOURCE_SHA,
    'Acceptance must name the checked-out PR head',
  );
  await mkdir('r26-evidence', { recursive: true });
  if (process.argv.includes('--summarize-browser')) {
    const report = JSON.parse(await readFile('apps/web/test-results/r26-results.json', 'utf8'));
    const cases = [];
    function visit(suite) {
      for (const spec of suite.specs ?? [])
        for (const test of spec.tests) {
          cases.push({
            title: spec.title,
            status: test.status,
            attempts: test.results.map((result) => result.status),
          });
        }
      for (const child of suite.suites ?? []) visit(child);
    }
    for (const suite of report.suites) visit(suite);
    await writeFile(
      'r26-evidence/browser.json',
      JSON.stringify({ sourceSha, cases, stats: report.stats }, null, 2) + '\n',
    );
    assert.equal(cases.length, 2);
    assert.ok(
      cases.every(
        (test) =>
          test.status === 'expected' && test.attempts.length === 1 && test.attempts[0] === 'passed',
      ),
    );
    return;
  }
  assert.equal(process.env.E2E_REAL_API, 'http://127.0.0.1:4326');
  assert.equal(process.env.E2E_BASE_URL, 'http://127.0.0.1:5326');
  const html = await readFile('apps/web/dist/index.html', 'utf8');
  const builtPolicy = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/u)?.[1];
  assert.equal(builtPolicy, buildWebCsp(process.env));
  assert.ok(html.indexOf('Content-Security-Policy') < html.indexOf('<script'));
  const served = await fetch(`${process.env.E2E_BASE_URL}/login`);
  assert.equal(served.status, 200);
  assert.equal(
    await served.text(),
    html,
    'Browser acceptance must serve this exact built document',
  );
  const api = await fetch(`${process.env.E2E_REAL_API}/health/ready`);
  assert.equal(api.status, 200);
  await writeFile(
    'r26-evidence/boundaries.json',
    JSON.stringify(
      {
        sourceSha,
        builtIndexSha256: createHash('sha256').update(html).digest('hex'),
        observedAt: new Date().toISOString(),
        apiReady: api.status,
        servedDocumentMatchesBuild: true,
        browserOrigin: process.env.E2E_BASE_URL,
        apiOrigin: process.env.E2E_REAL_API,
        policy: builtPolicy,
        apiRuntime: 'compiled development runtime on disposable loopback services',
        scanner: 'test component; no malware-detection acceptance',
        hostedAcceptance: false,
        repositoryAlertInventory: 'EXTERNAL_BLOCKED',
      },
      null,
      2,
    ) + '\n',
  );
  console.log('R26 built document and disposable HTTP boundaries verified');
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
