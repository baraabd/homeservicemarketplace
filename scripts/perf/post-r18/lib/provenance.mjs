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

function git(args) {
  return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
}

export function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/** Source identity: commit, tree, dirty paths (names only) and lockfile hash. */
export function sourceProvenance() {
  const status = git(['status', '--porcelain']);
  return {
    commit: git(['rev-parse', 'HEAD']),
    tree: git(['rev-parse', 'HEAD^{tree}']),
    branch: git(['rev-parse', '--abbrev-ref', 'HEAD']),
    dirtyPaths: status ? status.split('\n').map((line) => line.slice(3)) : [],
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
