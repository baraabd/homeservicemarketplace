import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { inspectAdminReview } from './check-admin-review.mjs';

function fixture(t, options = {}) {
  const root = mkdtempSync(join(tmpdir(), 'admin-review-source-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const files = {
    'apps/web/src/app/components/admin/AdminRouteContent.tsx': '<ApprovalCenter /><AdminProviderReviewWorkspace providerProfileId="p" />',
    'apps/web/src/app/features/admin-provider-review/components/AdminProviderReviewWorkspace.tsx': '<ReviewTaskTabs value="BASICS_IDENTITY" /><div data-admin-review-layout="tabbed-v1" />',
    'packages/contracts/src/index.ts': "export * from './money';\n",
    ...options,
  };
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}

test('passing source checks never pretend to verify runtime or Git identity', (t) => {
  const report = inspectAdminReview(fixture(t));
  assert.equal(report.sourceChecksPass, true);
  assert.equal(report.sourceOnly, true);
  assert.equal(report.runtimeVerified, false);
  assert.equal(report.commit, null);
  assert.equal(report.changedFileCount, null);
});
test('missing files yield a failing report, not an exception', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'admin-review-empty-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.equal(inspectAdminReview(root).sourceChecksPass, false);
});
test('an old anchor-linked workspace cannot pass as tabbed', (t) => {
  const root = fixture(t, {
    'apps/web/src/app/features/admin-provider-review/components/AdminProviderReviewWorkspace.tsx': '<ReviewTaskIndex lang="en" />',
  });
  const report = inspectAdminReview(root);
  assert.equal(report.checks.tabbedWorkspace, false);
  assert.equal(report.checks.runtimeMarker, false);
  assert.equal(report.sourceChecksPass, false);
});
test('the missing money export remains a visible prerequisite failure', (t) => {
  const root = fixture(t, { 'packages/contracts/src/index.ts': "export * from './disputes/intake';\n" });
  const report = inspectAdminReview(root);
  assert.equal(report.checks.moneyContractExport, false);
  assert.equal(report.checks.tabbedWorkspace, true);
  assert.equal(report.sourceChecksPass, false);
});
