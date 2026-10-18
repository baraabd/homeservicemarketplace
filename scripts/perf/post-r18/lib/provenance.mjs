// R27 — provenance for every measurement artefact.
//
// A number without the source it measured is not evidence. Each report
// names the commit, whether the worktree differed from it, the toolchain and
// the host, and never includes environment values (which may hold secrets).

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import { resolve } from 'node:path';

export const REPO_ROOT = resolve(import.meta.dirname, '../../../..');

function git(args, { raw = false } = {}) {
  const output = execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' });
  return raw ? output : output.trim();
}

export function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/** Preserve exact filenames and both rename paths from porcelain v1 -z. */
export function dirtyPathsFromPorcelain(status) {
  const records = status.split('\0');
  const paths = [];
  for (let index = 0; index < records.length; index++) {
    const record = records[index];
    if (!record) continue;
    if (record.length < 4 || record[2] !== ' ')
      throw new Error('invalid git porcelain status record');
    paths.push(record.slice(3));
    if (/[RC]/.test(record.slice(0, 2))) {
      const source = records[++index];
      if (!source) throw new Error('missing git rename/copy source path');
      paths.push(source);
    }
  }
  return [...new Set(paths)];
}

/** Source identity: commit, tree, dirty paths (names only) and lockfile hash. */
export function sourceProvenance() {
  const status = git(['status', '--porcelain=v1', '-z'], { raw: true });
  return {
    commit: git(['rev-parse', 'HEAD']),
    tree: git(['rev-parse', 'HEAD^{tree}']),
    branch: git(['rev-parse', '--abbrev-ref', 'HEAD']),
    measurementHarnessCommit: process.env.R27_HARNESS_SHA ?? null,
    dirtyPaths: dirtyPathsFromPorcelain(status),
    lockfileSha256: sha256File(resolve(REPO_ROOT, 'pnpm-lock.yaml')),
  };
}

/** Host description: enough to compare runs, nothing identifying a person. */
export function hostProvenance() {
  const cpus = os.cpus();
  return {
    platform: `${os.platform()} ${os.release()}`,
    arch: os.arch(),
    cpuModel: cpus[0]?.model ?? 'unknown',
    logicalCpus: cpus.length,
    totalMemoryGiB: Math.round((os.totalmem() / 2 ** 30) * 10) / 10,
    freeMemoryGiBAtStart: Math.round((os.freemem() / 2 ** 30) * 10) / 10,
    loadAverage: os.platform() === 'win32' ? null : os.loadavg(),
    node: process.version,
    ci: process.env.GITHUB_ACTIONS === 'true' ? 'github-actions' : 'local',
  };
}
