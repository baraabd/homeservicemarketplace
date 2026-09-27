import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REPOSITORY, POLICY, FIELDS, metadataProblems, acceptanceProblems, allPages, collectSnapshot } from './pr-acceptance.mjs';

const headSha = 'a'.repeat(40);
const baseSha = 'b'.repeat(40);
const now = Date.parse('2026-09-27T10:00:00Z');
const expected = { repository: REPOSITORY, prNumber: 17, headSha, baseSha, now };
function fixture() {
  const body = FIELDS.map((field) => `- ${field}: ${field === 'Final SHA' ? headSha : field === 'Base SHA' ? baseSha : 'Documented'}`).join('\n');
  const pr = { number: 17, body, state: 'open', draft: false, mergeable: true, head: { sha: headSha }, base: { sha: baseSha, repo: { full_name: REPOSITORY } } };
  const runs = POLICY.map((policy, index) => ({ id: index + 1, run_attempt: 1, path: policy.path, event: 'pull_request', head_sha: headSha, status: 'completed', conclusion: 'success', repository: { full_name: REPOSITORY }, pull_requests: [{ number: 17 }], run_started_at: '2026-09-27T09:00:00Z' }));
  const details = Object.fromEntries(runs.map((run, index) => [run.id, {
    attempt: 1, complete: true, after: structuredClone(run),
    jobs: POLICY[index].jobs.map((name) => ({ name, run_id: run.id, run_attempt: 1, status: 'completed', conclusion: 'success' })),
    artifacts: POLICY[index].artifacts.map((name) => ({ id: 100 + index, name, expired: false, size_in_bytes: 100, digest: `sha256:${'c'.repeat(64)}`, workflow_run: { id: run.id, head_sha: headSha }, created_at: '2026-09-27T09:05:00Z', expires_at: '2026-10-04T09:05:00Z' })),
  }]));
  return { schemaVersion: 1, repository: REPOSITORY, pr, after: structuredClone(pr), comparison: { status: 'ahead', behind_by: 0 }, capturedAt: '2026-09-27T09:59:00Z', complete: true, runs, runsAfter: structuredClone(runs), details };
}
const check = (snapshot) => acceptanceProblems(snapshot, expected);

test('complete final-head evidence passes technical acceptance only', () => {
  assert.deepEqual(check(fixture()), []);
});

test('PR metadata requires populated fields and the exact final SHA', () => {
  const { pr } = fixture();
  assert.deepEqual(metadataProblems(pr), []);
  for (const field of FIELDS) {
    assert.ok(metadataProblems({ ...pr, body: pr.body.replace(new RegExp(`- ${field}: [^\n]+`, 'u'), `- ${field}:`) }).length);
  }
  assert.ok(metadataProblems({ ...pr, body: `${pr.body}\n- Final SHA: ${headSha}` }).length);
  assert.ok(metadataProblems({ ...pr, head: { sha: baseSha } }).length);
});

