import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { POLICY, REPOSITORY } from './pr-acceptance.mjs';
import { collectEquivalentCodeQL } from './cd-codeql-source.mjs';
import {
  CD_POLICY,
  MAX_WAIT_SECONDS,
  assessSnapshot,
  collectSnapshot,
  parseArgs,
  waitForEvidence,
} from './cd-evidence.mjs';

const sha = 'a'.repeat(40);
const otherSha = 'b'.repeat(40);
const now = Date.parse('2026-11-03T12:00:00Z');
const target = { branch: 'develop', sha, now };
const startedAt = '2026-11-03T11:30:00Z';

function fixture(branch = 'develop') {
  const source = { name: branch, commit: { sha } };
  const runs = CD_POLICY.map((policy, index) => ({
    id: index + 1,
    run_attempt: 1,
    path: policy.path,
    event: 'push',
    head_sha: sha,
    head_branch: branch,
    status: 'completed',
    conclusion: 'success',
    repository: { full_name: REPOSITORY },
    head_repository: { full_name: REPOSITORY },
    run_started_at: startedAt,
  }));
  const details = Object.fromEntries(
    runs.map((run, index) => [
      String(run.id),
      {
        attempt: 1,
        complete: true,
        after: structuredClone(run),
        jobs: CD_POLICY[index].jobs.map((name, jobIndex) => ({
          id: run.id * 100 + jobIndex,
          name,
          head_sha: sha,
          run_id: run.id,
          run_attempt: 1,
          status: 'completed',
          conclusion: 'success',
        })),
        artifacts: CD_POLICY[index].artifacts.map((template, artifactIndex) => ({
          id: 1000 + run.id * 10 + artifactIndex,
          name: template.replace('{sha}', sha),
          expired: false,
          size_in_bytes: 256,
          digest: `sha256:${'c'.repeat(64)}`,
          workflow_run: { id: run.id, head_sha: sha, head_branch: branch },
          created_at: '2026-11-03T11:35:00Z',
          expires_at: '2026-11-10T11:35:00Z',
        })),
      },
    ]),
  );
  const codeScanning = [
    {
      id: 900,
      name: 'CodeQL',
      app: { id: 57789, slug: 'github-advanced-security' },
      head_sha: sha,
      status: 'completed',
      conclusion: 'success',
      output: { annotations_count: 0 },
      started_at: '2026-11-03T11:31:00Z',
      completed_at: '2026-11-03T11:32:00Z',
    },
  ];
  return {
    schemaVersion: 1,
    repository: REPOSITORY,
    complete: true,
    capturedAt: new Date(now).toISOString(),
    branch: source,
    branchAfter: structuredClone(source),
    runs,
    runsAfter: structuredClone(runs),
    details,
    codeScanning,
    codeScanningAfter: structuredClone(codeScanning),
  };
}
const assess = (value) => assessSnapshot(value, target);
const mutate = (change) => {
  const value = fixture();
  change(value);
  return value;
};

function equivalentFixture() {
  const value = fixture();
  const tree = 'd'.repeat(40);
  const run = structuredClone(value.runs.find((entry) => entry.path.endsWith('/codeql.yml')));
  Object.assign(run, {
    event: 'pull_request',
    head_sha: otherSha,
    head_branch: 'reviewed',
    pull_requests: [{ number: 215 }],
  });
  const check = { ...value.codeScanning[0], head_sha: otherSha, pull_requests: [{ number: 215 }] };
  const source = {
    complete: true,
    commit: {
      sha,
      commit: { tree: { sha: tree } },
      parents: [{ sha: 'e'.repeat(40) }, { sha: otherSha }],
    },
    parent: { sha: otherSha, commit: { tree: { sha: tree } } },
    pr: {
      number: 215,
      merged: true,
      state: 'closed',
      merge_commit_sha: sha,
      merged_at: '2026-11-03T11:40:00Z',
      head: { sha: otherSha, ref: 'reviewed', repo: { full_name: REPOSITORY } },
      base: { ref: 'develop', repo: { full_name: REPOSITORY } },
    },
    run,
    checks: [check],
  };
  value.codeScanning = [];
  value.codeScanningAfter = [];
  value.equivalentCodeQL = source;
  value.equivalentCodeQLAfter = structuredClone(source);
  return value;
}

