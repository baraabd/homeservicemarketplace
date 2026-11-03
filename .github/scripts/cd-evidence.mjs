import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { POLICY, REPOSITORY, allPages } from './pr-acceptance.mjs';

// Reuse the repository's release checks; R26 additionally exercises the
// deployed cookie, authorization and enforced document-CSP contract.
export const CD_POLICY = [
  ...POLICY,
  {
    path: '.github/workflows/r26-security.yml',
    jobs: ['R26 cookies, authorization and enforced CSP'],
    artifacts: ['r26-security-{sha}'],
  },
];
export const MAX_WAIT_SECONDS = 1800;
const SHA = /^[a-f0-9]{40}$/u;
const BRANCHES = new Set(['develop', 'main']);
const PENDING = new Set(['queued', 'in_progress', 'waiting', 'pending', 'requested']);
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const positiveId = (value) => Number.isSafeInteger(value) && value > 0;
const time = (value) => (typeof value === 'string' ? Date.parse(value) : NaN);
const validTarget = (target) =>
  object(target) && BRANCHES.has(target.branch) && SHA.test(target.sha ?? '');
const runKeys = [
  'id',
  'run_attempt',
  'path',
  'event',
  'head_branch',
  'head_sha',
  'status',
  'conclusion',
  'run_started_at',
];
const checkKeys = ['id', 'head_sha', 'status', 'conclusion', 'started_at', 'completed_at'];
const same = (before, after, keys) => keys.every((key) => before?.[key] === after?.[key]);

export function parseArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    if (
      !['--branch', '--sha', '--wait-seconds'].includes(key) ||
      values.has(key) ||
      argv[index + 1] === undefined
    ) {
      throw new Error('Invalid CD evidence arguments');
    }
    values.set(key, argv[index + 1]);
  }
  const wait = values.get('--wait-seconds') ?? '0';
  const target = {
    branch: values.get('--branch'),
    sha: values.get('--sha'),
    waitSeconds: Number(wait),
  };
  if (
    !validTarget(target) ||
    !/^(0|[1-9][0-9]*)$/u.test(wait) ||
    target.waitSeconds > MAX_WAIT_SECONDS
  ) {
    throw new Error('Invalid CD evidence target or wait bound');
  }
  return target;
}

function latestRun(runs, workflow) {
  return runs
    .filter((run) => run.path === workflow)
    .sort((left, right) => right.id - left.id || right.run_attempt - left.run_attempt)[0];
}

function officialCodeQL(checks) {
  return checks
    .filter(
      (check) =>
        check.name === 'CodeQL' &&
        check.app?.id === 57789 &&
        check.app?.slug === 'github-advanced-security',
    )
    .sort((left, right) => right.id - left.id)[0];
}