for (const [name, change] of Object.entries({
  'missing snapshot': () => null,
  'wrong repository': (s) => { s.repository = 'other/repo'; },
  'wrong PR': (s) => { s.pr.number += 1; },
  'wrong base repository': (s) => { s.pr.base.repo.full_name = 'other/repo'; },
  'old head': (s) => { s.pr.head.sha = baseSha; },
  'base moved': (s) => { s.after.base.sha = headSha; },
  'head moved': (s) => { s.after.head.sha = baseSha; },
  'metadata edited': (s) => { s.after.body += '\nChanged'; },
  'closed PR': (s) => { s.pr.state = 'closed'; },
  'draft PR': (s) => { s.pr.draft = true; },
  'newly drafted PR': (s) => { s.after.draft = true; },
  'unknown mergeability': (s) => { s.pr.mergeable = null; },
  'merge conflict': (s) => { s.after.mergeable = false; },
  'base not integrated': (s) => { s.comparison = { status: 'diverged', behind_by: 1 }; },
  'old capture': (s) => { s.capturedAt = '2026-09-27T08:00:00Z'; },
  'future capture': (s) => { s.capturedAt = '2026-09-28T10:00:00Z'; },
  'invalid capture': (s) => { s.capturedAt = 'not-a-date'; },
  'partial API results': (s) => { s.complete = false; },
  'missing workflow': (s) => { s.runs.pop(); },
  'missing final workflow recheck': (s) => { delete s.runsAfter; },
  'new workflow after initial listing': (s) => { s.runsAfter.push({ ...s.runs[0], id: 999, status: 'queued', conclusion: null }); },
  'late workflow retry': (s) => { s.runsAfter[0].run_attempt = 2; },
  'malformed run': (s) => { s.runs.push(null); },
  'old workflow head': (s) => { s.runs[0].head_sha = baseSha; },
  'wrong workflow repository': (s) => { s.runs[0].repository.full_name = 'other/repo'; },
  'wrong workflow PR': (s) => { s.runs[0].pull_requests = [{ number: 18 }]; },
  'malformed workflow PRs': (s) => { s.runs[0].pull_requests = {}; },
  'push run instead of PR': (s) => { s.runs[0].event = 'push'; },
  'queued run': (s) => { s.runs[0].status = 'queued'; s.runs[0].conclusion = null; },
  'running run': (s) => { s.runs[0].status = 'in_progress'; },
  'failed run': (s) => { s.runs[0].conclusion = 'failure'; },
  'cancelled run': (s) => { s.runs[0].conclusion = 'cancelled'; },
  'missing jobs': (s) => { s.details[1].jobs = []; },
  'skipped required job': (s) => { s.details[1].jobs[0].conclusion = 'skipped'; },
  'wrong job run': (s) => { s.details[1].jobs[0].run_id = 999; },
  'old job attempt': (s) => { s.details[1].jobs[0].run_attempt = 0; },
  'duplicate named job': (s) => { s.details[1].jobs.push(s.details[1].jobs[0]); },
  'partial job pages': (s) => { s.details[1].complete = false; },
  'old attempt details': (s) => { s.details[1].attempt = 0; },
  'run restarted during collection': (s) => { s.details[1].after.run_attempt = 2; },
  'run cancelled during collection': (s) => { s.details[1].after.conclusion = 'cancelled'; },
  'artifact missing': (s) => { s.details[3].artifacts = []; },
  'artifact expired': (s) => { s.details[3].artifacts[0].expired = true; },
  'artifact passed expiry': (s) => { s.details[3].artifacts[0].expires_at = '2026-09-26T00:00:00Z'; },
  'artifact old SHA': (s) => { s.details[3].artifacts[0].workflow_run.head_sha = baseSha; },
  'artifact old run': (s) => { s.details[3].artifacts[0].workflow_run.id = 1; },
  'artifact from previous attempt': (s) => { s.details[3].artifacts[0].created_at = '2026-09-27T08:59:00Z'; },
  'artifact future date': (s) => { s.details[3].artifacts[0].created_at = '2026-09-28T00:00:00Z'; },
  'artifact missing digest': (s) => { delete s.details[3].artifacts[0].digest; },
  'artifact empty': (s) => { s.details[3].artifacts[0].size_in_bytes = 0; },
})) {
  test(`rejects ${name}`, () => {
    const snapshot = fixture();
    assert.ok(check(change(snapshot) === null ? null : snapshot).length > 0);
  });
}

test('newer queued run cannot be hidden by an older success', () => {
  const snapshot = fixture();
  snapshot.runs.push({ ...snapshot.runs[0], id: 20, status: 'queued', conclusion: null });
  assert.ok(check(snapshot).some((error) => error.startsWith('Workflow not successful')));
});

test('a known new attempt prevents accepting evidence from the previous attempt', () => {
  const snapshot = fixture();
  snapshot.runs.push({ ...snapshot.runs[0], run_attempt: 2, status: 'in_progress', conclusion: null });
  assert.ok(check(snapshot).length);
});

test('an independent expected SHA is mandatory', () => {
  assert.ok(acceptanceProblems(fixture(), { ...expected, headSha: undefined }).length);
  assert.ok(acceptanceProblems(fixture(), { ...expected, headSha: baseSha }).length);
});