test('push without a security-result check accepts only the identical merged PR tree', () => {
  const result = assess(equivalentFixture());
  assert.equal(result.state, 'PASS');
  assert.equal(result.proof.sha, sha);
  assert.equal(result.proof.codeQLSourceSha, otherSha);
  assert.equal(result.proof.codeQLCheckId, 900);
});

test('merged PR associations cleared by GitHub retain explicit commit/tree/PR provenance', () => {
  const value = equivalentFixture();
  for (const source of [value.equivalentCodeQL, value.equivalentCodeQLAfter]) {
    source.run.pull_requests = [];
    source.checks[0].pull_requests = [];
  }
  assert.equal(assess(value).state, 'PASS');
  value.equivalentCodeQL.pr.merged = false;
  assert.equal(assess(value).state, 'FAIL');
});

for (const [name, change] of Object.entries({
  'different merge tree': (source) => {
    source.commit.commit.tree.sha = 'f'.repeat(40);
  },
  'missing tree identity': (source) => {
    delete source.parent.commit.tree;
  },
  'different merge commit': (source) => {
    source.commit.sha = otherSha;
  },
  'ordinary direct push': (source) => {
    source.commit.parents.pop();
  },
  'wrong merge parent': (source) => {
    source.commit.parents[1].sha = 'f'.repeat(40);
  },
  'unmerged PR': (source) => {
    source.pr.merged = false;
  },
  'open PR': (source) => {
    source.pr.state = 'open';
  },
  'unrelated PR merge': (source) => {
    source.pr.merge_commit_sha = otherSha;
  },
  'wrong PR head': (source) => {
    source.pr.head.sha = sha;
  },
  'fork PR': (source) => {
    source.pr.head.repo.full_name = 'other/repository';
  },
  'different target repository': (source) => {
    source.pr.base.repo.full_name = 'other/repository';
  },
  'different target branch': (source) => {
    source.pr.base.ref = 'main';
  },
  'future merge timestamp': (source) => {
    source.pr.merged_at = '2027-01-01T00:00:00Z';
  },
  'incomplete source pagination': (source) => {
    source.complete = false;
  },
  'malformed source checks': (source) => {
    source.checks = [null];
  },
  'wrong source workflow': (source) => {
    source.run.event = 'push';
  },
  'wrong source branch': (source) => {
    source.run.head_branch = 'other';
  },
  'unrelated source workflow PR': (source) => {
    source.run.pull_requests = [{ number: 214 }];
  },
  'newer failed source workflow': (source) => {
    source.run.conclusion = 'failure';
  },
  'source check alert': (source) => {
    source.checks[0].output.annotations_count = 1;
  },
  'failed source check': (source) => {
    source.checks[0].conclusion = 'failure';
  },
  'unrelated source check PR': (source) => {
    source.checks[0].pull_requests = [{ number: 214 }];
  },
  'source check for other code': (source) => {
    source.checks[0].head_sha = sha;
  },
})) {
  test(`identical-tree CodeQL rejects ${name} at either read`, () => {
    for (const key of ['equivalentCodeQL', 'equivalentCodeQLAfter']) {
      const value = equivalentFixture();
      change(value[key]);
      assert.equal(assess(value).state, 'FAIL');
    }
  });
}

test('identical-tree evidence waits for absent, changed or pending source results', () => {
  for (const change of [
    (source) => {
      source.run.status = 'in_progress';
      source.run.conclusion = null;
    },
    (source) => {
      source.run.run_attempt += 1;
    },
    (source) => {
      source.checks = [];
    },
    (source) => {
      source.checks[0].app = { id: 1, slug: 'untrusted' };
    },
  ]) {
    const value = equivalentFixture();
    change(value.equivalentCodeQLAfter);
    assert.equal(assess(value).state, 'WAIT');
  }
  const missing = equivalentFixture();
  delete missing.equivalentCodeQLAfter;
  assert.equal(assess(missing).state, 'WAIT');
});

