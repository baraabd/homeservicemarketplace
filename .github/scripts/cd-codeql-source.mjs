import { REPOSITORY, allPages } from './pr-acceptance.mjs';

const SHA = /^[a-f0-9]{40}$/u;
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const id = (value) => Number.isSafeInteger(value) && value > 0;
const path = '.github/workflows/codeql.yml';

// GitHub publishes its security-result check for PRs, not for every push.
// A merge may reuse that verdict only when GitHub proves its complete tree is
// identical to the reviewed PR head. A changed merge tree never qualifies.
export async function collectEquivalentCodeQL(request, target) {
  const commit = await request(`commits/${target.sha}`);
  if (commit.sha !== target.sha || commit.parents?.length !== 2) return null;
  const parentSha = commit.parents[1]?.sha;
  if (!SHA.test(parentSha ?? '')) return null;
  const candidates = [];
  let complete = false;
  for (let page = 1; page <= 100; page += 1) {
    const rows = await request(`commits/${target.sha}/pulls?per_page=100&page=${page}`);
    if (!Array.isArray(rows) || !rows.every(object))
      throw new Error('Invalid associated PR evidence');
    candidates.push(
      ...rows.filter(
        (pr) =>
          pr.merge_commit_sha === target.sha &&
          pr.head?.sha === parentSha &&
          pr.base?.ref === target.branch,
      ),
    );
    if (rows.length < 100) {
      complete = true;
      break;
    }
  }
  if (!complete) throw new Error('Incomplete associated PR pagination');
  if (candidates.length !== 1 || !id(candidates[0].number)) return null;
  const [parent, pr, runs, checks] = await Promise.all([
    request(`commits/${parentSha}`),
    request(`pulls/${candidates[0].number}`),
    allPages(request, `actions/runs?event=pull_request&head_sha=${parentSha}`, 'workflow_runs'),
    allPages(request, `commits/${parentSha}/check-runs?check_name=CodeQL&filter=all`, 'check_runs'),
  ]);
  if (!runs.every(object)) throw new Error('Invalid PR workflow evidence');
  const matching = runs.filter((entry) => entry.path === path);
  if (matching.some((entry) => !id(entry.id) || !id(entry.run_attempt)))
    throw new Error('Invalid reviewed-source workflow identity');
  const run = matching.sort((a, b) => b.id - a.id || b.run_attempt - a.run_attempt)[0];
  return { commit, parent, pr, run, checks, complete: true };
}

export function equivalentCodeQLProblems(before, after, target, capturedAt) {
  const errors = [];
  const pending = [];
  if (!before || !after)
    return { errors, pending: ['Missing identical-tree PR security evidence'] };
  for (const value of [before, after]) {
    const { commit, parent, pr, run, checks } = value;
    if (value.complete !== true || !Array.isArray(checks) || !checks.every(object)) {
      errors.push('Incomplete identical-tree security evidence');
      continue;
    }
    if (
      commit?.sha !== target.sha ||
      commit?.parents?.length !== 2 ||
      !SHA.test(commit?.commit?.tree?.sha ?? '') ||
      !SHA.test(parent?.sha ?? '') ||
      parent.sha !== commit.parents[1]?.sha ||
      parent.commit?.tree?.sha !== commit.commit.tree.sha
    ) {
      errors.push('Merge tree differs from the reviewed security source');
    }
    if (
      !id(pr?.number) ||
      pr.merged !== true ||
      pr.state !== 'closed' ||
      pr.merge_commit_sha !== target.sha ||
      pr.head?.sha !== parent?.sha ||
      pr.head?.repo?.full_name !== REPOSITORY ||
      pr.base?.repo?.full_name !== REPOSITORY ||
      pr.base?.ref !== target.branch ||
      !(Date.parse(pr.merged_at) <= Date.parse(capturedAt))
    ) {
      errors.push('Unverified merged PR security provenance');
    }
    if (!run) {
      pending.push('Missing reviewed-source CodeQL workflow');
      continue;
    }
    if (
      !id(run.id) ||
      !id(run.run_attempt) ||
      run.path !== path ||
      run.event !== 'pull_request' ||
      run.head_sha !== parent?.sha ||
      run.head_branch !== pr?.head?.ref ||
      run.repository?.full_name !== REPOSITORY ||
      run.head_repository?.full_name !== REPOSITORY ||
      !Array.isArray(run.pull_requests) ||
      (run.pull_requests.length > 0 && !run.pull_requests.some((p) => p?.number === pr?.number))
    ) {
      errors.push('Wrong reviewed-source CodeQL workflow provenance');
    }
    if (
      ['queued', 'in_progress', 'waiting', 'pending', 'requested'].includes(run.status) &&
      run.conclusion === null
    ) {
      pending.push('Pending reviewed-source CodeQL workflow');
    } else if (run.status !== 'completed' || run.conclusion !== 'success') {
      errors.push('Reviewed-source CodeQL workflow is not successful');
    }
  }
  if (
    before.pr?.number !== after.pr?.number ||
    before.parent?.sha !== after.parent?.sha ||
    ['id', 'run_attempt', 'head_sha', 'status', 'conclusion', 'run_started_at'].some(
      (key) => before.run?.[key] !== after.run?.[key],
    )
  ) {
    pending.push('Reviewed-source security evidence changed during collection');
  }
  return { errors, pending };
}
