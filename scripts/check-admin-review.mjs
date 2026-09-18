import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const WORKSPACE = 'apps/web/src/app/features/admin-provider-review/components/AdminProviderReviewWorkspace.tsx';
const ROUTE = 'apps/web/src/app/components/admin/AdminRouteContent.tsx';

/** Read-only source diagnostics. Never reads .env, prints credentials, changes Git or contacts production. */
export function inspectAdminReview(root) {
  const read = (path) => {
    try { return readFileSync(resolve(root, path), 'utf8'); }
    catch { return ''; }
  };
  const git = (...args) => {
    try { return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
    catch { return null; }
  };
  const workspace = read(WORKSPACE);
  const route = read(ROUTE);
  const checks = {
    approvalHomeEntry: /<ApprovalCenter\s*\/>/.test(route),
    providerReviewRoute: /<AdminProviderReviewWorkspace\s/.test(route),
    tabbedWorkspace: /<ReviewTaskTabs\s/.test(workspace),
    runtimeMarker: workspace.includes('data-admin-review-layout="tabbed-v1"'),
    moneyContractExport: /^export \* from ['"]\.\/money['"];$/m.test(read('packages/contracts/src/index.ts')),
  };
  const status = git('status', '--porcelain');
  return {
    sourceOnly: true,
    runtimeVerified: false,
    commit: git('rev-parse', 'HEAD'),
    branch: git('branch', '--show-current'),
    changedFileCount: status === null ? null : status ? status.split('\n').length : 0,
    aheadBehind: git('rev-list', '--left-right', '--count', 'HEAD...@{upstream}'),
    checks,
    sourceChecksPass: Object.values(checks).every(Boolean),
    next: 'Verify the workspace data-admin-review-layout marker in the running browser, then inspect authorized GET /v1/admin/providers/:id/review. Source checks do not prove deployment or permissions.',
  };
}

const invoked = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (invoked) {
  const root = process.argv[2] ? resolve(process.argv[2]) : resolve(fileURLToPath(new URL('..', import.meta.url)));
  const report = inspectAdminReview(root);
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.sourceChecksPass ? 0 : 1;
}