test('a failing push security result cannot fall back to a successful PR', () => {
  const value = equivalentFixture();
  value.codeScanning = fixture().codeScanning;
  value.codeScanningAfter = fixture().codeScanning;
  value.codeScanning[0].conclusion = 'failure';
  assert.equal(assess(value).state, 'FAIL');
});

test('source collector exhausts associated PR pages and selects newest CodeQL attempt', async () => {
  const source = equivalentFixture().equivalentCodeQL;
  const calls = [];
  const request = async (route) => {
    calls.push(route);
    if (route === `commits/${sha}`) return source.commit;
    if (route === `commits/${otherSha}`) return source.parent;
    if (route === 'pulls/215') return source.pr;
    if (route === `commits/${sha}/pulls?per_page=100&page=1`)
      return Array.from({ length: 100 }, (_, index) => ({ number: index + 1 }));
    if (route === `commits/${sha}/pulls?per_page=100&page=2`) return [source.pr];
    if (route.startsWith('actions/runs?'))
      return {
        total_count: 2,
        workflow_runs: [
          { ...source.run, id: 1 },
          { ...source.run, id: 2, run_attempt: 2 },
        ],
      };
    if (route.startsWith(`commits/${otherSha}/check-runs?`))
      return { total_count: 1, check_runs: source.checks };
    throw new Error(`Unexpected route: ${route}`);
  };
  const result = await collectEquivalentCodeQL(request, target);
  assert.equal(result.run.id, 2);
  assert.equal(result.run.run_attempt, 2);
  assert.equal(result.complete, true);
  assert.ok(calls.some((route) => route.endsWith('pulls?per_page=100&page=2')));
});

test('source collector cannot invent evidence for a direct push or ambiguous merge', async () => {
  const source = equivalentFixture().equivalentCodeQL;
  assert.equal(
    await collectEquivalentCodeQL(async () => ({ ...source.commit, parents: [] }), target),
    null,
  );
  assert.equal(
    await collectEquivalentCodeQL(
      async (route) => (route === `commits/${sha}` ? source.commit : [source.pr, source.pr]),
      target,
    ),
    null,
  );
});

test('release policy inherits existing acceptance gates and includes R26 source-bound evidence', () => {
  assert.deepEqual(CD_POLICY.slice(0, POLICY.length), POLICY);
  assert.equal(CD_POLICY.at(-1).path, '.github/workflows/r26-security.yml');
  assert.deepEqual(CD_POLICY.at(-1).artifacts, ['r26-security-{sha}']);
});

test('all successful current push evidence returns only a sanitized release proof', () => {
  const value = fixture();
  value.details['1'].privateDiagnostic = 'NEVER_OUTPUT_PRIVATE_DIAGNOSTICS';
  const result = assess(value);
  assert.equal(result.state, 'PASS');
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.pending, []);
  assert.equal(result.proof.sha, sha);
  assert.equal(result.proof.branch, 'develop');
  assert.equal(result.proof.workflows.length, CD_POLICY.length);
  assert.equal(result.proof.codeQLCheckId, 900);
  assert.doesNotMatch(
    JSON.stringify(result.proof),
    /PRIVATE_DIAGNOSTICS|jobs|artifacts|head_repository/,
  );
  assert.equal(assessSnapshot(fixture('main'), { ...target, branch: 'main' }).state, 'PASS');
});

