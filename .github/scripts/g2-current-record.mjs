// The active coordinator schema uses gateId/candidateSourceSha/exactFiles.
// Reuse the canonical wave/registry authority. The earlier gate/candidate/exact
// closeout is retained separately; historical results never replace active input.
import { registryProblems } from './sprint-registry.mjs';
import { G2_REQUIRED_EVIDENCE, waveGateProblems } from './wave-gate.mjs';

const BASE = 'docs/production-readiness/post-r18/';
const SHA = /^(?!0{40}$)[a-f0-9]{40}$/u;
const DIGEST = /^[a-f0-9]{64}$/u;
const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const list = (v) => (Array.isArray(v) ? v : []);
const text = (v) => typeof v === 'string' && v.trim().length > 0;
const fullSha = (v) => typeof v === 'string' && SHA.test(v);
const REQUIRED_CHECKS = [
  'R25 real replicas and recovery',
  'R18 functional completion acceptance',
  'CI gate',
  'Analyze JavaScript/TypeScript',
  'Production governance',
  'R27 comparable measurements and unchanged budgets',
];
const PORTS = ['activation', 'collection', 'finance-read', 'refund'].map(
  (name) => `apps/api/src/modules/money/ports/${name}.port.ts`,
);

export function canonicalG2Problems(bundle) {
  if (
    !object(bundle) ||
    !['gate', 'wave', 'registry', 'g1', 'wave2'].every((key) => object(bundle[key]))
  )
    return ['Missing active G2 input object'];
  const { gate, wave, registry, g1, wave2 } = bundle;
  const errors = [];
  const require = (condition, message) => {
    if (!condition) errors.push(message);
  };
  try {
    errors.push(
      ...registryProblems(registry),
      ...waveGateProblems(g1, wave2, registry),
      ...waveGateProblems(gate, wave, registry),
    );
  } catch {
    // Malformed nested records must be refusals, not successful partial checks.
    errors.push('Malformed canonical G2 or prerequisite records');
  }
  require(!Object.hasOwn(gate, 'gate') &&
    !Object.hasOwn(gate, 'candidate') &&
    !Object.hasOwn(wave, 'gate') &&
    !Object.hasOwn(wave, 'frozenBaseSha'), 'Ambiguous G2 record format');
  require(registry.gates?.G2 === `${BASE}gates/g2/SOURCE_MANIFEST.json` &&
    registry.waveManifests?.['3'] === `${BASE}waves/wave-03.plan.json` &&
    wave.decisionRecord === registry.gates.G2, 'G2 records must use the canonical paths');
  require(gate.preservedG1SourceSha === g1.frozenBaseSha &&
    fullSha(gate.preservedG1SourceSha), 'Historical G1 source must remain unchanged');
  require(fullSha(gate.candidateSourceSha) &&
    fullSha(gate.candidateTreeSha) &&
    gate.candidateSourceSha !== gate.candidateTreeSha, 'Full distinct candidate SHAs required');
  require(text(gate.authority) && text(gate.publication?.branch), 'Coordinator identity required');
  require(gate.evidenceRecord ===
    `${BASE}gates/g2/ACCEPTANCE_EVIDENCE.json`, 'Canonical evidence record required');
  for (const entry of list(gate.blockers)) {
    require(object(entry) &&
      text(entry.id) &&
      text(entry.owner) &&
      text(entry.reason), 'Every blocker needs an identity, owner and reason');
  }
  const evidence = list(gate.mandatoryEvidence);
  require(evidence.length === G2_REQUIRED_EVIDENCE.length &&
    evidence.every(
      (entry, i) => entry?.id === G2_REQUIRED_EVIDENCE[i],
    ), 'Mandatory G2 evidence cannot be removed, duplicated or reordered');
  for (const entry of evidence) {
    require(['PASS', 'FAIL', 'NOT_RUN', 'PENDING', 'BLOCKED'].includes(entry?.status) &&
      entry?.sourceSha === gate.candidateSourceSha &&
      entry?.treeSha === gate.candidateTreeSha &&
      text(entry?.reference), 'Evidence must name the actual candidate, status and reference');
  }
  const publication = gate.publication;
  require(['DRAFT_PENDING_OWNER_REVIEW', 'MERGED'].includes(
    publication?.state,
  ), 'Unknown publication state');
  if (publication?.state === 'DRAFT_PENDING_OWNER_REVIEW') {
    require(publication.acceptanceRecordCommitSha === null &&
      publication.verifiedMerge !== true, 'Draft publication cannot claim a verified merge');
  }
  if (gate.decision === 'BLOCKED') {
    require(publication?.state ===
      'DRAFT_PENDING_OWNER_REVIEW', 'Blocked report is not acceptance publication');
  }
  // An added policy field cannot authorize operations simply because the
  // canonical configuration record did not previously carry that field.
  if (gate.restrictions !== undefined) {
    require(object(gate.restrictions) &&
      ['liveMoney', 'deploy', 'merge', 'accountGrants', 'spend'].every(
        (key) => gate.restrictions[key] === false,
      ) &&
      gate.restrictions.preserveG1 === true &&
      gate.restrictions.preserveR16R18Holds ===
        true, 'Coordination grants no operational authority and preserves existing policy holds');
  }
  // Acceptance retains the earlier closeout's stricter evidence requirements.
  // A new schema or PASS label alone must not bypass full-source checks.
  if (gate.decision === 'ACCEPTED') {
    require(g1.decision === 'ACCEPTED' &&
      g1.publication?.state === 'MERGED' &&
      fullSha(
        g1.publication.acceptanceRecordCommitSha,
      ), 'G2 requires the published G1 prerequisite');
    require(object(gate.restrictions), 'Accepted G2 must explicitly preserve policy holds');
    const source = gate.candidateSourceSha;
    const checks = list(gate.checks?.observed);
    require(gate.checks?.completeInventoryVerified === true &&
      checks.length > 0 &&
      new Set(checks.map((c) => c?.name)).size === checks.length &&
      REQUIRED_CHECKS.every((name) => checks.some((c) => c?.name === name)) &&
      checks.every(
        (c) =>
          c?.headSha === source &&
          c?.status === 'completed' &&
          c?.conclusion === 'success' &&
          Number.isSafeInteger(c?.id) &&
          c.id > 0,
      ), 'Acceptance requires complete successful exact-source checks');
    const official = gate.checks?.officialCodeQL;
    require(official?.headSha === source &&
      official?.appSlug === 'github-advanced-security' &&
      official?.conclusion === 'success' &&
      official?.annotationsCount === 0 &&
      Number.isSafeInteger(official?.id) &&
      official.id > 0, 'Official CodeQL evidence required');
    require(gate.sourceArtifact?.treeRecomputed === true &&
      Number.isSafeInteger(gate.sourceArtifact?.trackedBlobsVerified) &&
      gate.sourceArtifact.trackedBlobsVerified > 0 &&
      DIGEST.test(
        gate.sourceArtifact?.zipSha256 ?? '',
      ), 'Verified source artifact identity required');
    require(gate.contracts?.sourceSha === source &&
      gate.contracts?.version === 'hsm.money.v1' &&
      JSON.stringify(Object.keys(gate.contracts?.sha256 ?? {}).sort()) ===
        JSON.stringify([...PORTS].sort()) &&
      Object.values(gate.contracts?.sha256 ?? {}).every(
        (digest) => typeof digest === 'string' && DIGEST.test(digest),
      ), 'Exact source-bound four port digests required');
    const { closeout, r25 } = bundle;
    require(closeout?.sourceSha === source &&
      closeout?.treeSha === gate.candidateTreeSha &&
      closeout?.historicalG1BaseSha === g1.frozenBaseSha &&
      closeout?.decision === 'ACCEPTED' &&
      JSON.stringify(list(closeout?.lanes).map((l) => l?.id)) ===
        JSON.stringify(['R24', 'R25', 'R26', 'R27', 'R28']) &&
      list(closeout?.lanes).every(
        (lane) =>
          lane?.merged === true &&
          lane.integration === 'PASS' &&
          Number.isSafeInteger(lane.pr) &&
          lane.pr > 0 &&
          fullSha(lane.sourceHeadSha) &&
          fullSha(lane.mergeCommitSha) &&
          lane.prUrl === `https://github.com/baraabd/homeservicemarketplace/pull/${lane.pr}` &&
          registry.sprints?.some(
            (s) => s.id === lane.id && s.branch === lane.branch && s.wave === 2,
          ),
      ), 'Acceptance requires the exact-source five-lane closeout; historical inspection is not acceptance');
    const commands = list(r25?.commands);
    const browser = commands.find((c) => c?.label === 'browser');
    require(r25?.headSha === source &&
      r25?.treeSha === gate.candidateTreeSha &&
      r25?.zipDigestVerified === true &&
      DIGEST.test(r25?.zipSha256 ?? '') &&
      Number.isSafeInteger(r25?.runId) &&
      r25.runId > 0 &&
      Number.isSafeInteger(r25?.artifactId) &&
      r25.artifactId > 0 &&
      r25?.status === 'SANDBOX_ACCEPTED' &&
      r25?.api?.success === true &&
      r25.api.passed > 0 &&
      r25.api.failed === 0 &&
      r25.api.skipped === 0 &&
      r25?.browser?.passed > 0 &&
      r25.browser.failed === 0 &&
      r25.browser.skipped === 0 &&
      r25.browser.exitCode === 0 &&
      r25.browser.timedOut === false &&
      browser?.exitCode === 0 &&
      commands.length > 0 &&
      commands.every(
        (c) => c?.exitCode === 0 && c?.signal === null && c?.timedOut === false,
      ), 'Verified exact-source R25 evidence required');
    if (publication?.state === 'MERGED') {
      require(publication.verifiedMerge === true &&
        fullSha(publication.acceptanceRecordCommitSha) &&
        publication.acceptanceRecordCommitSha !==
          source, 'Verified separate acceptance publication required');
    }
  }
  return errors;
}

export function canonicalG2ReadinessProblems(bundle, laneId = 'R29') {
  const errors = canonicalG2Problems(bundle);
  const lane = list(bundle?.wave?.lanes).find((entry) => entry?.id === laneId);
  if (
    bundle?.gate?.decision !== 'ACCEPTED' ||
    bundle?.gate?.publication?.state !== 'MERGED' ||
    bundle?.wave?.status !== 'READY_TO_START' ||
    lane?.status !== 'READY_TO_START' ||
    !list(bundle?.wave?.startableLanes).includes(laneId)
  )
    errors.push(`${laneId} is not authorized to start`);
  return errors;
}
