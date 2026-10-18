// Validates docs/production-readiness/post-r18/SPRINT_REGISTRY.json, the one
// machine-readable registry for the post-R18 sequence R19-R38, and the active
// status index that must name every sprint with the same title.
//
// This proves the registry is internally consistent and that ownership is
// single-writer per wave. It does not prove any sprint's work or acceptance.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { waveGateProblems } from './wave-gate.mjs';

export const REGISTRY = 'docs/production-readiness/post-r18/SPRINT_REGISTRY.json';
export const STATUS_INDEX = 'docs/production-readiness/post-r18/ACTIVE_STATUS.md';
export const FIRST = 19;
export const LAST = 38;
export const LANES_PER_WAVE = 5;

export const STATUSES = new Set([
  'RESERVED_PENDING_PACKAGE',
  'PLANNED',
  'READY_TO_START',
  'IN_PROGRESS',
  'IMPLEMENTED',
  'SOURCE_VERIFIED',
  'INTEGRATION_PENDING',
  'SANDBOX_ACCEPTED',
  'HOSTED_ACCEPTED',
  'POLICY_BLOCKED',
  'EXTERNAL_BLOCKED',
  'RELEASE_ACCEPTED',
]);

// Global glue only the coordinator writes. A sprint reaches one of these only
// through an explicit lease recorded in its ownedPaths.leases.
export const COORDINATOR_OWNED = [
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  '.npmrc',
  '.nvmrc',
  'packages/database/prisma/',
  'packages/contracts/src/index.ts',
  'apps/api/src/app.module.ts',
  'apps/api/src/main.ts',
  'apps/api/src/config/',
  'apps/web/src/app/routes.ts',
  'apps/web/src/app/Root.tsx',
  '.github/',
  'infra/',
  'apps/api/Dockerfile',
  'apps/web/Dockerfile',
  'docs/production-readiness/post-r18/',
];

const SHA = /^[0-9a-f]{40}$/u;

function overlaps(a, b) {
  return (
    a === b ||
    a.startsWith(b.endsWith('/') ? b : `${b}/`) ||
    b.startsWith(a.endsWith('/') ? a : `${a}/`) ||
    (a.endsWith('-') && b.startsWith(a)) ||
    (b.endsWith('-') && a.startsWith(b))
  );
}

function owned(sprint) {
  const paths = sprint.ownedPaths;
  if (!paths) return [];
  return [...(paths.exact ?? []), ...(paths.prefixes ?? [])];
}

export function registryProblems(registry, statusIndex = null) {
  const problems = [];
  if (registry?.schemaVersion !== 1) problems.push('schemaVersion must be 1');
  const sprints = Array.isArray(registry?.sprints) ? registry.sprints : [];
  const expected = LAST - FIRST + 1;
  if (sprints.length !== expected)
    problems.push(`expected ${expected} sprints, found ${sprints.length}`);
  const seen = new Set();
  sprints.forEach((sprint, index) => {
    const number = FIRST + index;
    const id = `R${number}`;
    if (sprint.id !== id) problems.push(`position ${index} must be ${id}, found ${sprint.id}`);
    if (seen.has(sprint.id)) problems.push(`duplicate id ${sprint.id}`);
    seen.add(sprint.id);
    const wave = Math.floor((number - FIRST) / LANES_PER_WAVE) + 1;
    const lane = ((number - FIRST) % LANES_PER_WAVE) + 1;
    if (sprint.wave !== wave || sprint.lane !== lane)
      problems.push(`${id} must be wave ${wave} lane ${lane}`);
    if (!STATUSES.has(sprint.status)) problems.push(`${id} has unknown status ${sprint.status}`);
    const reserved = sprint.status === 'RESERVED_PENDING_PACKAGE';
    if (reserved) {
      if (sprint.title !== null)
        problems.push(`${id} is reserved and must not carry an invented title`);
      if (sprint.ownedPaths !== null || sprint.branch !== null) {
        problems.push(`${id} is reserved and cannot own paths or a branch yet`);
      }
    } else {
      if (typeof sprint.title !== 'string' || !sprint.title.trim())
        problems.push(`${id} needs a title`);
      if (typeof sprint.branch !== 'string' || !sprint.branch.trim())
        problems.push(`${id} needs a branch`);
      if (!sprint.owner) problems.push(`${id} needs an owner`);
      // A known lane may be planned while its start gate is explicitly blocked.
      // It owns no executable baseline until the separate gate is accepted.
      const startGate = { 2: 'G1', 3: 'G2' }[sprint.wave];
      const awaitingGate =
        sprint.status === 'PLANNED' &&
        sprint.frozenBase === null &&
        startGate &&
        sprint.startBarrier?.gate === startGate &&
        sprint.startBarrier?.decision === 'BLOCKED' &&
        registry.gates?.[startGate] &&
        registry.waveManifests?.[String(sprint.wave)];
      if (!awaitingGate && !SHA.test(sprint.frozenBase ?? ''))
        problems.push(`${id} needs a full frozen base SHA`);
      if (!Array.isArray(sprint.requiredEvidence) || !sprint.requiredEvidence.length) {
        problems.push(`${id} needs required evidence`);
      }
      if (!owned(sprint).length) problems.push(`${id} needs owned paths`);
    }
    for (const dependency of sprint.dependencies ?? []) {
      const other = sprints.find((s) => s.id === dependency);
      if (!other) problems.push(`${id} depends on unknown ${dependency}`);
      else if (other.wave >= sprint.wave)
        problems.push(`${id} may depend only on earlier waves, not ${dependency}`);
    }
    for (const entry of owned(sprint)) {
      if (entry.includes('..') || path.isAbsolute(entry))
        problems.push(`${id} has an unsafe path ${entry}`);
      const glue = COORDINATOR_OWNED.find((shared) => overlaps(entry, shared));
      if (glue) problems.push(`${id} claims coordinator-owned ${entry} outside a lease`);
    }
    for (const lease of sprint.ownedPaths?.leases ?? []) {
      for (const entry of lease.paths ?? []) {
        if (entry.includes('..') || path.isAbsolute(entry))
          problems.push(`${id} has an unsafe lease path ${entry}`);
      }
      if (
        !lease.grantedBy ||
        !lease.expires ||
        !Array.isArray(lease.paths) ||
        !lease.paths.length
      ) {
        problems.push(`${id} has an incomplete lease`);
      }
    }
  });

  // One writer per path per wave, and one schema lease per wave.
  for (const a of sprints) {
    for (const b of sprints) {
      if (a.id >= b.id || a.wave !== b.wave) continue;
      const allOwned = (s) => [
        ...owned(s),
        ...(s.ownedPaths?.leases ?? []).flatMap((l) => l.paths ?? []),
      ];
      for (const pa of allOwned(a)) {
        for (const pb of allOwned(b)) {
          if (overlaps(pa, pb))
            problems.push(`${a.id} and ${b.id} both own ${pa} / ${pb} in wave ${a.wave}`);
        }
      }
      const schema = (s) =>
        (s.ownedPaths?.leases ?? []).some((l) =>
          l.paths.some((p) => p.startsWith('packages/database/prisma/')),
        );
      if (schema(a) && schema(b))
        problems.push(`${a.id} and ${b.id} both hold a schema lease in wave ${a.wave}`);
    }
  }
  const bases = new Map();
  for (const sprint of sprints) {
    if (!sprint.frozenBase) continue;
    const known = bases.get(sprint.wave);
    if (known && known !== sprint.frozenBase)
      problems.push(`wave ${sprint.wave} has more than one frozen base`);
    bases.set(sprint.wave, sprint.frozenBase);
  }

  if (statusIndex !== null) {
    for (const sprint of sprints) {
      const row = statusIndex.split(/\r?\n/u).find((line) => line.startsWith(`| ${sprint.id} `));
      if (!row) {
        problems.push(`${STATUS_INDEX} has no row for ${sprint.id}`);
        continue;
      }
      const cells = row.split('|').map((cell) => cell.trim());
      const title = sprint.title ?? '(pending package)';
      if (cells[2] !== title)
        problems.push(`${STATUS_INDEX} names ${sprint.id} differently from the registry`);
      if (cells[4] !== sprint.status)
        problems.push(`${STATUS_INDEX} shows a different status for ${sprint.id}`);
    }
  }
  return problems;
}