/** Classify missing/in-flight evidence separately; failures never become waits. */
export function assessSnapshot(snapshot, target) {
  const errors = [];
  const pending = [];
  const now = target?.now ?? Date.now();
  if (!validTarget(target) || !Number.isFinite(now))
    return { state: 'FAIL', errors: ['Invalid deployment target'], pending };
  if (
    !object(snapshot) ||
    snapshot.schemaVersion !== 1 ||
    snapshot.repository !== REPOSITORY ||
    snapshot.complete !== true
  ) {
    return { state: 'FAIL', errors: ['Incomplete GitHub evidence'], pending };
  }
  const captured = time(snapshot.capturedAt);
  if (!(captured <= now + 60_000) || now - captured > 60_000)
    errors.push('Stale GitHub evidence capture');
  for (const branch of [snapshot.branch, snapshot.branchAfter]) {
    if (branch?.name !== target.branch || branch?.commit?.sha !== target.sha)
      errors.push('Selected branch has moved or cannot be verified');
  }
  if (
    ![snapshot.runs, snapshot.runsAfter, snapshot.codeScanning, snapshot.codeScanningAfter].every(
      (items) => Array.isArray(items) && items.every(object),
    )
  )
    return {
      state: 'FAIL',
      errors: [...errors, 'Malformed workflow or security-check evidence'],
      pending,
    };

  function runState(run, policy) {
    if (!run) {
      pending.push(`Missing workflow: ${policy.path}`);
      return false;
    }
    if (
      !positiveId(run.id) ||
      !positiveId(run.run_attempt) ||
      run.path !== policy.path ||
      run.head_sha !== target.sha ||
      run.head_branch !== target.branch ||
      run.event !== 'push' ||
      run.repository?.full_name !== REPOSITORY ||
      run.head_repository?.full_name !== REPOSITORY
    ) {
      errors.push(`Invalid workflow provenance: ${policy.path}`);
      return false;
    }
    if (PENDING.has(run.status) && run.conclusion === null) {
      pending.push(`Pending workflow: ${policy.path}`);
      return false;
    }
    if (run.status !== 'completed' || run.conclusion !== 'success') {
      errors.push(`Unsuccessful workflow: ${policy.path}`);
      return false;
    }
    if (
      !Number.isFinite(time(run.run_started_at)) ||
      time(run.run_started_at) > captured + 60_000
    ) {
      errors.push(`Invalid workflow attempt time: ${policy.path}`);
      return false;
    }
    return true;
  }

  for (const policy of CD_POLICY) {
    for (const runs of [snapshot.runs, snapshot.runsAfter]) {
      const matches = runs.filter((run) => run.path === policy.path);
      if (
        matches.some((run) => !positiveId(run.id) || !positiveId(run.run_attempt)) ||
        new Set(matches.map((run) => `${run.id}:${run.run_attempt}`)).size !== matches.length
      ) {
        errors.push(`Invalid workflow inventory: ${policy.path}`);
      }
    }
    // Select before testing success: a newer rerun must shadow the old result.
    const run = latestRun(snapshot.runs, policy.path);
    const after = latestRun(snapshot.runsAfter, policy.path);
    const ready = runState(run, policy);
    const afterReady = runState(after, policy);
    if (!ready || !afterReady) continue;
    if (!same(run, after, runKeys)) {
      pending.push(`New workflow evidence requires collection: ${policy.path}`);
      continue;
    }
    const detail = snapshot.details?.[String(run.id)];
    if (!detail) {
      pending.push(`Missing attempt evidence: ${policy.path}`);
      continue;
    }
    if (
      detail.complete !== true ||
      detail.attempt !== run.run_attempt ||
      !Array.isArray(detail.jobs) ||
      !detail.jobs.every(object) ||
      !Array.isArray(detail.artifacts) ||
      !detail.artifacts.every(object)
    ) {
      errors.push(`Incomplete or stale attempt evidence: ${policy.path}`);
      continue;
    }
    const detailReady = runState(detail.after, policy);
    if (!detailReady) continue;
    if (!same(run, detail.after, runKeys)) {
      pending.push(`Changed workflow attempt requires collection: ${policy.path}`);
      continue;
    }
    for (const name of policy.jobs) {
      const jobs = detail.jobs.filter((job) => job.name === name);
      if (jobs.length === 0) {
        pending.push(`Missing required job: ${name}`);
        continue;
      }
      const job = jobs[0];
      if (
        jobs.length !== 1 ||
        job.run_id !== run.id ||
        job.run_attempt !== run.run_attempt ||
        (job.head_sha !== undefined && job.head_sha !== target.sha)
      ) {
        errors.push(`Wrong required job attempt: ${name}`);
      } else if (PENDING.has(job.status) && job.conclusion === null) {
        pending.push(`Pending required job: ${name}`);
      } else if (job.status !== 'completed' || job.conclusion !== 'success') {
        errors.push(`Unsuccessful required job: ${name}`);
      }
    }
    for (const template of policy.artifacts) {
      const name = template.replace('{sha}', target.sha);
      const named = detail.artifacts.filter((artifact) => artifact.name === name);
      if (named.length === 0) {
        pending.push(`Missing required artifact: ${template}`);
        continue;
      }
      // The artifacts endpoint is run-scoped, not attempt-scoped. Ignore an
      // older attempt only when its timestamp is valid and unambiguously older.
      const candidates = named.filter(
        (artifact) =>
          !Number.isFinite(time(artifact.created_at)) ||
          time(artifact.created_at) >= time(run.run_started_at),
      );
      const artifact = candidates[0];
      if (
        candidates.length !== 1 ||
        !positiveId(artifact?.id) ||
        artifact.expired !== false ||
        !Number.isSafeInteger(artifact.size_in_bytes) ||
        artifact.size_in_bytes <= 0 ||
        !/^sha256:[a-f0-9]{64}$/u.test(artifact.digest ?? '') ||
        artifact.workflow_run?.id !== run.id ||
        artifact.workflow_run?.head_sha !== target.sha ||
        (artifact.workflow_run?.head_branch !== undefined &&
          artifact.workflow_run.head_branch !== target.branch) ||
        (artifact.workflow_run?.run_attempt !== undefined &&
          artifact.workflow_run.run_attempt !== run.run_attempt) ||
        !(time(artifact.created_at) <= captured + 60_000) ||
        !(time(artifact.expires_at) > now)
      ) {
        errors.push(`Invalid, expired or stale required artifact: ${template}`);
      }
    }
  }

  const codeQLRun = latestRun(snapshot.runs, '.github/workflows/codeql.yml');
  const checks = [snapshot.codeScanning, snapshot.codeScanningAfter];
  const selected = checks.map(officialCodeQL);
  for (const list of checks) {
    const official = list.filter(
      (check) =>
        check.name === 'CodeQL' &&
        check.app?.id === 57789 &&
        check.app?.slug === 'github-advanced-security',
    );
    if (
      official.some((check) => !positiveId(check.id)) ||
      new Set(official.map((check) => check.id)).size !== official.length
    ) {
      errors.push('Invalid official CodeQL security-result inventory');
    }
  }
  for (const check of selected) {
    if (!check) {
      pending.push('Missing official CodeQL security result');
      continue;
    }
    if (!positiveId(check.id) || check.head_sha !== target.sha) {
      errors.push('Wrong official CodeQL security-result provenance');
    } else if (PENDING.has(check.status) && check.conclusion === null) {
      pending.push('Pending official CodeQL security result');
    } else if (
      check.status !== 'completed' ||
      check.conclusion !== 'success' ||
      check.output?.annotations_count !== 0
    ) {
      errors.push('Official CodeQL result must succeed with zero annotations');
    } else if (
      !(time(check.completed_at) >= time(check.started_at)) ||
      (codeQLRun && !(time(check.completed_at) >= time(codeQLRun.run_started_at))) ||
      !(time(check.completed_at) <= captured + 60_000)
    ) {
      errors.push('Stale official CodeQL security result');
    }
  }
  if (
    selected.every(Boolean) &&
    (!same(selected[0], selected[1], checkKeys) ||
      selected[0].output?.annotations_count !== selected[1].output?.annotations_count)
  ) {
    pending.push('Changed official CodeQL result requires collection');
  }
  const state = errors.length ? 'FAIL' : pending.length ? 'WAIT' : 'PASS';
  const result = { state, errors: [...new Set(errors)], pending: [...new Set(pending)] };
  if (state === 'PASS')
    result.proof = {
      schemaVersion: 1,
      status: 'PASS',
      repository: REPOSITORY,
      branch: target.branch,
      sha: target.sha,
      capturedAt: snapshot.capturedAt,
      workflows: CD_POLICY.map((policy) => {
        const run = latestRun(snapshot.runs, policy.path);
        return { path: policy.path, runId: run.id, attempt: run.run_attempt };
      }),
      codeQLCheckId: selected[0].id,
    };
  return result;
}

