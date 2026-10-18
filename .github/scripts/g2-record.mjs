import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPOSITORY = 'baraabd/homeservicemarketplace';
const BASE = 'docs/production-readiness/post-r18/';
const GATE = `${BASE}gates/g2/`;
const SHA = /^(?!0{40}$)[a-f0-9]{40}$/u;
const DIGEST = /^[a-f0-9]{64}$/u;
const REQUIREMENTS = ['G2-01', 'G2-02', 'G2-03', 'G2-04', 'G2-05'];
const CHECKS = [
  'R25 real replicas and recovery',
  'R18 functional completion acceptance',
  'CI gate',
  'Analyze JavaScript/TypeScript',
  'Production governance',
];
const PORTS = ['activation', 'collection', 'finance-read', 'refund'].map(
  (name) => `apps/api/src/modules/money/ports/${name}.port.ts`,
);
const R29_ROOTS = [
  'apps/api/src/modules/money/adapters/stripe/',
  'apps/api/src/modules/money/webhooks/stripe/',
  'scripts/production/stripe-sandbox/',
  'docs/production-readiness/r29/',
];
const SHARED = [
  '.github/', 'infra/', 'packages/database/', 'packages/contracts/src/index.ts',
  'apps/api/src/main.ts', 'apps/api/src/app.module.ts', 'apps/api/src/config/',
  'apps/web/src/app/routes', 'apps/web/src/app/Root',
  'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml',
  'docs/production-readiness/post-r18/',
];
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const fullSha = (value) => typeof value === 'string' && SHA.test(value);
const safePath = (value) =>
  typeof value === 'string' &&
  /^[A-Za-z0-9_./-]+$/u.test(value) &&
  value.split('/').every((part) => part && part !== '.' && part !== '..');