for (const [name, change] of Object.entries({
  'wrong repository': (value) => {
    value.repository = 'attacker/repo';
  },
  'incomplete pagination': (value) => {
    value.complete = false;
  },
  'wrong initial branch': (value) => {
    value.branch.name = 'feature';
  },
  'old branch tip': (value) => {
    value.branch.commit.sha = otherSha;
  },
  'branch moved at final recheck': (value) => {
    value.branchAfter.commit.sha = otherSha;
  },
  'missing final branch recheck': (value) => {
    delete value.branchAfter;
  },
  'stale capture': (value) => {
    value.capturedAt = '2026-11-03T11:00:00Z';
  },
  'future capture': (value) => {
    value.capturedAt = '2026-11-03T13:00:00Z';
  },
  'invalid capture': (value) => {
    value.capturedAt = 'invalid';
  },
  'missing final workflow inventory': (value) => {
    delete value.runsAfter;
  },
  'malformed workflow inventory': (value) => {
    value.runs.push(null);
  },
  'invalid run identifier': (value) => {
    value.runs[0].id = '../../secret';
  },
  'invalid attempt identifier': (value) => {
    value.runs[0].run_attempt = 0;
  },
  'duplicate same-attempt workflow': (value) => {
    value.runs.push(structuredClone(value.runs[0]));
  },
  'workflow for a different source': (value) => {
    value.runs[0].head_sha = otherSha;
  },
  'workflow for a different branch': (value) => {
    value.runs[0].head_branch = 'main';
  },
  'PR workflow masquerading as push': (value) => {
    value.runs[0].event = 'pull_request';
  },
  'manual workflow masquerading as push': (value) => {
    value.runs[0].event = 'workflow_dispatch';
  },
  'scheduled workflow masquerading as push': (value) => {
    value.runs[0].event = 'schedule';
  },
  'workflow in a different repository': (value) => {
    value.runs[0].repository.full_name = 'attacker/repo';
  },
  'fork source': (value) => {
    value.runs[0].head_repository.full_name = 'attacker/repo';
  },
  'unverified source repository': (value) => {
    delete value.runs[0].head_repository;
  },
  'failed workflow': (value) => {
    value.runs[0].conclusion = 'failure';
  },
  'cancelled workflow': (value) => {
    value.runs[0].conclusion = 'cancelled';
  },
  'skipped workflow': (value) => {
    value.runs[0].conclusion = 'skipped';
  },
  'neutral workflow': (value) => {
    value.runs[0].conclusion = 'neutral';
  },
  'unknown workflow state': (value) => {
    value.runs[0].status = 'invented';
  },
  'pending workflow with stale conclusion': (value) => {
    value.runs[0].status = 'in_progress';
  },
  'invalid attempt timestamp': (value) => {
    value.runs[0].run_started_at = 'invalid';
  },
  'future attempt timestamp': (value) => {
    value.runs[0].run_started_at = '2026-11-04T00:00:00Z';
  },
  'failed final workflow observation': (value) => {
    value.runsAfter[0].conclusion = 'failure';
  },
  'untrusted final workflow provenance': (value) => {
    value.runsAfter[0].head_repository.full_name = 'attacker/repo';
  },
  'incomplete job pagination': (value) => {
    value.details['1'].complete = false;
  },
  'previous-attempt evidence': (value) => {
    value.details['1'].attempt = 0;
  },
  'wrong attempt at run recheck': (value) => {
    value.details['1'].after.head_sha = otherSha;
  },
  'failed run recheck': (value) => {
    value.details['1'].after.conclusion = 'failure';
  },
  'malformed jobs': (value) => {
    value.details['1'].jobs = [null];
  },
  'duplicate required job': (value) => {
    value.details['1'].jobs.push({ ...value.details['1'].jobs[0] });
  },
  'job from different run': (value) => {
    value.details['1'].jobs[0].run_id = 99;
  },
  'job from previous attempt': (value) => {
    value.details['1'].jobs[0].run_attempt = 0;
  },
  'job from different source': (value) => {
    value.details['1'].jobs[0].head_sha = otherSha;
  },
  'skipped required job': (value) => {
    value.details['1'].jobs[0].conclusion = 'skipped';
  },
  'failed required job': (value) => {
    value.details['1'].jobs[0].conclusion = 'failure';
  },
  'malformed artifacts': (value) => {
    value.details['3'].artifacts = [null];
  },
  'duplicate current artifact': (value) => {
    value.details['3'].artifacts.push({ ...value.details['3'].artifacts[0], id: 9999 });
  },
  'artifact from previous attempt': (value) => {
    value.details['3'].artifacts[0].created_at = '2026-11-03T11:00:00Z';
  },
  'artifact from other workflow': (value) => {
    value.details['3'].artifacts[0].workflow_run.id = 99;
  },
  'artifact from other source': (value) => {
    value.details['3'].artifacts[0].workflow_run.head_sha = otherSha;
  },
  'artifact from other branch': (value) => {
    value.details['3'].artifacts[0].workflow_run.head_branch = 'main';
  },
  'artifact with explicit previous attempt': (value) => {
    value.details['3'].artifacts[0].workflow_run.run_attempt = 2;
  },
  'expired artifact': (value) => {
    value.details['3'].artifacts[0].expired = true;
  },
  'artifact past expiry despite flag': (value) => {
    value.details['3'].artifacts[0].expires_at = '2026-11-03T11:55:00Z';
  },
  'empty artifact': (value) => {
    value.details['3'].artifacts[0].size_in_bytes = 0;
  },
  'missing artifact digest': (value) => {
    delete value.details['3'].artifacts[0].digest;
  },
  'invalid artifact timestamp': (value) => {
    value.details['3'].artifacts[0].created_at = 'invalid';
  },
  'future artifact timestamp': (value) => {
    value.details['3'].artifacts[0].created_at = '2026-11-04T00:00:00Z';
  },
}))
  test(`fails closed for ${name}`, () => {
    const result = assess(mutate(change));
    assert.equal(result.state, 'FAIL');
    assert.ok(result.errors.length > 0);
    assert.equal(result.proof, undefined);
  });