export async function verifyRegistry(root) {
  const registry = JSON.parse(await readFile(path.join(root, REGISTRY), 'utf8'));
  const index = await readFile(path.join(root, STATUS_INDEX), 'utf8');
  const problems = registryProblems(registry, index);
  let g1;
  if (registry.gates?.G1 || registry.waveManifests?.['2']) {
    const expectedGate = 'docs/production-readiness/post-r18/gates/g1/SOURCE_MANIFEST.json';
    const expectedWave = 'docs/production-readiness/post-r18/waves/wave-02.plan.json';
    if (registry.gates?.G1 !== expectedGate || registry.waveManifests?.['2'] !== expectedWave)
      return [...problems, 'G1 records must use the canonical paths'];
    const gate = JSON.parse(await readFile(path.join(root, expectedGate), 'utf8'));
    const wave = JSON.parse(await readFile(path.join(root, expectedWave), 'utf8'));
    problems.push(...waveGateProblems(gate, wave, registry));
    g1 = gate;
  }
  // G2 is separately validated; adding records cannot silently bypass the G1
  // contract or grant a future lane a base before its published start gate.
  if (
    registry.gates?.G2 ||
    registry.waveManifests?.['3'] ||
    registry.sprints?.some(
      (sprint) => sprint.wave === 3 && sprint.status !== 'RESERVED_PENDING_PACKAGE',
    )
  ) {
    const expectedGate = 'docs/production-readiness/post-r18/gates/g2/SOURCE_MANIFEST.json';
    const expectedWave = 'docs/production-readiness/post-r18/waves/wave-03.plan.json';
    if (registry.gates?.G2 !== expectedGate || registry.waveManifests?.['3'] !== expectedWave)
      return [...problems, 'G2 records must use the canonical paths'];
    const gate = JSON.parse(await readFile(path.join(root, expectedGate), 'utf8'));
    const wave = JSON.parse(await readFile(path.join(root, expectedWave), 'utf8'));
    problems.push(...waveGateProblems(gate, wave, registry));
    if (
      gate.decision === 'ACCEPTED' &&
      (g1?.decision !== 'ACCEPTED' ||
        g1.publication?.state !== 'MERGED' ||
        !SHA.test(g1.publication?.acceptanceRecordCommitSha ?? ''))
    )
      problems.push('G2 acceptance requires the verified merged G1 prerequisite');
  }
  return problems;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const problems = await verifyRegistry(root);
  for (const problem of problems) console.error(`FAIL ${problem}`);
  if (problems.length) process.exitCode = 1;
  else console.log('PASS post-R18 sprint registry; this is not sprint acceptance');
}