/** Read-only GitHub calls. Fixed API host/repository; never follow redirects. */
export async function collectSnapshot(target, token, { fetchImpl = fetch, now = Date.now } = {}) {
  if (!validTarget(target) || typeof token !== 'string' || !token.trim())
    throw new Error('CD evidence target and GitHub read token are required');
  const request = async (route) => {
    let response;
    try {
      response = await fetchImpl(`https://api.github.com/repos/${REPOSITORY}/${route}`, {
        method: 'GET',
        redirect: 'error',
        signal: AbortSignal.timeout(20_000),
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${token}`,
          'X-GitHub-Api-Version': '2022-11-28',
        },
      });
    } catch {
      throw new Error('GitHub evidence request failed');
    }
    if (!response.ok) throw new Error('GitHub evidence request was refused');
    try {
      return await response.json();
    } catch {
      throw new Error('GitHub evidence response was invalid');
    }
  };
  const branchRoute = `branches/${target.branch}`;
  const runsRoute = `actions/runs?event=push&head_sha=${target.sha}&branch=${target.branch}`;
  const checksRoute = `commits/${target.sha}/check-runs?check_name=CodeQL&filter=all`;
  const branch = await request(branchRoute);
  if (branch?.name !== target.branch || branch?.commit?.sha !== target.sha)
    throw new Error('Selected branch has moved or cannot be verified');
  const [runs, codeScanning] = await Promise.all([
    allPages(request, runsRoute, 'workflow_runs'),
    allPages(request, checksRoute, 'check_runs'),
  ]);
  if (!runs.every(object) || !codeScanning.every(object))
    throw new Error('Malformed GitHub evidence inventory');
  const details = {};
  await Promise.all(
    CD_POLICY.map(async (policy) => {
      const run = latestRun(runs, policy.path);
      if (
        !run ||
        !positiveId(run.id) ||
        !positiveId(run.run_attempt) ||
        run.status !== 'completed' ||
        run.conclusion !== 'success'
      )
        return;
      const [jobs, artifacts] = await Promise.all([
        allPages(request, `actions/runs/${run.id}/attempts/${run.run_attempt}/jobs`, 'jobs'),
        allPages(request, `actions/runs/${run.id}/artifacts`, 'artifacts'),
      ]);
      details[String(run.id)] = {
        attempt: run.run_attempt,
        complete: true,
        jobs,
        artifacts,
        after: await request(`actions/runs/${run.id}`),
      };
    }),
  );
  const [runsAfter, codeScanningAfter] = await Promise.all([
    allPages(request, runsRoute, 'workflow_runs'),
    allPages(request, checksRoute, 'check_runs'),
  ]);
  const branchAfter = await request(branchRoute);
  return {
    schemaVersion: 1,
    repository: REPOSITORY,
    complete: true,
    capturedAt: new Date(now()).toISOString(),
    branch,
    branchAfter,
    runs,
    runsAfter,
    codeScanning,
    codeScanningAfter,
    details,
  };
}

export async function waitForEvidence(
  target,
  token,
  { collect = collectSnapshot, now = Date.now, pause = sleep, progress = () => {} } = {},
) {
  if (
    !validTarget(target) ||
    !Number.isInteger(target.waitSeconds) ||
    target.waitSeconds < 0 ||
    target.waitSeconds > MAX_WAIT_SECONDS
  ) {
    throw new Error('Invalid CD evidence wait request');
  }
  const deadline = now() + target.waitSeconds * 1000;
  for (;;) {
    const snapshot = await collect(target, token);
    const result = assessSnapshot(snapshot, { ...target, now: now() });
    if (result.state === 'PASS') return result.proof;
    if (result.state === 'FAIL') throw new Error('Required GitHub evidence failed validation');
    const remaining = deadline - now();
    if (remaining <= 0) throw new Error('Required GitHub evidence is still missing or pending');
    progress('WAIT required GitHub evidence is missing or pending');
    await pause(Math.min(15_000, remaining));
  }
}

async function main() {
  const target = parseArgs(process.argv.slice(2));
  const proof = await waitForEvidence(target, process.env.GITHUB_TOKEN, {
    progress: (message) => console.error(message),
  });
  console.log(JSON.stringify(proof));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => {
    console.error(
      'FAIL CD evidence: selected source, required checks or GitHub read access could not be verified',
    );
    process.exitCode = 1;
  });
}