for (const [name, change] of Object.entries({
  'missing workflow': (value) => {
    value.runs.pop();
    value.runsAfter.pop();
  },
  'pending workflow': (value) => {
    value.runs[0].status = 'in_progress';
    value.runs[0].conclusion = null;
  },
  'missing attempt details': (value) => {
    delete value.details['1'];
  },
  'missing required job': (value) => {
    value.details['1'].jobs = [];
  },
  'pending required job': (value) => {
    value.details['1'].jobs[0].status = 'queued';
    value.details['1'].jobs[0].conclusion = null;
  },
  'missing required artifact': (value) => {
    value.details['3'].artifacts = [];
  },
  'new successful run needs its own evidence': (value) => {
    value.runsAfter[0].id = 100;
  },
  'late workflow retry': (value) => {
    value.runsAfter[0].run_attempt = 2;
    value.runsAfter[0].status = 'queued';
    value.runsAfter[0].conclusion = null;
  },
  'run restarted during job collection': (value) => {
    value.details['1'].after.run_attempt = 2;
    value.details['1'].after.status = 'in_progress';
    value.details['1'].after.conclusion = null;
  },
}))
  test(`waits without accepting ${name}`, () => {
    const result = assess(mutate(change));
    assert.equal(result.state, 'WAIT');
    assert.equal(result.proof, undefined);
  });

test('the latest pending run or attempt shadows older successful evidence', () => {
  for (const newer of [{ id: 100 }, { run_attempt: 2 }]) {
    const value = fixture();
    const run = { ...value.runs[0], ...newer, status: 'queued', conclusion: null };
    value.runs.push(run);
    value.runsAfter.push(structuredClone(run));
    assert.equal(assess(value).state, 'WAIT');
    run.conclusion = 'failure';
    run.status = 'completed';
    assert.equal(assess(value).state, 'FAIL');
  }
});

test('a known failure wins even while another workflow is missing', () => {
  const value = fixture();
  value.runs.pop();
  value.runs[0].conclusion = 'failure';
  assert.equal(assess(value).state, 'FAIL');
});

test('run-scoped artifacts may retain an older attempt but require exactly one valid current artifact', () => {
  const value = fixture();
  value.details['3'].artifacts.unshift({
    ...value.details['3'].artifacts[0],
    id: 12345,
    created_at: '2026-11-03T11:00:00Z',
    expired: true,
  });
  assert.equal(assess(value).state, 'PASS');
});

