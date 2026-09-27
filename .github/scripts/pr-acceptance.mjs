import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPOSITORY = 'baraabd/homeservicemarketplace';
export const POLICY = [
  { path: '.github/workflows/ci.yml', jobs: ['CI gate'], artifacts: [] },
  { path: '.github/workflows/codeql.yml', jobs: ['Analyze JavaScript/TypeScript'], artifacts: [] },
  { path: '.github/workflows/production-governance.yml', jobs: ['Production governance'], artifacts: ['production-governance-source'] },
  { path: '.github/workflows/web-startup.yml', jobs: ['Dev browser startup (ubuntu-latest)', 'Dev browser startup (windows-latest)'], artifacts: ['web-startup-ubuntu-latest', 'web-startup-windows-latest'] },
];
export const FIELDS = ['Sprint', 'Base SHA', 'Final SHA', 'Owned paths', 'Shared files modified', 'Schema change', 'Migration', 'Contract change', 'Feature flag', 'Security impact', 'Tests', 'Browser evidence', 'Known limitations', 'Rollback'];
const SHA = /^[a-f0-9]{40}$/u;
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const timestamp = (value) => typeof value === 'string' ? Date.parse(value) : NaN;
const positiveId = (value) => Number.isSafeInteger(value) && value > 0;

/** Metadata is an explicit claim, not proof that tests ran or protection exists. */
export function metadataProblems(pr) {
  if (!isObject(pr) || typeof pr.body !== 'string' || !SHA.test(pr.head?.sha ?? '')) return ['Missing PR metadata'];
  const errors = [];
  const fields = new Map();
  for (const line of pr.body.split(/\r?\n/u)) {
    const match = /^- ([^:]+):\s*(.*?)\s*$/u.exec(line);
    if (!match || !FIELDS.includes(match[1])) continue;
    if (fields.has(match[1])) errors.push(`Duplicate PR field: ${match[1]}`);
    fields.set(match[1], match[2].replace(/^`([^`]+)`$/u, '$1'));
  }
  for (const field of FIELDS) if (!fields.get(field)) errors.push(`Empty PR field: ${field}`);
  if (!SHA.test(fields.get('Base SHA') ?? '')) errors.push('Base SHA must be a full commit hash');
  if (fields.get('Final SHA') !== pr.head.sha) errors.push('Final SHA does not match the current PR head');
  return errors;
}

/** Only a complete, fresh, live-collected snapshot can support technical acceptance.
 * An offline JSON document is not a signature or a GitHub branch-protection rule.
 */
export function acceptanceProblems(snapshot, expected) {
  const errors = [];
  if (!isObject(expected) || expected.repository !== REPOSITORY || !positiveId(expected.prNumber) || !SHA.test(expected.headSha ?? '') || !SHA.test(expected.baseSha ?? '') || !Number.isFinite(expected.now)) return ['Invalid independently supplied acceptance target'];
  if (!isObject(snapshot) || snapshot.schemaVersion !== 1) return ['Missing acceptance snapshot'];
  if (snapshot.repository !== expected.repository) errors.push('Repository mismatch');
  const pr = snapshot.pr;
  if (!isObject(pr)) return [...errors, 'Missing PR metadata'];
  if (pr.number !== expected.prNumber || pr.base?.repo?.full_name !== expected.repository) errors.push('PR identity mismatch');
  if (pr.head?.sha !== expected.headSha || pr.base?.sha !== expected.baseSha) errors.push('Stale source identity');
  if (snapshot.after?.head?.sha !== expected.headSha || snapshot.after?.base?.sha !== expected.baseSha) errors.push('Source moved during evidence collection');
  if (pr.state !== 'open' || snapshot.after?.state !== 'open') errors.push('PR is not open');
  if (pr.draft !== false || snapshot.after?.draft !== false) errors.push('Draft PR is not eligible');
  if (pr.mergeable !== true || snapshot.after?.mergeable !== true) errors.push('Mergeability is false or unknown');
  if (!['ahead', 'identical'].includes(snapshot.comparison?.status) || snapshot.comparison?.behind_by !== 0) errors.push('Current base is not integrated');
  const capturedAt = timestamp(snapshot.capturedAt);
  if (!Number.isFinite(capturedAt) || expected.now - capturedAt > 30 * 60_000 || capturedAt > expected.now + 60_000) errors.push('Stale or invalid capture time');
  if (snapshot.complete !== true) errors.push('Incomplete API pagination');
  errors.push(...metadataProblems(pr));
  if (snapshot.after?.body !== pr.body) errors.push('PR metadata changed during collection');
  if (!Array.isArray(snapshot.runs) || !snapshot.runs.every(isObject)) return [...errors, 'Missing or malformed workflow runs'];
  if (!Array.isArray(snapshot.runsAfter) || !snapshot.runsAfter.every(isObject)) return [...errors, 'Missing final workflow recheck'];
  for (const policy of POLICY) {
    // Select the newest matching run BEFORE checking its conclusion. An older
    // successful run must never hide a newer pending, cancelled or failed run.
    const runs = snapshot.runs.filter((run) => run.path === policy.path);
    if (runs.some((run) => !positiveId(run.id) || !positiveId(run.run_attempt))) {
      errors.push(`Invalid run identity: ${policy.path}`);
      continue;
    }
    runs.sort((a, b) => b.id - a.id || b.run_attempt - a.run_attempt);
    const run = runs[0];
    if (!run) { errors.push(`Missing workflow: ${policy.path}`); continue; }
    const last = snapshot.runsAfter.filter((item) => item.path === policy.path).sort((a, b) => b.id - a.id || b.run_attempt - a.run_attempt)[0];
    if (last?.id !== run.id || last?.run_attempt !== run.run_attempt || last?.head_sha !== expected.headSha || last?.status !== run.status || last?.conclusion !== run.conclusion) errors.push(`Workflow set changed during collection: ${policy.path}`);
    if (run.head_sha !== expected.headSha || run.event !== 'pull_request' || run.repository?.full_name !== expected.repository || (!Array.isArray(run.pull_requests) || !run.pull_requests.some((item) => item?.number === expected.prNumber))) errors.push(`Wrong workflow provenance: ${policy.path}`);
    if (run.status !== 'completed' || run.conclusion !== 'success') errors.push(`Workflow not successful: ${policy.path}`);
    const detail = snapshot.details?.[String(run.id)];
    if (detail?.attempt !== run.run_attempt || detail?.complete !== true) { errors.push(`Incomplete or stale attempt: ${policy.path}`); continue; }
    const current = detail.after;
    if (current?.run_attempt !== run.run_attempt || current?.head_sha !== expected.headSha || current?.status !== run.status || current?.conclusion !== run.conclusion) errors.push(`Run changed during collection: ${policy.path}`);
    if (!Array.isArray(detail.jobs) || !Array.isArray(detail.artifacts)) { errors.push(`Missing jobs or artifacts: ${policy.path}`); continue; }
    for (const name of policy.jobs) {
      const jobs = detail.jobs.filter((job) => job?.name === name);
      if (jobs.length !== 1 || jobs[0].run_id !== run.id || jobs[0].run_attempt !== run.run_attempt || jobs[0].status !== 'completed' || jobs[0].conclusion !== 'success') errors.push(`Required job not successful on this attempt: ${name}`);
    }
    for (const name of policy.artifacts) {
      const artifacts = detail.artifacts.filter((artifact) => artifact?.name === name);
      const artifact = artifacts[0];
      if (artifacts.length !== 1 || !positiveId(artifact?.id) || artifact.expired !== false || !(artifact.size_in_bytes > 0) || !/^sha256:[a-f0-9]{64}$/u.test(artifact.digest ?? '') || artifact.workflow_run?.id !== run.id || artifact.workflow_run?.head_sha !== expected.headSha || !(timestamp(artifact.created_at) >= timestamp(run.run_started_at)) || !(timestamp(artifact.created_at) <= capturedAt + 60_000) || !(timestamp(artifact.expires_at) > expected.now)) errors.push(`Missing, expired or stale artifact: ${name}`);
    }
  }
  return errors;
}

/** Exhaust pagination; reaching a cap or seeing inconsistent totals is an error. */
export async function allPages(request, route, key, maxPages = 100) {
  const items = [];
  let total;
  for (let page = 1; page <= maxPages; page += 1) {
    const data = await request(`${route}${route.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
    if (!Array.isArray(data?.[key]) || !Number.isSafeInteger(data.total_count) || data.total_count < 0 || (total !== undefined && total !== data.total_count)) throw new Error('Incomplete or changing API pagination');
    total = data.total_count;
    items.push(...data[key]);
    if (items.length === total) return items;
    if (data[key].length === 0 || items.length > total) throw new Error('Incomplete API pagination');
  }
  throw new Error('API pagination limit reached');
}

export async function collectSnapshot(prNumber, token, fetchImpl = fetch) {
  if (!positiveId(prNumber) || typeof token !== 'string' || !token) throw new Error('PR number and read-only GitHub token are required');
  const request = async (route) => {
    const response = await fetchImpl(`https://api.github.com/repos/${REPOSITORY}/${route}`, {
      method: 'GET', redirect: 'error', signal: AbortSignal.timeout(20_000),
      headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28' },
    });
    // Never echo an API response, Authorization header or environment on error.
    if (!response.ok) throw new Error(`GitHub read failed with HTTP ${response.status}`);
    return response.json();
  };
  const pr = await request(`pulls/${prNumber}`);
  if (!SHA.test(pr.head?.sha ?? '') || !SHA.test(pr.base?.sha ?? '')) throw new Error('Invalid PR source identity');
  const runs = await allPages(request, `actions/runs?event=pull_request&head_sha=${pr.head.sha}`, 'workflow_runs');
  const details = {};
  for (const policy of POLICY) {
    const run = runs.filter((item) => item.path === policy.path).sort((a, b) => b.id - a.id || b.run_attempt - a.run_attempt)[0];
    if (!run) continue;
    if (!positiveId(run.id) || !positiveId(run.run_attempt)) throw new Error('Invalid workflow identity');
    const jobs = await allPages(request, `actions/runs/${run.id}/attempts/${run.run_attempt}/jobs`, 'jobs');
    const artifacts = await allPages(request, `actions/runs/${run.id}/artifacts`, 'artifacts');
    details[String(run.id)] = { attempt: run.run_attempt, complete: true, jobs, artifacts, after: await request(`actions/runs/${run.id}`) };
  }
  const comparison = await request(`compare/${pr.base.sha}...${pr.head.sha}`);
  const runsAfter = await allPages(request, `actions/runs?event=pull_request&head_sha=${pr.head.sha}`, 'workflow_runs');
  const after = await request(`pulls/${prNumber}`);
  return { schemaVersion: 1, repository: REPOSITORY, capturedAt: new Date().toISOString(), complete: true, pr, after, comparison, runs, runsAfter, details };
}

async function main() {
  const [command, arg, head, output, ...extra] = process.argv.slice(2);
  if (command === 'metadata' && arg && !head && !output && !extra.length) {
    const event = JSON.parse(await readFile(arg, 'utf8'));
    const errors = metadataProblems(event.pull_request);
    if (errors.length) {
      for (const error of errors) console.error(`FAIL ${error}`);
      process.exitCode = 1;
      return;
    }
    console.log('PASS current PR metadata; this is not merge or production acceptance');
    return;
  }
  if (command !== 'collect' || !/^\d+$/u.test(arg ?? '') || !SHA.test(head ?? '') || !output || extra.length) throw new Error('Usage: pr-acceptance.mjs metadata <event.json> | collect <PR> <expected-head-SHA> <report.json>');
  const snapshot = await collectSnapshot(Number(arg), process.env.GITHUB_TOKEN);
  const errors = acceptanceProblems(snapshot, { repository: REPOSITORY, prNumber: Number(arg), headSha: head, baseSha: snapshot.pr.base.sha, now: Date.now() });
  await writeFile(output, `${JSON.stringify({ technicalAcceptance: errors.length ? 'BLOCKED' : 'PASS', protectionAcceptance: 'NOT_EVALUATED', errors, snapshot }, null, 2)}\n`, { mode: 0o600 });
  console.log(`${errors.length ? 'BLOCKED' : 'PASS'} technical PR evidence; protection and sprint-specific acceptance remain separate`);
  if (errors.length) process.exitCode = 1;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => { console.error('FAIL acceptance inputs or GitHub evidence could not be validated'); process.exitCode = 1; });
}
