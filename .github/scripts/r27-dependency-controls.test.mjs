import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { DEPENDENCY_PATHS, selectDependencyControls } from './r27-dependency-controls.mjs';

// Real Git objects make ancestry, changed-path and blob checks meaningful.
const root = mkdtempSync(join(tmpdir(), 'r27-controls-'));
after(() => rmSync(root, { recursive: true, force: true }));
const git = (...args) =>
  execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
const write = (path, text) => {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
};
const commit = (message) => {
  git('add', '.');
  git('commit', '-m', message);
  return git('rev-parse', 'HEAD');
};
const control = (sha) => ({
  commit: sha,
  tree: git('rev-parse', `${sha}^{tree}`),
  parent: git('show', '-s', '--format=%P', sha),
});
const newDependencies = () => DEPENDENCY_PATHS.forEach((path) => write(path, `patched:${path}\n`));
git('init', '--quiet');
git('config', 'user.name', 'R27 test fixture');
git('config', 'user.email', 'r27-test@example.invalid');
DEPENDENCY_PATHS.forEach((path) => write(path, `old:${path}\n`));
write('runtime.txt', 'original runtime\n');
const original = commit('original runtime');
git('switch', '-c', 'baseline');
newDependencies();
const baseline = control(commit('dependency-only baseline'));
git('switch', '-c', 'repair', original);
write('helper.txt', 'test-helper correction\n');
const repairParent = commit('repair parent');
newDependencies();
const repair = control(commit('dependency-only repair control'));
write('harness.txt', 'new comparison harness\n');
const candidate = commit('candidate');
git('switch', '-c', 'invalid-runtime-control', original);
newDependencies();
write('runtime.txt', 'an application optimization must not enter a dependency control\n');
const changedRuntime = control(commit('not a dependency-only control'));
git('switch', '-c', 'unrelated-repair', original);
write('unrelated.txt', 'different branch\n');
commit('unrelated parent');
newDependencies();
const unrelatedRepair = control(commit('unrelated dependency control'));
git('switch', '-c', 'partial-baseline', repair.commit);
write('apps/api/package.json', 'next API dependency\n');
const partialBaseline = control(commit('one dependency file changes'));
git('switch', '-c', 'partial-repair', candidate);
write('apps/api/package.json', 'next API dependency\n');
const partialRepair = control(commit('same one-file dependency repair'));
write('next-harness.txt', 'successor experiment\n');
const partialCandidate = commit('successor candidate');
git('switch', '-c', 'empty-control', repair.commit);
git('commit', '--allow-empty', '-m', 'empty is not a dependency control');
const emptyControl = control(git('rev-parse', 'HEAD'));
git('switch', 'repair');

const record = {
  schemaVersion: 1,
  priorBaseline: original,
  originalPrBase: original,
  dependencySha256: Object.fromEntries(
    DEPENDENCY_PATHS.map((path) => [
      path,
      createHash('sha256').update(`patched:${path}\n`).digest('hex'),
    ]),
  ),
  baseline,
  repair,
};
const input = () => ({
  root,
  record: structuredClone(record),
  candidate,
  proposedRepair: original,
  baseline: baseline.commit,
});

test('selects the explicit ancestor control for the known old-dependency base', () => {
  const result = selectDependencyControls(input());
  assert.equal(result.selection, 'EXPLICIT_DEPENDENCY_CONTROL');
  assert.equal(result.repairBaseline, repair.commit);
  assert.equal(result.baseline, baseline.commit);
});

test('future dependency-matched PRs use their actual base', () => {
  const result = selectDependencyControls({ ...input(), proposedRepair: repair.commit });
  assert.equal(result.selection, 'ACTUAL_BASE_MATCHES');
  assert.equal(result.repairBaseline, repair.commit);
});

test('a matching actual base does not depend on ancestry of an unused historical repair control', () => {
  const value = { ...input(), proposedRepair: repair.commit };
  value.record.repair = unrelatedRepair;
  const result = selectDependencyControls(value);
  assert.equal(result.selection, 'ACTUAL_BASE_MATCHES');
  assert.equal(result.repairBaseline, repair.commit);
});

test('accepts a dependency-only subset while verifying all unchanged dependency blobs', () => {
  git('switch', 'partial-repair');
  try {
    const next = structuredClone(record);
    next.priorBaseline = repair.commit;
    next.originalPrBase = candidate;
    next.baseline = partialBaseline;
    next.repair = partialRepair;
    next.dependencySha256['apps/api/package.json'] = createHash('sha256')
      .update('next API dependency\n')
      .digest('hex');
    const value = {
      root,
      record: next,
      candidate: partialCandidate,
      proposedRepair: candidate,
      baseline: partialBaseline.commit,
    };
    assert.equal(selectDependencyControls(value).repairBaseline, partialRepair.commit);
    next.dependencySha256['package.json'] = 'e'.repeat(64);
    assert.throws(() => selectDependencyControls(value), /unregistered candidate dependency/u);
  } finally {
    git('switch', 'repair');
  }
});

for (const [name, mutate, expected] of [
  [
    'empty dependency control',
    (v) => {
      v.record.baseline = emptyControl;
      v.baseline = emptyControl.commit;
    },
    /only the three dependency files/u,
  ],
  [
    'unknown old-dependency base',
    (v) => {
      v.proposedRepair = repairParent;
    },
    /unknown dependency mismatch/u,
  ],
  [
    'candidate as its own repair base',
    (v) => {
      v.proposedRepair = candidate;
    },
    /own repair baseline/u,
  ],
  [
    'unregistered new dependency digest',
    (v) => {
      v.record.dependencySha256['pnpm-lock.yaml'] = 'a'.repeat(64);
    },
    /unregistered candidate dependency/u,
  ],
  [
    'missing dependency digest',
    (v) => {
      delete v.record.dependencySha256['package.json'];
    },
    /digest inventory/u,
  ],
  [
    'extra dependency path',
    (v) => {
      v.record.dependencySha256['runtime.txt'] = 'a'.repeat(64);
    },
    /digest inventory/u,
  ],
  [
    'wrong control tree',
    (v) => {
      v.record.baseline.tree = 'b'.repeat(40);
    },
    /tree mismatch/u,
  ],
  [
    'wrong control parent',
    (v) => {
      v.record.repair.parent = original;
    },
    /recorded parent/u,
  ],
  [
    'runtime drift hidden in a control',
    (v) => {
      v.record.baseline = changedRuntime;
      v.baseline = changedRuntime.commit;
    },
    /only the three dependency files/u,
  ],
  [
    'unrelated repair control',
    (v) => {
      v.record.repair = unrelatedRepair;
    },
    /Command failed/u,
  ],
  [
    'wrong workflow baseline',
    (v) => {
      v.baseline = repair.commit;
    },
    /workflow baseline/u,
  ],
  [
    'wrong historical baseline',
    (v) => {
      v.record.priorBaseline = repairParent;
    },
    /previous runtime/u,
  ],
  [
    'moving ref instead of immutable SHA',
    (v) => {
      v.proposedRepair = 'develop';
    },
    /match/u,
  ],
  [
    'zero SHA',
    (v) => {
      v.baseline = '0'.repeat(40);
    },
    /match/u,
  ],
  [
    'wrong harness checkout',
    (v) => {
      v.candidate = repair.commit;
    },
    /harness checkout/u,
  ],
]) {
  test(`refuses ${name}`, () => {
    const value = input();
    mutate(value);
    assert.throws(() => selectDependencyControls(value), expected);
  });
}