for (const [name, change] of Object.entries({
  'failure despite a green CodeQL Actions job': (value) => {
    value.codeScanning[0].conclusion = 'failure';
  },
  'remaining alert annotations': (value) => {
    value.codeScanning[0].output.annotations_count = 1;
  },
  'unknown annotation count': (value) => {
    delete value.codeScanning[0].output;
  },
  'wrong source SHA': (value) => {
    value.codeScanning[0].head_sha = otherSha;
  },
  'invalid check id': (value) => {
    value.codeScanning[0].id = null;
  },
  'duplicate official check id': (value) => {
    value.codeScanning.push(structuredClone(value.codeScanning[0]));
  },
  'malformed check inventory': (value) => {
    value.codeScanning.push(null);
  },
  'missing final check inventory': (value) => {
    delete value.codeScanningAfter;
  },
  'result from an earlier workflow attempt': (value) => {
    value.codeScanning[0].completed_at = '2026-11-03T11:00:00Z';
  },
  'invalid completion time': (value) => {
    value.codeScanning[0].completed_at = 'invalid';
  },
  'future completion': (value) => {
    value.codeScanning[0].completed_at = '2026-11-04T00:00:00Z';
  },
  'failure at final recheck': (value) => {
    value.codeScanningAfter[0].conclusion = 'failure';
  },
  'annotations at final recheck': (value) => {
    value.codeScanningAfter[0].output.annotations_count = 2;
  },
}))
  test(`CodeQL blocks ${name}`, () => {
    assert.equal(assess(mutate(change)).state, 'FAIL');
  });

for (const [name, change] of Object.entries({
  'missing official result': (value) => {
    value.codeScanning = [];
    value.codeScanningAfter = [];
  },
  'spoofed publisher id': (value) => {
    value.codeScanning[0].app.id = 15368;
  },
  'spoofed publisher slug': (value) => {
    value.codeScanning[0].app.slug = 'github-actions';
  },
  'pending latest official result': (value) => {
    value.codeScanning.push({
      ...value.codeScanning[0],
      id: 901,
      status: 'queued',
      conclusion: null,
    });
  },
  'new success during collection': (value) => {
    value.codeScanningAfter[0].id = 901;
  },
}))
  test(`CodeQL cannot accept ${name}`, () => {
    const result = assess(mutate(change));
    assert.equal(result.state, 'WAIT');
    assert.equal(result.proof, undefined);
  });

test('a similarly named unofficial check cannot replace or veto official results', () => {
  const value = fixture();
  value.codeScanning.push({
    ...value.codeScanning[0],
    id: 999,
    app: { id: 42, slug: 'other' },
    conclusion: 'failure',
  });
  assert.equal(assess(value).state, 'PASS');
});

function fakeGitHub(value, { splitRuns = false, onRequest = () => {} } = {}) {
  const requests = [];
  const fetchImpl = async (input, options) => {
    const url = new URL(input);
    assert.equal(url.origin, 'https://api.github.com');
    const prefix = `/repos/${REPOSITORY}/`;
    assert.ok(url.pathname.startsWith(prefix));
    assert.equal(options.method, 'GET');
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Authorization, 'Bearer synthetic-read-token');
    assert.ok(options.signal instanceof AbortSignal);
    const route = url.pathname.slice(prefix.length);
    requests.push(route);
    onRequest(route, requests);
    let body;
    if (route === 'branches/develop') body = value.branch;
    else if (route === 'actions/runs') {
      assert.equal(url.searchParams.get('head_sha'), sha);
      assert.equal(url.searchParams.get('branch'), 'develop');
      assert.equal(url.searchParams.get('event'), 'push');
      const page = Number(url.searchParams.get('page'));
      body = {
        total_count: value.runs.length,
        workflow_runs: splitRuns ? value.runs.slice(page - 1, page) : value.runs,
      };
    } else if (route === `commits/${sha}/check-runs`) {
      assert.equal(url.searchParams.get('check_name'), 'CodeQL');
      assert.equal(url.searchParams.get('filter'), 'all');
      body = { total_count: value.codeScanning.length, check_runs: value.codeScanning };
    } else {
      const match = /^actions\/runs\/(\d+)(.*)$/u.exec(route);
      assert.ok(match, route);
      const detail = value.details[match[1]];
      if (match[2] === '/attempts/1/jobs')
        body = { total_count: detail.jobs.length, jobs: detail.jobs };
      else if (match[2] === '/artifacts')
        body = { total_count: detail.artifacts.length, artifacts: detail.artifacts };
      else {
        assert.equal(match[2], '');
        body = detail.after;
      }
    }
    return { ok: true, json: async () => structuredClone(body) };
  };
  return { fetchImpl, requests };
}

