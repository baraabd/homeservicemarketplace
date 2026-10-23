import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

export const DEPENDENCY_PATHS = ['apps/api/package.json', 'package.json', 'pnpm-lock.yaml'];
const RECORD = 'docs/performance/post-r18/r27-dependency-controls.json';
const SHA = /^(?!0{40}$)[a-f0-9]{40}$/u;
const DIGEST = /^[a-f0-9]{64}$/u;
const digest = (value) => createHash('sha256').update(value).digest('hex');

/** Validate actual Git objects, never branch names or an assertion of comparability. */
export function selectDependencyControls({ root, record, candidate, proposedRepair, baseline }) {
  for (const value of [candidate, proposedRepair, baseline]) assert.match(value ?? '', SHA);
  assert.equal(record?.schemaVersion, 1, 'unsupported dependency-control record');
  for (const value of [record.priorBaseline, record.originalPrBase]) assert.match(value ?? '', SHA);
  const git = (...args) =>
    execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  const bytes = (sha, path) =>
    execFileSync('git', ['show', `${sha}:${path}`], {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  const ancestor = (parent, child) => git('merge-base', '--is-ancestor', parent, child);
  assert.equal(git('rev-parse', 'HEAD'), candidate, 'harness checkout is not the candidate');
  assert.notEqual(proposedRepair, candidate, 'candidate cannot be its own repair baseline');
  ancestor(proposedRepair, candidate);
  assert.deepEqual(
    Object.keys(record.dependencySha256 ?? {}).sort(),
    DEPENDENCY_PATHS,
    'exact dependency digest inventory required',
  );
  for (const path of DEPENDENCY_PATHS) {
    assert.match(record.dependencySha256[path] ?? '', DIGEST);
    assert.equal(
      digest(bytes(candidate, path)),
      record.dependencySha256[path],
      `unregistered candidate dependency change: ${path}`,
    );
  }
  const checkControl = (control, label) => {
    for (const key of ['commit', 'tree', 'parent'])
      assert.match(control?.[key] ?? '', SHA, `${label} ${key} required`);
    assert.notEqual(control.commit, candidate, `${label} must be distinct from candidate`);
    assert.equal(
      git('rev-parse', `${control.commit}^{tree}`),
      control.tree,
      `${label} tree mismatch`,
    );
    assert.equal(
      git('show', '-s', '--format=%P', control.commit),
      control.parent,
      `${label} must have exactly the recorded parent`,
    );
    const changed = git('diff-tree', '--no-commit-id', '--name-only', '-r', control.commit)
      .split('\n')
      .sort();
    // A package update need not modify the root manifest. Every control must
    // contain a real dependency change, and all three resulting blobs still
    // have to match the candidate below. Runtime changes remain forbidden.
    assert.ok(
      changed.length > 0 && changed.every((path) => DEPENDENCY_PATHS.includes(path)),
      `${label} must change only the three dependency files (at least one)`,
    );
    for (const path of DEPENDENCY_PATHS) {
      assert.equal(
        digest(bytes(control.commit, path)),
        record.dependencySha256[path],
        `${label} dependency mismatch: ${path}`,
      );
    }
  };
  checkControl(record.baseline, 'baseline');
  checkControl(record.repair, 'repair');
  assert.equal(
    baseline,
    record.baseline.commit,
    'workflow baseline differs from registered control',
  );
  assert.equal(
    record.baseline.parent,
    record.priorBaseline,
    'baseline must preserve the previous runtime',
  );
  assert.notEqual(record.baseline.commit, record.repair.commit, 'controls must be distinct');
  ancestor(record.originalPrBase, record.repair.parent);

  const matches = DEPENDENCY_PATHS.every(
    (path) => digest(bytes(proposedRepair, path)) === record.dependencySha256[path],
  );
  if (!matches) {
    assert.equal(
      proposedRepair,
      record.originalPrBase,
      'unknown dependency mismatch; prepare new immutable controls',
    );
  }
  const repairBaseline = matches ? proposedRepair : record.repair.commit;
  ancestor(repairBaseline, candidate);
  assert.notEqual(repairBaseline, candidate, 'repair baseline cannot be candidate');
  return {
    schemaVersion: 1,
    kind: 'r27-dependency-control-selection',
    candidate,
    proposedRepair,
    baseline,
    repairBaseline,
    selection: matches ? 'ACTUAL_BASE_MATCHES' : 'EXPLICIT_DEPENDENCY_CONTROL',
    dependencySha256: record.dependencySha256,
    controls: { baseline: record.baseline, repair: record.repair },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const { values } = parseArgs({
      options: {
        candidate: { type: 'string' },
        'repair-base': { type: 'string' },
        baseline: { type: 'string' },
        'github-env': { type: 'string' },
        report: { type: 'string' },
      },
    });
    assert.ok(values['github-env'] && values.report, 'explicit output files required');
    const root = resolve(import.meta.dirname, '../..');
    const tracked = execFileSync('git', ['show', `HEAD:${RECORD}`], {
      cwd: root,
      encoding: 'utf8',
    });
    assert.equal(
      readFileSync(resolve(root, RECORD), 'utf8'),
      tracked,
      'control record has uncommitted changes',
    );
    const result = selectDependencyControls({
      root,
      record: JSON.parse(tracked),
      candidate: values.candidate,
      proposedRepair: values['repair-base'],
      baseline: values.baseline,
    });
    writeFileSync(values.report, `${JSON.stringify(result, null, 2)}\n`);
    appendFileSync(values['github-env'], `R27_REPAIR_BASELINE_SHA=${result.repairBaseline}\n`);
    console.log(`PASS immutable dependency controls (${result.selection})`);
  } catch (error) {
    console.error(`[r27-dependency-controls] ${error.message}`);
    process.exitCode = 1;
  }
}