/** Structural validation only. Remote evidence and owner authority must be verified separately. */
export function recordProblems(bundle) {
  if (!object(bundle)) return ['Missing G2 record bundle'];
  const { gate, closeout, wave, r25, registry } = bundle;
  if (![gate, closeout, wave, r25, registry].every(object)) return ['Missing G2 input object'];
  const errors = [];
  const require = (condition, message) => { if (!condition) errors.push(message); };
  require(gate.schemaVersion === 1 && gate.repository === REPOSITORY && gate.gate === 'G2',
    'Invalid G2 record identity');
  require(gate.wave === 2 && gate.nextWave === 3, 'Invalid wave transition');
  require(['BLOCKED', 'ACCEPTED'].includes(gate.decision), 'Unknown G2 decision');
  require(Array.isArray(registry.sprints), 'Canonical sprint array required');
  if (!Array.isArray(registry.sprints)) return errors;
  require(gate.coordinator?.branch === 'coord/g2-wave2-closeout' &&
    fullSha(gate.coordinator?.ownershipCheckpointSha), 'Coordinator ownership checkpoint required');
  require(gate.sourceArtifact?.treeRecomputed === true &&
    Number.isSafeInteger(gate.sourceArtifact?.trackedBlobsVerified) &&
    gate.sourceArtifact.trackedBlobsVerified > 0 &&
    DIGEST.test(gate.sourceArtifact?.zipSha256 ?? ''), 'Verified source artifact identity required');
  const source = gate.candidate?.sourceSha;
  const tree = gate.candidate?.treeSha;
  require(fullSha(source) && fullSha(tree) && source !== tree, 'Full distinct candidate SHAs required');
  require(closeout.schemaVersion === 1 && closeout.wave === 2, 'Invalid closeout identity');
  require(closeout.sourceSha === source && closeout.treeSha === tree, 'Closeout source mismatch');
  require(closeout.decision === gate.decision, 'Closeout decision mismatch');
  require(wave.schemaVersion === 1 && wave.wave === 3 && wave.gate === 'G2', 'Invalid Wave 3 identity');
  require(r25.headSha === source && r25.treeSha === tree, 'R25 evidence source mismatch');
  require(r25.zipDigestVerified === true && DIGEST.test(r25.zipSha256 ?? ''),
    'R25 artifact digest verification missing');
  require(Number.isSafeInteger(r25.runId) && r25.runId > 0 &&
    Number.isSafeInteger(r25.artifactId) && r25.artifactId > 0, 'R25 artifact identity missing');

  const lanes = Array.isArray(closeout.lanes) ? closeout.lanes : [];
  require(same(lanes.map((lane) => lane?.id), ['R24', 'R25', 'R26', 'R27', 'R28']),
    'Exactly R24-R28 closeout rows required');
  for (const lane of lanes) {
    const registered = registry.sprints?.find((entry) => entry.id === lane?.id);
    require(registered?.branch === lane?.branch && registered?.wave === 2,
      'Closeout branch must match canonical registry');
    require(registered?.frozenBase === closeout.historicalG1BaseSha &&
      fullSha(closeout.historicalG1BaseSha), 'Historical G1 base must remain unchanged');
    require(typeof lane?.merged === 'boolean', 'Explicit merge state required');
    require(['PASS', 'PENDING', 'FAIL', 'NOT_IMPLEMENTED'].includes(lane?.integration),
      'Unknown lane integration state');
    if (lane?.merged === true) {
      require(Number.isSafeInteger(lane.pr) && lane.pr > 0 &&
        fullSha(lane.sourceHeadSha) && fullSha(lane.mergeCommitSha), 'Merged lane identity incomplete');
      require(lane.prUrl === `https://github.com/${REPOSITORY}/pull/${lane.pr}`,
        'Merged lane PR URL mismatch');
    } else {
      require(lane?.mergeCommitSha === null, 'Unmerged lane cannot claim merge SHA');
    }
  }

  const commands = Array.isArray(r25.commands) ? r25.commands : [];
  const browserCommand = commands.find((command) => command?.label === 'browser');
  require(browserCommand?.exitCode === r25.browser?.exitCode &&
    browserCommand?.timedOut === r25.browser?.timedOut &&
    browserCommand?.signal === r25.browser?.signal, 'Browser observation must match executed command');
  if (r25.browser?.exitCode !== 0) require(lanes.find((lane) => lane?.id === 'R25')?.integration === 'FAIL',
    'Failed R25 browser cannot be represented as an integration pass');

  const requirements = Array.isArray(gate.mandatoryRequirements) ? gate.mandatoryRequirements : [];
  require(same(requirements.map((entry) => entry?.id), REQUIREMENTS),
    'Mandatory G2 requirements cannot be removed or reordered');
  for (const entry of requirements) {
    require(['PASS', 'BLOCKED', 'PENDING', 'FAIL'].includes(entry?.status) &&
      typeof entry?.owner === 'string' && entry.owner.length > 0, 'Invalid requirement disposition');
  }
  const checks = Array.isArray(gate.checks?.observed) ? gate.checks.observed : [];
  require(checks.length > 0, 'Empty check evidence is not success');
  const names = new Set();
  for (const check of checks) {
    require(!names.has(check?.name), 'Duplicate named check observation');
    names.add(check?.name);
    require(check?.headSha === source, 'Check evidence source mismatch');
    require(Number.isSafeInteger(check?.id) && check.id > 0, 'Check identity missing');
    require(['completed', 'queued', 'in_progress'].includes(check?.status), 'Unknown check status');
    require(['success', 'failure', 'cancelled', 'skipped', 'timed_out', null].includes(check?.conclusion),
      'Unknown check conclusion');
  }
  const contracts = gate.contracts;
  require(contracts?.sourceSha === source && contracts?.version === 'hsm.money.v1',
    'Contract source/version mismatch');
  require(same(Object.keys(contracts?.sha256 ?? {}).sort(), [...PORTS].sort()) &&
    Object.values(contracts?.sha256 ?? {}).every((value) => DIGEST.test(value)),
    'Exact four inspected port digests required');
  require(['liveMoney', 'deploy', 'merge', 'accountGrants', 'spend'].every(
    (key) => gate.restrictions?.[key] === false), 'Coordination grants no operational authority');
  require(gate.restrictions?.preserveG1 === true && gate.restrictions?.preserveR16R18Holds === true,
    'Existing gate and policy holds must be preserved');

  const publication = gate.publication;
  require(['DRAFT', 'MERGED'].includes(publication?.state), 'Unknown publication state');
  if (gate.decision === 'BLOCKED') {
    require(gate.frozenBaseSha === null && gate.frozenTreeSha === null &&
      wave.frozenBaseSha === null && wave.frozenTreeSha === null, 'Blocked gate cannot freeze a base');
    require(wave.status === 'BLOCKED', 'Blocked gate cannot release Wave 3');
    require(publication?.state === 'DRAFT' && publication?.verifiedMerge === false &&
      publication?.acceptanceRecordCommitSha === null, 'Blocked report is not acceptance publication');
  } else if (gate.decision === 'ACCEPTED') {
    require(gate.frozenBaseSha === source && gate.frozenTreeSha === tree &&
      wave.frozenBaseSha === source && wave.frozenTreeSha === tree, 'Accepted freeze must bind candidate');
    require(lanes.length === 5 && lanes.every((lane) => lane.merged && lane.integration === 'PASS'),
      'Acceptance requires all five merged and verified lanes');
    require(requirements.length === REQUIREMENTS.length && requirements.every((entry) =>
      entry.status === 'PASS' && entry.sourceSha === source &&
      Array.isArray(entry.evidenceUrls) && entry.evidenceUrls.length > 0),
    'Acceptance requires source-bound evidence for every requirement');
    require(gate.checks?.completeInventoryVerified === true &&
      CHECKS.every((name) => names.has(name)) &&
      checks.every((check) => check.status === 'completed' && check.conclusion === 'success'),
    'Acceptance requires complete successful exact-source checks');
    const official = gate.checks?.officialCodeQL;
    require(official?.headSha === source && official?.appSlug === 'github-advanced-security' &&
      official?.conclusion === 'success' && official?.annotationsCount === 0 &&
      Number.isSafeInteger(official?.id) && official.id > 0, 'Official CodeQL evidence required');
    require(r25.status === 'SANDBOX_ACCEPTED' && r25.api?.success === true &&
      r25.api.passed > 0 && r25.api.failed === 0 && r25.api.skipped === 0 &&
      r25.browser?.exitCode === 0 && r25.browser.passed > 0 &&
      r25.browser.failed === 0 && r25.browser.skipped === 0 && r25.browser.timedOut === false,
    'R25 browser failure or unknown counts cannot be accepted');
    require(commands.length > 0 && commands.every((command) => command.exitCode === 0 &&
      command.signal === null && command.timedOut === false), 'Every required R25 command must succeed');
  }
  if (publication?.state === 'DRAFT') require(publication.verifiedMerge === false &&
    publication.acceptanceRecordCommitSha === null, 'Draft publication cannot claim a verified merge');
  const published = gate.decision === 'ACCEPTED' && publication?.state === 'MERGED';
  if (publication?.state === 'MERGED') {
    require(published && publication.verifiedMerge === true &&
      fullSha(publication.acceptanceRecordCommitSha) &&
      publication.acceptanceRecordCommitSha !== source, 'Verified separate acceptance publication required');
  }
  require(wave.status === (published ? 'READY_TO_START' : 'BLOCKED'), 'Wave/publication state mismatch');

  const next = Array.isArray(wave.lanes) ? wave.lanes : [];
  require(same(next.map((lane) => lane?.id), ['R29', 'R30', 'R31', 'R32', 'R33']),
    'Exactly R29-R33 ownership slots required');
  const writers = new Set();
  const branches = new Set();
  for (const lane of next) {
    require(Array.isArray(lane?.exact) && Array.isArray(lane?.leases) && lane.leases.length === 0,
      'No shared-file lease is granted by this plan');
    if (lane?.status === 'RESERVED_PENDING_PACKAGE') {
      require(lane.title === null && lane.branch === null && lane.owner === null &&
        lane.dependencies === null && lane.exact?.length === 0, 'Missing packages cannot invent ownership');
      continue;
    }
    require(!branches.has(lane?.branch), 'Assigned branches must be distinct');
    branches.add(lane?.branch);
    if (lane?.id !== 'R29') {
      const entry = registry.sprints.find((item) => item.id === lane?.id);
      require(entry?.status !== 'RESERVED_PENDING_PACKAGE' && entry?.title === lane?.title &&
        entry?.branch === lane?.branch, 'Unregistered peer package cannot be assigned');
    }
    require(['CONDITIONAL_G2', 'READY_TO_START'].includes(lane?.status), 'Unknown lane start state');
    require(typeof lane?.title === 'string' && lane.title.length > 0 &&
      typeof lane?.owner === 'string' && lane.owner.length > 0 &&
      typeof lane?.branch === 'string' && lane.branch.startsWith('feat/'), 'Lane package incomplete');
    require(Array.isArray(lane?.dependencies) && lane.dependencies.every((id) => {
      const prior = registry.sprints?.find((entry) => entry.id === id);
      return prior && prior.wave < 3;
    }), 'Only earlier-wave dependencies are permitted');
    require(lane.exact?.length > 0, 'Exact lane ownership required');
    for (const file of lane.exact ?? []) {
      require(safePath(file), 'Unsafe or non-exact owned path');
      require(typeof file === 'string' && !SHARED.some((prefix) => file.startsWith(prefix)),
        'Global shared path requires a separate lease');
      require(!writers.has(file), 'Two writers or duplicate ownership');
      writers.add(file);
      if (lane.id === 'R29') require(R29_ROOTS.some((root) => file.startsWith(root)),
        'R29 path outside supplied ownership roots');
    }
    if (lane?.status === 'READY_TO_START') {
      const registered = registry.sprints?.find((entry) => entry.id === lane.id);
      require(published && wave.registryTransition === 'SYNCHRONIZED' && registered?.status === 'READY_TO_START' &&
        registered?.branch === lane.branch && registered?.frozenBase === source &&
        same(registered?.ownedPaths?.exact, lane.exact), 'Start requires synchronized canonical registry');
    }
  }
  return errors;
}