test('collector reads the merged source twice when push has no official result', async () => {
  const value = equivalentFixture();
  const source = value.equivalentCodeQL;
  const api = fakeGitHub(value);
  let prReads = 0;
  let sourceChecks = 0;
  const fetchImpl = async (input, options) => {
    const url = new URL(input);
    const route = url.pathname.slice(`/repos/${REPOSITORY}/`.length);
    let body;
    if (route === `commits/${sha}`) body = source.commit;
    else if (route === `commits/${otherSha}`) body = source.parent;
    else if (route === `commits/${sha}/pulls`) body = [source.pr];
    else if (route === 'pulls/215') {
      prReads += 1;
      body = source.pr;
    } else if (route === 'actions/runs' && url.searchParams.get('event') === 'pull_request') {
      assert.equal(url.searchParams.get('head_sha'), otherSha);
      body = { total_count: 1, workflow_runs: [source.run] };
    } else if (route === `commits/${otherSha}/check-runs`) {
      sourceChecks += 1;
      body = { total_count: 1, check_runs: source.checks };
    } else return api.fetchImpl(input, options);
    assert.equal(options.redirect, 'error');
    assert.equal(url.origin, 'https://api.github.com');
    return { ok: true, json: async () => structuredClone(body) };
  };
  const snapshot = await collectSnapshot(target, 'synthetic-read-token', {
    fetchImpl,
    now: () => now,
  });
  assert.equal(assess(snapshot).state, 'PASS');
  assert.equal(prReads, 2);
  assert.equal(sourceChecks, 2);
});

test('collector exhausts pagination, uses attempt-specific jobs, and rechecks head, runs and CodeQL', async () => {
  const api = fakeGitHub(fixture(), { splitRuns: true });
  const snapshot = await collectSnapshot(target, 'synthetic-read-token', {
    fetchImpl: api.fetchImpl,
    now: () => now,
  });
  assert.equal(assess(snapshot).state, 'PASS');
  assert.equal(
    api.requests.filter((route) => route === 'actions/runs').length,
    CD_POLICY.length * 2,
  );
  assert.equal(api.requests.filter((route) => route === 'branches/develop').length, 2);
  assert.equal(api.requests.filter((route) => route.endsWith('/check-runs')).length, 2);
  assert.equal(
    api.requests.filter((route) => route.endsWith('/attempts/1/jobs')).length,
    CD_POLICY.length,
  );
  assert.equal(api.requests.at(-1), 'branches/develop');
});

test('collector detects a branch movement during evidence collection', async () => {
  const value = fixture();
  const api = fakeGitHub(value, {
    onRequest: (route, requests) => {
      if (route === 'branches/develop' && requests.filter((item) => item === route).length === 2)
        value.branch.commit.sha = otherSha;
    },
  });
  const snapshot = await collectSnapshot(target, 'synthetic-read-token', {
    fetchImpl: api.fetchImpl,
    now: () => now,
  });
  assert.equal(assess(snapshot).state, 'FAIL');
});

test('collector rejects unknown targets and missing tokens before any network request', async () => {
  const fetchImpl = () => assert.fail('must not call GitHub');
  for (const invalid of [
    { branch: 'feature', sha },
    { branch: 'develop', sha: '../secrets' },
  ]) {
    await assert.rejects(collectSnapshot(invalid, 'synthetic-read-token', { fetchImpl }));
  }
  await assert.rejects(collectSnapshot(target, '', { fetchImpl }));
});

test('collector redacts HTTP, parse and transport errors rather than including response bodies or tokens', async () => {
  for (const fetchImpl of [
    async () => ({ ok: false, status: 403, text: async () => 'SECRET_RESPONSE' }),
    async () => ({
      ok: true,
      json: async () => {
        throw new Error('SECRET_RESPONSE');
      },
    }),
    async () => {
      throw new Error('SECRET_TRANSPORT');
    },
  ]) {
    await assert.rejects(collectSnapshot(target, 'PRIVATE_TOKEN', { fetchImpl }), (error) => {
      assert.doesNotMatch(error.message, /SECRET|PRIVATE_TOKEN/);
      return true;
    });
  }
});

