'use strict';

// Policy tests for the tracked-tree secret scan. They use isolated temporary
// repositories and a stub scanner; the "secret" is an obviously synthetic
// marker, never a credential-shaped value.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { scanTrackedTree, scannedBytes } = require('./secret-scan-tree.cjs');

const MARKER = 'SYNTHETIC_SECRET_MARKER_FOR_TESTS';

// Stub gitleaks: counts bytes under the scanned directory, "finds" the marker.
const STUB = `
const fs = require('node:fs'); const path = require('node:path');
const args = process.argv.slice(2); const dir = args[args.indexOf('dir') + 1];
const mode = process.env.STUB_MODE || 'normal';
if (mode === 'crash') { console.error('stub crash'); process.exit(2); }
let bytes = 0; let found = false;
(function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) {
  const f = path.join(d, e.name);
  if (e.isDirectory()) walk(f); else { const b = fs.readFileSync(f); bytes += b.length; if (b.includes('${MARKER}')) found = true; }
} })(dir);
if (mode === 'silent') { console.error('no leaks found'); process.exit(0); }
console.error('INF scanned ~' + (mode === 'zero' ? 0 : bytes) + ' bytes');
process.exit(found ? 1 : 0);
`;

function tmp(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `sst-${name}-`));
}

function git(repo, ...args) {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
}

function repoWith(files) {
  const repo = tmp('repo');
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'config', 'user.email', 'test@example.invalid');
  git(repo, 'config', 'user.name', 'test');
  git(repo, 'config', 'commit.gpgsign', 'false');
  git(repo, 'config', 'core.autocrlf', 'false');
  for (const [name, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(repo, name)), { recursive: true });
    fs.writeFileSync(path.join(repo, name), content);
  }
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '--allow-empty', '-m', 'base');
  return repo;
}

const stubDir = tmp('stub');
const stub = path.join(stubDir, 'gitleaks-stub.cjs');
fs.writeFileSync(stub, STUB);
const gitleaks = [process.execPath, stub];

function withMode(mode, fn) {
  const previous = process.env.STUB_MODE;
  process.env.STUB_MODE = mode;
  try {
    return fn();
  } finally {
    if (previous === undefined) delete process.env.STUB_MODE;
    else process.env.STUB_MODE = previous;
  }
}

test('scans every tracked file of the commit and reports a non-empty scope', () => {
  const repo = repoWith({ 'a.txt': 'alpha\n', 'dir/b.txt': 'beta\n' });
  const result = scanTrackedTree({ repo, gitleaks, workDir: tmp('work') });
  assert.equal(result.files, 2);
  assert.equal(result.scannedBytes, 11);
  assert.equal(result.commit, git(repo, 'rev-parse', 'HEAD'));
});

test('reads content that only a merge commit introduced', () => {
  const repo = repoWith({ 'a.txt': 'base\n' });
  git(repo, 'checkout', '-q', '-b', 'feature');
  fs.writeFileSync(path.join(repo, 'b.txt'), 'feature\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'feature');
  git(repo, 'checkout', '-q', 'main');
  fs.writeFileSync(path.join(repo, 'c.txt'), 'main\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'main');
  git(repo, 'merge', '-q', '--no-ff', '--no-commit', 'feature');
  fs.writeFileSync(path.join(repo, 'resolution.txt'), `${MARKER}\n`);
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'merge with resolution content');

  // The history range the action uses sees no commit at all.
  const range = git(repo, 'log', '--oneline', '--no-merges', '--first-parent', 'HEAD~1..HEAD');
  assert.equal(range, '');
  assert.throws(
    () => scanTrackedTree({ repo, gitleaks, workDir: tmp('work') }),
    /Secrets found in the tracked tree/,
  );
});

test('refuses a commit that tracks no files', () => {
  const repo = repoWith({});
  assert.throws(() => scanTrackedTree({ repo, gitleaks, workDir: tmp('work') }), /empty scan/);
});

test('refuses when the scanner reports zero or no scanned input', () => {
  const repo = repoWith({ 'a.txt': 'alpha\n' });
  for (const mode of ['zero', 'silent']) {
    assert.throws(
      () => withMode(mode, () => scanTrackedTree({ repo, gitleaks, workDir: tmp('work') })),
      /an empty scan is not a pass/,
    );
  }
});

test('propagates a scanner failure instead of reporting success', () => {
  const repo = repoWith({ 'a.txt': 'alpha\n' });
  assert.throws(
    () => withMode('crash', () => scanTrackedTree({ repo, gitleaks, workDir: tmp('work') })),
    /gitleaks failed \(exit 2\)/,
  );
});

test('refuses a pre-populated work directory and an unknown commit', () => {
  const repo = repoWith({ 'a.txt': 'alpha\n' });
  const work = tmp('work');
  fs.mkdirSync(path.join(work, 'tree'));
  fs.writeFileSync(path.join(work, 'tree', 'stale.txt'), 'stale');
  assert.throws(() => scanTrackedTree({ repo, gitleaks, workDir: work }), /is not empty/);
  assert.throws(
    () => scanTrackedTree({ repo, commit: 'deadbeef', gitleaks, workDir: tmp('work') }),
    /Unknown commit/,
  );
});

test('parses the gitleaks byte counter', () => {
  assert.equal(scannedBytes('INF scanned ~16444417 bytes (16.44 MB) in 20s'), 16444417);
  assert.equal(scannedBytes('INF scanned ~0 bytes (0) in 1ms'), 0);
  assert.equal(scannedBytes('no counter'), null);
});