test('pagination retains every page and appends to existing query strings', async () => {
  const routes = [];
  const result = await allPages(async (route) => {
    routes.push(route);
    return { total_count: 2, jobs: [{ id: routes.length }] };
  }, 'jobs?filter=all', 'jobs');
  assert.equal(result.length, 2);
  assert.match(routes[1], /filter=all&per_page=100&page=2$/u);
});

test('pagination rejects missing data, empty partial pages, changing totals and caps', async () => {
  for (const response of [{ jobs: [] }, { jobs: [], total_count: 1 }, { jobs: [{}], total_count: 0 }]) {
    await assert.rejects(allPages(async () => response, 'jobs', 'jobs'));
  }
  let page = 0;
  await assert.rejects(allPages(async () => ({ jobs: [{}], total_count: ++page + 1 }), 'jobs', 'jobs'));
  await assert.rejects(allPages(async () => ({ jobs: [{}], total_count: 3 }), 'jobs', 'jobs', 1));
});

test('collection fails without read credentials and never follows redirects', async () => {
  await assert.rejects(collectSnapshot(17, ''));
  await assert.rejects(collectSnapshot(-1, 'synthetic-token'));
  await assert.rejects(collectSnapshot(17, 'synthetic-token', async (url, options) => {
    assert.ok(url.startsWith(`https://api.github.com/repos/${REPOSITORY}/`));
    assert.equal(options.method, 'GET');
    assert.equal(options.redirect, 'error');
    return { ok: false, status: 403 };
  }), /HTTP 403/u);
});

test('metadata CLI validates its actual event file and redacts parse failures', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'hsm-acceptance-'));
  const event = join(directory, 'event.json');
  const cli = fileURLToPath(new URL('./pr-acceptance.mjs', import.meta.url));
  try {
    await writeFile(event, JSON.stringify({ pull_request: fixture().pr }));
    assert.equal(spawnSync(process.execPath, [cli, 'metadata', event]).status, 0);
    const pr = fixture().pr;
    pr.head.sha = baseSha;
    await writeFile(event, JSON.stringify({ pull_request: pr }));
    assert.equal(spawnSync(process.execPath, [cli, 'metadata', event]).status, 1);
    await writeFile(event, 'DO_NOT_ECHO_PRIVATE_INPUT');
    const result = spawnSync(process.execPath, [cli, 'metadata', event], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.doesNotMatch(result.stderr, /DO_NOT_ECHO/u);
  } finally { await rm(directory, { recursive: true, force: true }); }
});


test('collector retrieves attempt-specific jobs, exhausts evidence and rechecks workflows', async () => {
  const value = fixture();
  const requests = [];
  const result = await collectSnapshot(17, 'synthetic-token', async (url) => {
    const route = new URL(url).pathname.split(`/${REPOSITORY}/`)[1];
    requests.push(route);
    let body;
    if (route === 'pulls/17') body = value.pr;
    else if (route.startsWith('compare/')) body = value.comparison;
    else if (route === 'actions/runs') body = { total_count: value.runs.length, workflow_runs: value.runs };
    else {
      const match = /^actions\/runs\/(\d+)(.*)$/u.exec(route);
      assert.ok(match);
      const detail = value.details[match[1]];
      if (match[2] === '/attempts/1/jobs') body = { total_count: detail.jobs.length, jobs: detail.jobs };
      else if (match[2] === '/artifacts') body = { total_count: detail.artifacts.length, artifacts: detail.artifacts };
      else { assert.equal(match[2], ''); body = detail.after; }
    }
    return { ok: true, json: async () => structuredClone(body) };
  });
  assert.equal(requests.filter((route) => route === 'actions/runs').length, 2);
  assert.equal(requests.filter((route) => route === 'pulls/17').length, 2);
  assert.equal(requests.filter((route) => route.endsWith('/attempts/1/jobs')).length, POLICY.length);
  result.capturedAt = value.capturedAt;
  assert.deepEqual(check(result), []);
});