test('waiting is bounded and retries only missing or pending evidence', async () => {
  let clock = now;
  let calls = 0;
  const waits = [];
  const progress = [];
  const proof = await waitForEvidence({ ...target, waitSeconds: 30 }, 'synthetic-read-token', {
    now: () => clock,
    collect: async () => {
      const value = fixture();
      value.capturedAt = new Date(clock).toISOString();
      if (++calls === 1) {
        value.runs.pop();
        value.runsAfter.pop();
      }
      return value;
    },
    pause: async (duration) => {
      waits.push(duration);
      clock += duration;
    },
    progress: (message) => progress.push(message),
  });
  assert.equal(proof.status, 'PASS');
  assert.equal(calls, 2);
  assert.deepEqual(waits, [15_000]);
  assert.deepEqual(progress, ['WAIT required GitHub evidence is missing or pending']);
});

test('a terminal failure is never retried even with the full wait budget', async () => {
  let calls = 0;
  await assert.rejects(
    waitForEvidence({ ...target, waitSeconds: MAX_WAIT_SECONDS }, 'synthetic-read-token', {
      now: () => now,
      collect: async () => {
        calls += 1;
        return mutate((value) => {
          value.runs[0].conclusion = 'failure';
        });
      },
      pause: () => assert.fail('failure must not sleep'),
    }),
    /failed validation/,
  );
  assert.equal(calls, 1);
});

test('missing evidence times out without oversleeping or producing a passing proof', async () => {
  let clock = now;
  const waits = [];
  await assert.rejects(
    waitForEvidence({ ...target, waitSeconds: 2 }, 'synthetic-read-token', {
      now: () => clock,
      collect: async () =>
        mutate((value) => {
          value.runs.pop();
          value.runsAfter.pop();
          value.capturedAt = new Date(clock).toISOString();
        }),
      pause: async (duration) => {
        waits.push(duration);
        clock += duration;
      },
    }),
    /missing or pending/,
  );
  assert.deepEqual(waits, [2000]);
});

test('default one-shot execution does not wait, and invalid wait bounds are refused', async () => {
  const options = {
    now: () => now,
    pause: () => assert.fail('must not wait'),
    collect: async () =>
      mutate((value) => {
        value.codeScanning = [];
      }),
  };
  await assert.rejects(
    waitForEvidence({ ...target, waitSeconds: 0 }, 'synthetic-read-token', options),
    /missing or pending/,
  );
  for (const waitSeconds of [-1, MAX_WAIT_SECONDS + 1, 0.5, NaN, undefined]) {
    await assert.rejects(
      waitForEvidence({ ...target, waitSeconds }, 'synthetic-read-token', options),
      /Invalid/,
    );
  }
});

test('CLI accepts only explicit trusted branch and full SHA with a bounded optional wait', () => {
  assert.deepEqual(parseArgs(['--branch', 'develop', '--sha', sha]), {
    branch: 'develop',
    sha,
    waitSeconds: 0,
  });
  assert.deepEqual(parseArgs(['--wait-seconds', '1800', '--sha', sha, '--branch', 'main']), {
    branch: 'main',
    sha,
    waitSeconds: 1800,
  });
  for (const args of [
    [],
    ['--branch', 'develop'],
    ['--branch', 'feature', '--sha', sha],
    ['--branch', 'develop', '--sha', 'short'],
    ['--branch', 'develop', '--sha', sha, '--branch', 'main'],
    ['--branch', 'develop', '--sha', sha, '--wait-seconds', '1801'],
    ['--branch', 'develop', '--sha', sha, '--wait-seconds', '-1'],
    ['--branch', 'develop', '--sha', sha, '--wait-seconds', '1.5'],
    ['--branch', 'develop', '--sha', sha, '--token', 'PRIVATE_TOKEN'],
  ])
    assert.throws(() => parseArgs(args));
});

test('actual CLI failures exit nonzero and never print input secrets', () => {
  const cli = fileURLToPath(new URL('./cd-evidence.mjs', import.meta.url));
  for (const args of [
    ['--branch', 'PRIVATE_TARGET', '--sha', sha],
    ['--branch', 'develop', '--sha', sha],
  ]) {
    const result = spawnSync(process.execPath, [cli, ...args], {
      encoding: 'utf8',
      env: { ...process.env, GITHUB_TOKEN: '' },
    });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /FAIL CD evidence/);
    assert.doesNotMatch(result.stderr, /PRIVATE_TARGET|Bearer|Authorization/);
  }
});
