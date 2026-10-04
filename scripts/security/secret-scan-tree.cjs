'use strict';

// Secret scan of the EXACT tracked source tree of one commit.
//
// Why this exists: gitleaks-action scans
//   git log -p --no-merges --first-parent <range>
// On develop every first-parent commit is a merge, so a push scans
// "0 commits" and reports success over nothing (develop run 37195248164).
// And on any branch, content introduced only by a merge commit — a conflict
// resolution — is never read by that history scan at all.
//
// This complements the history scan; it does not replace it. The history
// scan still catches a secret that was added and later removed. This one
// proves that what the checked-out commit actually contains was read, and
// fails closed when the scope is empty, partial, or nothing was scanned.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

class SecretScanError extends Error {}

function run(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    ...options,
  });
  if (result.error) throw new SecretScanError(`${cmd} could not start: ${result.error.message}`);
  return result;
}

/** Regular files (not symlinks or submodules) recorded in the commit's tree. */
function trackedFiles(repo, commit) {
  const r = run('git', ['-C', repo, 'ls-tree', '-r', '-z', commit]);
  if (r.status !== 0) throw new SecretScanError(`git ls-tree failed: ${r.stderr.trim()}`);
  return r.stdout
    .split('\0')
    .filter(Boolean)
    .filter((line) => /^100(644|755) blob /.test(line))
    .map((line) => line.slice(line.indexOf('\t') + 1))
    .sort();
}

function walk(dir, base = dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, base, out);
    else if (entry.isFile()) out.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return out;
}

/** "scanned ~16444417 bytes (16.44 MB)" -> 16444417; null when absent. */
function scannedBytes(output) {
  const match = /scanned ~(\d+) bytes/.exec(output);
  return match ? Number(match[1]) : null;
}

/**
 * @param {{repo: string, commit?: string, gitleaks: string[], workDir?: string, report?: string}} opts
 *   `gitleaks` is the command plus any leading arguments.
 */
function scanTrackedTree({ repo, commit = 'HEAD', gitleaks, workDir, report }) {
  if (!Array.isArray(gitleaks) || gitleaks.length === 0) {
    throw new SecretScanError('A gitleaks command is required.');
  }
  const resolved = run('git', ['-C', repo, 'rev-parse', '--verify', `${commit}^{commit}`]);
  if (resolved.status !== 0) throw new SecretScanError(`Unknown commit ${commit}.`);
  const sha = resolved.stdout.trim();

  const expected = trackedFiles(repo, sha);
  if (expected.length === 0)
    throw new SecretScanError(`Commit ${sha} tracks no files: refusing an empty scan.`);

  const root = workDir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'secret-scan-tree-'));
  const tree = path.join(root, 'tree');
  const archive = path.join(root, 'tree.tar');
  fs.mkdirSync(tree, { recursive: true });
  if (fs.readdirSync(tree).length > 0) throw new SecretScanError(`${tree} is not empty.`);

  const archived = run('git', ['-C', repo, 'archive', '--format=tar', '-o', archive, sha]);
  if (archived.status !== 0)
    throw new SecretScanError(`git archive failed: ${archived.stderr.trim()}`);
  // Relative paths: GNU tar on Windows reads 'C:\…' as a remote host.
  const extracted = run('tar', ['-xf', 'tree.tar', '-C', 'tree'], { cwd: root });
  if (extracted.status !== 0) throw new SecretScanError(`tar failed: ${extracted.stderr.trim()}`);
  fs.rmSync(archive);

  const actual = walk(tree).sort();
  const missing = expected.filter((f) => !actual.includes(f));
  const extra = actual.filter((f) => !expected.includes(f));
  if (missing.length || extra.length) {
    throw new SecretScanError(
      `Extracted tree does not match commit ${sha}: ${missing.length} missing, ${extra.length} unexpected (e.g. ${[...missing, ...extra].slice(0, 3).join(', ')}).`,
    );
  }

  const [cmd, ...prefix] = gitleaks;
  const args = [...prefix, 'dir', tree, '--redact', '--verbose', '--exit-code', '1'];
  if (report) args.push('--report-format', 'sarif', '--report-path', report);
  const scan = run(cmd, args);
  const output = `${scan.stdout}\n${scan.stderr}`;
  const bytes = scannedBytes(output);

  if (scan.status === 1)
    throw new SecretScanError(`Secrets found in the tracked tree of ${sha}.\n${output}`);
  if (scan.status !== 0)
    throw new SecretScanError(`gitleaks failed (exit ${scan.status}).\n${output}`);
  if (bytes === null || bytes <= 0) {
    throw new SecretScanError(
      `gitleaks reported no scanned input for ${sha}; an empty scan is not a pass.\n${output}`,
    );
  }
  return { commit: sha, files: expected.length, scannedBytes: bytes, output };
}

function main(argv) {
  const opts = { repo: '.', commit: 'HEAD', gitleaks: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (value === undefined) throw new SecretScanError(`${flag} needs a value.`);
    if (flag === '--gitleaks') opts.gitleaks = [value];
    else if (flag === '--repo') opts.repo = value;
    else if (flag === '--commit') opts.commit = value;
    else if (flag === '--report') opts.report = value;
    else if (flag === '--work-dir') opts.workDir = value;
    else throw new SecretScanError(`Unknown argument ${flag}.`);
    i += 1;
  }
  const result = scanTrackedTree(opts);
  process.stdout.write(result.output);
  console.log(
    `Tracked-tree secret scan: commit ${result.commit}, ${result.files} files, ~${result.scannedBytes} bytes scanned, no leaks.`,
  );
}

if (require.main === module) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof SecretScanError ? error.message : error);
    process.exit(1);
  }
}

module.exports = { SecretScanError, scanTrackedTree, scannedBytes, trackedFiles };