export function readinessProblems(bundle, laneId = 'R29') {
  const errors = recordProblems(bundle);
  const lane = bundle?.wave?.lanes?.find((entry) => entry.id === laneId);
  if (bundle?.gate?.decision !== 'ACCEPTED' || bundle?.wave?.status !== 'READY_TO_START' ||
    lane?.status !== 'READY_TO_START') errors.push(`${laneId} is not authorized to start`);
  return errors;
}

export async function readBundle(root = fileURLToPath(new URL('../../', import.meta.url))) {
  const files = {
    gate: `${GATE}SOURCE_MANIFEST.json`,
    closeout: `${BASE}waves/wave-02.closeout.json`,
    wave: `${BASE}waves/wave-03.plan.json`,
    r25: `${GATE}evidence/r25-summary.json`,
    registry: `${BASE}SPRINT_REGISTRY.json`,
  };
  return Object.fromEntries(await Promise.all(Object.entries(files).map(async ([key, file]) =>
    [key, JSON.parse(await readFile(path.join(root, file), 'utf8'))])));
}

async function main() {
  const [command = '--check', lane = 'R29', ...extra] = process.argv.slice(2);
  if (!['--check', '--ready'].includes(command) || !/^R(?:29|3[0-3])$/u.test(lane) || extra.length) {
    throw new Error('Invalid arguments');
  }
  const bundle = await readBundle();
  const errors = command === '--ready' ? readinessProblems(bundle, lane) : recordProblems(bundle);
  if (errors.length) {
    for (const error of errors) console.error(`FAIL ${error}`);
    process.exitCode = 1;
  } else {
    console.log('PASS G2 record consistency; this does not authenticate remote evidence or grant approval.');
    console.log(`Recorded G2: ${bundle.gate.decision}; Wave 3: ${bundle.wave.status}`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch(() => { console.error('FAIL unreadable or invalid G2 inputs'); process.exitCode = 1; });
}
