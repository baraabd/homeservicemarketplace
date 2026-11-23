// Cooperative record validation, not cryptographic or GitHub authorization.
import path from 'node:path';

const SHA = /^[0-9a-f]{40}$/u;
const REQUIRED_EVIDENCE = [
  'existing-post-merge-checks',
  'r20-real-storage',
  'r21-real-smtp',
  'r22-process-and-replay',
  'r19-interface-freeze',
  'r23-boundary-instrumentation',
];
const safe = (p) =>
  typeof p === 'string' &&
  p.length > 0 &&
  !path.posix.isAbsolute(p) &&
  !p.includes('\\') &&
  !p.split('/').includes('..') &&
  !p.endsWith('/') &&
  path.posix.normalize(p) === p &&
  !/[<>*?]/u.test(p);
const list = (v) => (Array.isArray(v) ? v : []);

export function waveGateProblems(gate, wave, registry) {
  if (gate?.gateId === 'G3' || wave?.wave === 4 || wave?.startGate === 'G3')
    return g3WaveGateProblems(gate, wave, registry);
  if (gate?.gateId === 'G2' || wave?.wave === 3 || wave?.startGate === 'G2')
    return g2WaveGateProblems(gate, wave, registry);
  const errors = [];
  if (gate?.schemaVersion !== 1 || gate.gateId !== 'G1') errors.push('invalid G1 record');
  if (wave?.schemaVersion !== 1 || wave.wave !== 2 || wave.startGate !== 'G1')
    errors.push('invalid Wave 2 manifest');
  if (!['BLOCKED', 'READY_TO_START'].includes(wave?.status)) errors.push('unsupported wave status');
  if (!['BLOCKED', 'ACCEPTED'].includes(gate?.decision)) errors.push('unsupported gate decision');
  const evidenceIds = list(gate?.mandatoryEvidence).map((e) => e.id);
  if (
    new Set(evidenceIds).size !== evidenceIds.length ||
    REQUIRED_EVIDENCE.some((id) => !evidenceIds.includes(id))
  )
    errors.push('mandatory evidence categories must be present and unique');
  if (!SHA.test(gate?.candidateSourceSha ?? '') || !SHA.test(gate?.candidateTreeSha ?? ''))
    errors.push('candidate requires full source and tree SHAs');
  const blocked = gate?.decision === 'BLOCKED';
  if (
    blocked &&
    (gate.frozenBaseSha !== null || gate.frozenTreeSha !== null || wave?.baseSha !== null)
  )
    errors.push('blocked gate cannot freeze a source');
  if (
    blocked &&
    (!list(gate.blockers).length || wave?.status !== 'BLOCKED' || list(wave.startableLanes).length)
  )
    errors.push('blocked gate cannot authorize a lane');
  if (!blocked) {
    if (
      !SHA.test(gate?.frozenBaseSha ?? '') ||
      !SHA.test(gate?.frozenTreeSha ?? '') ||
      gate.frozenBaseSha !== gate.candidateSourceSha ||
      gate.frozenTreeSha !== gate.candidateTreeSha ||
      wave?.baseSha !== gate.frozenBaseSha
    )
      errors.push('inconsistent frozen source');
    if (
      list(gate?.blockers).length ||
      !list(gate?.mandatoryEvidence).length ||
      list(gate?.mandatoryEvidence).some(
        (e) => e.status !== 'PASS' || e.sourceSha !== gate.frozenBaseSha || !e.reference,
      )
    )
      errors.push('unsupported acceptance claim: mandatory evidence is incomplete');
    const accepted = list(gate?.acceptedSprints);
    for (const id of ['R19', 'R20', 'R21', 'R22', 'R23'])
      if (!accepted.includes(id)) errors.push(`unresolved dependency ${id}`);
    if (
      wave?.status === 'READY_TO_START' &&
      (gate?.publication?.state !== 'MERGED' ||
        !SHA.test(gate?.publication?.acceptanceRecordCommitSha ?? ''))
    )
      errors.push('start requires a separately published merged acceptance record');
  }
  const lanes = list(wave?.lanes);
  if (lanes.length !== 5 || new Set(lanes.map((l) => l.id)).size !== 5)
    errors.push('Wave 2 requires five unique lanes');
  const writers = new Map();
  lanes.forEach((lane, i) => {
    const sprint = registry?.sprints?.find((s) => s.id === lane.id);
    if (lane.id !== `R${24 + i}` || lane.lane !== i + 1 || !sprint || sprint.wave !== 2)
      errors.push('lane identity mismatch');
    if (lane.frozenBaseSha !== wave.baseSha || sprint?.frozenBase !== wave.baseSha)
      errors.push(`${lane.id}: inconsistent wave bases`);
    if (
      sprint?.title !== lane.title ||
      sprint?.branch !== lane.branch ||
      JSON.stringify(sprint?.dependencies) !== JSON.stringify(lane.dependencies)
    )
      errors.push(`${lane.id}: registry differs from wave manifest`);
    const owned = sprint?.ownedPaths;
    if (
      JSON.stringify(owned?.exact ?? []) !== JSON.stringify(lane.exactFiles ?? []) ||
      JSON.stringify(owned?.leases ?? []) !== JSON.stringify(lane.leases ?? []) ||
      list(owned?.prefixes).length
    )
      errors.push(`${lane.id}: ownership differs from exact manifest`);
    if (!list(lane.exactFiles).length || !lane.owner) errors.push(`${lane.id}: missing ownership`);
    for (const dep of list(lane.dependencies)) {
      const upstream = registry?.sprints?.find((s) => s.id === dep);
      if (!upstream || upstream.wave >= 2) errors.push(`${lane.id}: invalid dependency ${dep}`);
      if (list(wave.startableLanes).includes(lane.id) && !list(gate.acceptedSprints).includes(dep))
        errors.push(`${lane.id}: unresolved dependency ${dep}`);
    }
    const paths = [...list(lane.exactFiles)];
    for (const lease of list(lane.leases)) {
      if (
        !lease.grantedBy ||
        !lease.expires ||
        !lease.scope ||
        !lease.handoff ||
        !list(lease.paths).length
      )
        errors.push(`${lane.id}: incomplete lease`);
      paths.push(...list(lease.paths));
    }
    for (const file of paths) {
      if (!safe(file)) errors.push(`${lane.id}: unsafe or non-exact path ${file}`);
      if (writers.has(file)) errors.push(`conflicting ownership/leases: ${file}`);
      writers.set(file, lane.id);
    }
    if (blocked && (lane.status !== 'BLOCKED' || sprint?.status !== 'PLANNED'))
      errors.push(`${lane.id}: blocked lane cannot claim readiness`);
    if (
      list(wave.startableLanes).includes(lane.id) &&
      (lane.status !== 'READY_TO_START' || sprint?.status !== 'READY_TO_START')
    )
      errors.push(`${lane.id}: start status must agree with registry`);
    if (
      list(wave.blockedLanes).includes(lane.id) &&
      (lane.status !== 'BLOCKED' || sprint?.status === 'READY_TO_START')
    )
      errors.push(`${lane.id}: held lane cannot claim readiness`);
  });
  const startable = list(wave?.startableLanes),
    held = list(wave?.blockedLanes);
  if (
    [...startable, ...held].length !== 5 ||
    new Set([...startable, ...held]).size !== 5 ||
    [...startable, ...held].some((id) => !lanes.some((l) => l.id === id))
  )
    errors.push('startable and blocked lanes must partition Wave 2');
  if (wave?.status === 'READY_TO_START' && gate?.decision !== 'ACCEPTED')
    errors.push('start requires accepted G1');
  if (wave?.status === 'BLOCKED' && startable.length)
    errors.push('blocked wave cannot have startable lanes');
  return errors;
}

// The future gate is deliberately separate from the published G1/G2 contracts.
// A blocked plan is valid without a fabricated candidate; it grants no start.
export const G3_REQUIRED_EVIDENCE = Object.freeze([
  'combined-wave3-checks',
  'r29-real-stripe-sandbox',
  'r30-real-manual-review',
  'r31-atomic-subscription-entitlements',
  'r32-refund-ambiguity-recovery',
  'r33-financial-operations',
  'integrated-confirmation-activation-refund-outbox',
]);
const G3_SPRINTS = ['R29', 'R30', 'R31', 'R32', 'R33'];
const G3_CHECKS = [
  'CI gate',
  'Analyze JavaScript/TypeScript',
  'Production governance',
  'R18 functional completion acceptance',
  'R25 real replicas and recovery',
  'R27 comparable measurements and unchanged budgets',
];
const G3_PARTICIPANTS = ['stripe', 'manual', 'activation', 'refund', 'finance-read'];
const G3_BOUNDARIES = [
  'route-handler-discovery',
  'atomic-rollback',
  'retry-concurrency',
  'post-commit-outbox',
];
const G4_JOIN = ['R34', 'R35', 'R36', 'R37'];
const BASE = 'docs/production-readiness/post-r18/';
const fullSha = (value) => typeof value === 'string' && /^(?!0{40}$)[a-f0-9]{40}$/u.test(value);
const digest = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
const positiveId = (value) => Number.isSafeInteger(value) && value > 0;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function g3WaveGateProblems(gate, wave, registry) {
  const errors = [];
  const require = (condition, message) => {
    if (!condition) errors.push(message);
  };
  require(record(gate) && gate.schemaVersion === 1 && gate.gateId === 'G3', 'invalid G3 record');
  require(record(wave) &&
    wave.schemaVersion === 1 &&
    wave.wave === 4 &&
    wave.startGate === 'G3', 'invalid Wave 4 manifest: G2 cannot release Wave 4');
  if (!record(gate) || !record(wave)) return errors;
  require(['BLOCKED', 'ACCEPTED'].includes(gate.decision), 'unsupported G3 decision');
  require(['BLOCKED', 'READY_TO_START'].includes(wave.status), 'unsupported Wave 4 status');
  require(nonempty(gate.authority), 'G3 coordinator identity is required');
  require(registry?.gates?.G3 === `${BASE}gates/g3/SOURCE_MANIFEST.json` &&
    registry?.waveManifests?.['4'] === `${BASE}waves/wave-04.plan.json` &&
    wave.decisionRecord === registry.gates.G3, 'G3 records must use the canonical paths');
  require(!Object.hasOwn(gate, 'gate') &&
    !Object.hasOwn(gate, 'candidate') &&
    !Object.hasOwn(wave, 'gate') &&
    !Object.hasOwn(wave, 'frozenBaseSha'), 'Ambiguous G3 record format');
  const absentCandidate = gate.candidateSourceSha === null && gate.candidateTreeSha === null;
  require(absentCandidate ||
    (fullSha(gate.candidateSourceSha) &&
      fullSha(gate.candidateTreeSha) &&
      gate.candidateSourceSha !==
        gate.candidateTreeSha), 'G3 candidate requires full distinct source/tree SHAs or an explicit null pair');
  const prerequisite = gate.prerequisite;
  require(prerequisite?.gateId === 'G2' &&
    prerequisite?.record ===
      `${BASE}gates/g2/SOURCE_MANIFEST.json`, 'G3 requires the canonical G2 prerequisite');
  require((prerequisite?.frozenBaseSha === null &&
    prerequisite?.acceptanceRecordCommitSha === null) ||
    (fullSha(prerequisite?.frozenBaseSha) &&
      fullSha(prerequisite?.acceptanceRecordCommitSha) &&
      prerequisite.frozenBaseSha !==
        prerequisite.acceptanceRecordCommitSha), 'G3 prerequisite identities must be a full separate source/publication pair or both null');
  require(Array.isArray(gate.blockers) &&
    list(gate.blockers).every(
      (entry) =>
        record(entry) && nonempty(entry.id) && nonempty(entry.owner) && nonempty(entry.reason),
    ), 'G3 blockers need an explicit identity, owner and reason');
  const evidence = list(gate.mandatoryEvidence);
  require(evidence.length === G3_REQUIRED_EVIDENCE.length &&
    evidence.every(
      (entry, index) => record(entry) && entry.id === G3_REQUIRED_EVIDENCE[index],
    ), 'Mandatory G3 evidence cannot be removed, duplicated or reordered');
  require(evidence.every(
    (entry) =>
      ['PASS', 'FAIL', 'NOT_RUN', 'PENDING', 'BLOCKED'].includes(entry?.status) &&
      entry?.sourceSha === gate.candidateSourceSha &&
      entry?.treeSha === gate.candidateTreeSha &&
      nonempty(entry?.reference) &&
      (!absentCandidate || entry.status === 'NOT_RUN'),
  ), 'G3 evidence must identify its actual candidate, status and reference');
  const accepted = list(gate.acceptedSprints);
  require(Array.isArray(gate.acceptedSprints) &&
    new Set(accepted).size === accepted.length &&
    accepted.every((id) =>
      list(registry?.sprints).some((sprint) => sprint?.id === id && sprint.wave < 4),
    ), 'G3 accepted dependencies must be unique earlier-wave sprint IDs');
  const publication = gate.publication;
  require(nonempty(publication?.branch) &&
    ['NOT_PREPARED', 'DRAFT_PENDING_OWNER_REVIEW', 'MERGED'].includes(
      publication?.state,
    ), 'G3 publication identity/state is required');
  if (publication?.state !== 'MERGED') {
    require(publication?.acceptanceRecordCommitSha === null &&
      publication?.verifiedMerge === false, 'Unpublished G3 cannot claim a verified merge');
  } else {
    require(gate.decision === 'ACCEPTED' &&
      publication.verifiedMerge === true &&
      fullSha(publication.acceptanceRecordCommitSha) &&
      publication.acceptanceRecordCommitSha !==
        gate.candidateSourceSha, 'G3 requires a separately verified merged acceptance publication');
  }
  require(record(gate.restrictions) &&
    ['liveMoney', 'deploy', 'merge', 'accountGrants', 'spend'].every(
      (key) => gate.restrictions[key] === false,
    ) &&
    gate.restrictions.preserveG1 === true &&
    gate.restrictions.preserveR16R18Holds ===
      true, 'G3 grants no operational authority and preserves existing policy holds');

  if (gate.decision === 'BLOCKED') {
    require(gate.frozenBaseSha === null &&
      gate.frozenTreeSha === null &&
      wave.baseSha === null, 'Blocked G3 cannot freeze a source');
    require(gate.blockers?.length > 0 &&
      accepted.length === 0 &&
      wave.status === 'BLOCKED' &&
      list(wave.startableLanes).length === 0 &&
      publication?.state !==
        'MERGED', 'Blocked G3 cannot accept sprints, publish acceptance or release a lane');
  } else if (gate.decision === 'ACCEPTED') {
    require(!absentCandidate &&
      gate.frozenBaseSha === gate.candidateSourceSha &&
      gate.frozenTreeSha === gate.candidateTreeSha &&
      wave.baseSha === gate.frozenBaseSha, 'Inconsistent G3 frozen source');
    require(fullSha(prerequisite?.frozenBaseSha) &&
      fullSha(
        prerequisite?.acceptanceRecordCommitSha,
      ), 'Accepted G3 must bind its verified G2 prerequisite');
    require(publication?.state !==
      'NOT_PREPARED', 'Accepted G3 needs a prepared publication record');
    require(list(gate.blockers).length === 0 &&
      evidence.every(
        (entry) =>
          entry?.status === 'PASS' &&
          nonempty(entry?.artifact?.reference) &&
          digest(entry?.artifact?.sha256) &&
          positiveId(entry?.artifact?.artifactId) &&
          positiveId(entry?.artifact?.runId),
      ), 'Accepted G3 requires source-bound successful artifacts for every mandatory category');
    require(G3_SPRINTS.every((id) =>
      accepted.includes(id),
    ), 'G3 must accept all five Wave 3 lanes');
    const checks = list(gate.checks?.observed);
    require(gate.checks?.completeInventoryVerified === true &&
      checks.length > 0 &&
      new Set(checks.map((check) => check?.name)).size === checks.length &&
      G3_CHECKS.every((name) => checks.some((check) => check?.name === name)) &&
      checks.every(
        (check) =>
          nonempty(check?.name) &&
          positiveId(check?.id) &&
          check?.headSha === gate.candidateSourceSha &&
          check?.status === 'completed' &&
          check?.conclusion === 'success',
      ), 'Accepted G3 requires the complete successful exact-source check inventory');
    const official = gate.checks?.officialCodeQL;
    require(positiveId(official?.id) &&
      official?.headSha === gate.candidateSourceSha &&
      official?.appSlug === 'github-advanced-security' &&
      official?.conclusion === 'success' &&
      official?.annotationsCount === 0, 'G3 requires official successful exact-source CodeQL');
    require(gate.sourceArtifact?.sourceSha === gate.candidateSourceSha &&
      gate.sourceArtifact?.treeSha === gate.candidateTreeSha &&
      positiveId(gate.sourceArtifact?.artifactId) &&
      positiveId(gate.sourceArtifact?.runId) &&
      digest(gate.sourceArtifact?.innerArchiveSha256) &&
      gate.sourceArtifact?.treeRecomputed === true &&
      positiveId(gate.sourceArtifact?.trackedBlobsVerified) &&
      digest(
        gate.sourceArtifact?.zipSha256,
      ), 'G3 requires verified source archive and tree identity');
    const sourceLanes = list(gate.lanes);
    require(same(
      sourceLanes.map((lane) => lane?.id),
      G3_SPRINTS,
    ) &&
      sourceLanes.every(
        (lane) =>
          lane?.merged === true &&
          lane?.integration === 'PASS' &&
          positiveId(lane?.pr) &&
          lane?.prUrl === `https://github.com/baraabd/homeservicemarketplace/pull/${lane?.pr}` &&
          fullSha(lane?.sourceHeadSha) &&
          fullSha(lane?.mergeCommitSha) &&
          list(registry?.sprints).some(
            (sprint) =>
              sprint?.id === lane?.id && sprint.wave === 3 && sprint.branch === lane.branch,
          ),
      ), 'G3 requires the actual five-lane merged source closeout');
    const integration = gate.integration;
    require(integration?.sourceSha === gate.candidateSourceSha &&
      integration?.treeSha === gate.candidateTreeSha &&
      integration?.execution === 'REAL_REGISTERED_IMPLEMENTATIONS' &&
      nonempty(integration?.reference) &&
      same(
        list(integration?.participants).map((entry) => entry?.id),
        G3_PARTICIPANTS,
      ) &&
      list(integration?.participants).every(
        (entry) => nonempty(entry?.implementation) && nonempty(entry?.registrationReference),
      ) &&
      same(
        list(integration?.boundaries).map((entry) => entry?.id),
        G3_BOUNDARIES,
      ) &&
      list(integration?.boundaries).every(
        (entry) => entry?.status === 'PASS' && nonempty(entry?.reference),
      ), 'G3 requires actual registered implementations and atomic/retry/outbox integration evidence');
  }

  const lanes = list(wave.lanes);
  const startable = list(wave.startableLanes);
  const held = list(wave.blockedLanes);
  require(lanes.length === 5 &&
    new Set(lanes.map((lane) => lane?.id)).size ===
      5, 'Wave 4 requires five unique complete packages');
  require(Array.isArray(wave.startableLanes) &&
    Array.isArray(wave.blockedLanes) &&
    [...startable, ...held].length === 5 &&
    new Set([...startable, ...held]).size === 5 &&
    [...startable, ...held].every((id) =>
      lanes.some((lane) => lane?.id === id),
    ), 'Startable and blocked lanes must partition Wave 4');
  if (wave.status === 'BLOCKED')
    require(startable.length === 0, 'Blocked Wave 4 has no startable lanes');
  if (wave.status === 'READY_TO_START')
    require(gate.decision === 'ACCEPTED' &&
      publication?.state === 'MERGED' &&
      publication?.verifiedMerge === true &&
      startable.length > 0, 'Wave 4 start requires accepted and separately verified published G3');
  const writers = [];
  lanes.forEach((lane, index) => {
    if (!record(lane)) {
      errors.push('Invalid Wave 4 lane');
      return;
    }
    const sprint = list(registry?.sprints).find((entry) => entry?.id === lane.id);
    require(lane.id === `R${34 + index}` &&
      lane.wave === 4 &&
      lane.lane === index + 1 &&
      sprint?.wave === 4, 'Wave 4 lane identity mismatch');
    require(nonempty(lane.title) &&
      nonempty(lane.branch) &&
      namedOwner(lane.owner) &&
      same(lane.title, sprint?.title) &&
      same(lane.branch, sprint?.branch) &&
      same(lane.owner, sprint?.owner) &&
      Array.isArray(lane.dependencies) &&
      same(
        lane.dependencies,
        sprint?.dependencies,
      ), `${lane.id}: registry differs from the complete Wave 4 package`);
    require(lane.sourcePrompt === `${BASE}gates/g2/prompts/${lane.id}.md` &&
      sprint?.sourcePrompt ===
        lane.sourcePrompt, `${lane.id}: complete original source prompt required`);
    require(lane.frozenBaseSha === wave.baseSha &&
      sprint?.frozenBase === wave.baseSha &&
      sprint?.startBarrier?.gate === 'G3', `${lane.id}: inconsistent Wave 4 bases/start gate`);
    require(Array.isArray(lane.exactFiles) &&
      lane.exactFiles.length > 0 &&
      Array.isArray(lane.leases) &&
      same(sprint?.ownedPaths?.exact, lane.exactFiles) &&
      same(sprint?.ownedPaths?.leases, lane.leases) &&
      list(sprint?.ownedPaths?.prefixes).length ===
        0, `${lane.id}: ownership differs from exact Wave 4 manifest`);
    for (const dependency of list(lane.dependencies)) {
      require(list(registry?.sprints).some(
        (entry) => entry?.id === dependency && entry.wave < 4,
      ), `${lane.id}: dependencies must belong to earlier waves`);
      if (startable.includes(lane.id))
        require(accepted.includes(dependency), `${lane.id}: unresolved dependency ${dependency}`);
    }
    if (held.includes(lane.id))
      require(lane.status === 'BLOCKED' &&
        sprint?.status === 'PLANNED', `${lane.id}: held Wave 4 lane cannot claim readiness`);
    if (startable.includes(lane.id))
      require(lane.status === 'READY_TO_START' &&
        sprint?.status === 'READY_TO_START' &&
        lane.ownershipApproval === 'APPROVED_AFTER_VERIFIED_G3_PUBLICATION' &&
        same(lane.ownershipApproval, sprint?.ownershipApproval) &&
        nonempty(lane.sessionAssignment?.sessionId) &&
        nonempty(lane.sessionAssignment?.assignedBy) &&
        nonempty(
          lane.sessionAssignment?.assignedAt,
        ), `${lane.id}: start requires status agreement and exact writer assignment`);
    const paths = [...list(lane.exactFiles)];
    for (const lease of list(lane.leases)) {
      require(record(lease) &&
        nonempty(lease.grantedBy) &&
        nonempty(lease.scope) &&
        nonempty(lease.expires) &&
        nonempty(lease.handoff) &&
        list(lease.paths).length > 0 &&
        lease.sourcePrompt === lane.sourcePrompt &&
        lease.startPrerequisite?.gate === 'G3' &&
        lease.startPrerequisite?.requiredDecision === 'ACCEPTED' &&
        lease.startPrerequisite?.requiredPublication === 'MERGED_AND_VERIFIED' &&
        lease.startPrerequisite?.requiresSessionAssignment ===
          true, `${lane.id}: incomplete conditional Wave 4 lease`);
      paths.push(...list(lease?.paths));
    }
    for (const file of paths) {
      require(safe(file) &&
        ![...file].some(
          (character) => character.charCodeAt(0) <= 31 || character.charCodeAt(0) === 127,
        ), `${lane.id}: unsafe or non-exact ownership`);
      if (typeof file !== 'string') continue;
      require(!writers.some(
        (prior) => prior === file || prior.startsWith(`${file}/`) || file.startsWith(`${prior}/`),
      ), `${lane.id}: conflicting Wave 4 ownership/leases`);
      writers.push(file);
    }
  });
  const finalization = wave.r38Finalization;
  const r38 = lanes.find((lane) => lane?.id === 'R38');
  require(finalization?.gate === 'G4' &&
    finalization?.mode === 'SERIALIZED_AFTER_PEER_EVIDENCE' &&
    same(finalization?.requiredSprints, G4_JOIN) &&
    finalization?.status === 'BLOCKED' &&
    finalization?.acceptanceRecord === null &&
    same(r38?.finalEvidenceJoin, G4_JOIN) &&
    same(
      list(registry?.sprints).find((sprint) => sprint?.id === 'R38')?.finalEvidenceJoin,
      G4_JOIN,
    ) &&
    r38?.parallelScope ===
      'PHASE_A_PREPARATION_ONLY', 'Wave 4 preparation must preserve the separate serialized R38/G4 final evidence join');
  return errors;
}

// G2 has its own requirements. Keeping the G1 validator above unchanged
// preserves the already-published G1 evidence and start-authority contract.
export const G2_REQUIRED_EVIDENCE = Object.freeze([
  'combined-wave2-checks',
  'r24-interface-freeze',
  'r25-real-replicas-recovery',
  'r26-money-interface-security',
  'r27-measured-performance',
  'r28-checked-platform-plan',
]);
const G2_SPRINTS = ['R24', 'R25', 'R26', 'R27', 'R28'];
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const nonempty = (value) => typeof value === 'string' && value.trim().length > 0;
const namedOwner = (value) =>
  nonempty(value) || (record(value) && nonempty(value.lane) && nonempty(value.coordinator));

function g2WaveGateProblems(gate, wave, registry) {
  const errors = [];
  if (!record(gate) || gate.schemaVersion !== 1 || gate.gateId !== 'G2')
    errors.push('invalid G2 record');
  if (!record(wave) || wave.schemaVersion !== 1 || wave.wave !== 3 || wave.startGate !== 'G2')
    errors.push('invalid Wave 3 manifest');
  if (!record(gate) || !record(wave)) return errors;
  if (!['BLOCKED', 'ACCEPTED'].includes(gate.decision)) errors.push('unsupported G2 gate decision');
  if (!['BLOCKED', 'READY_TO_START'].includes(wave.status))
    errors.push('unsupported Wave 3 status');
  if (!SHA.test(gate.candidateSourceSha ?? '') || !SHA.test(gate.candidateTreeSha ?? ''))
    errors.push('G2 candidate requires full source and tree SHAs');

  const evidence = list(gate.mandatoryEvidence);
  const evidenceIds = evidence.map((entry) => entry?.id);
  if (
    !Array.isArray(gate.mandatoryEvidence) ||
    evidence.some((entry) => !record(entry) || !nonempty(entry.id)) ||
    new Set(evidenceIds).size !== evidenceIds.length ||
    G2_REQUIRED_EVIDENCE.some((id) => !evidenceIds.includes(id))
  )
    errors.push('G2 mandatory evidence categories must be present and unique');
  if (!Array.isArray(gate.blockers)) errors.push('G2 blockers must be an explicit array');
  const blocked = gate.decision === 'BLOCKED';
  const accepted = list(gate.acceptedSprints);
  if (
    !Array.isArray(gate.acceptedSprints) ||
    new Set(accepted).size !== accepted.length ||
    accepted.some(
      (id) => !list(registry?.sprints).some((sprint) => sprint.id === id && sprint.wave < 3),
    )
  )
    errors.push('G2 accepted dependencies must be unique earlier-wave sprint IDs');

  if (blocked) {
    if (gate.frozenBaseSha !== null || gate.frozenTreeSha !== null || wave.baseSha !== null)
      errors.push('blocked G2 cannot freeze a source');
    if (
      !list(gate.blockers).length ||
      wave.status !== 'BLOCKED' ||
      list(wave.startableLanes).length
    )
      errors.push('blocked G2 cannot authorize a lane');
    if (accepted.length) errors.push('blocked G2 cannot claim accepted sprints');
  } else if (gate.decision === 'ACCEPTED') {
    if (
      !SHA.test(gate.frozenBaseSha ?? '') ||
      !SHA.test(gate.frozenTreeSha ?? '') ||
      gate.frozenBaseSha !== gate.candidateSourceSha ||
      gate.frozenTreeSha !== gate.candidateTreeSha ||
      wave.baseSha !== gate.frozenBaseSha
    )
      errors.push('inconsistent G2 frozen source');
    if (
      list(gate.blockers).length ||
      evidence.some(
        (entry) =>
          entry?.status !== 'PASS' ||
          entry.sourceSha !== gate.frozenBaseSha ||
          entry.treeSha !== gate.frozenTreeSha ||
          !nonempty(entry.reference),
      )
    )
      errors.push('unsupported G2 acceptance claim: mandatory candidate evidence is incomplete');
    for (const id of G2_SPRINTS)
      if (!accepted.includes(id)) errors.push(`G2 unresolved dependency ${id}`);
    if (
      wave.status === 'READY_TO_START' &&
      (gate.publication?.state !== 'MERGED' ||
        !SHA.test(gate.publication?.acceptanceRecordCommitSha ?? ''))
    )
      errors.push('Wave 3 start requires a separately published merged G2 acceptance record');
  }

  // An external hosted/release hold is recorded separately. It never replaces
  // a required source or disposable-service PASS, including the R28 checked plan.
  if (gate.externalBlockers !== undefined && !Array.isArray(gate.externalBlockers))
    errors.push('G2 external blockers must be an explicit array');
  if (
    list(gate.externalBlockers).some(
      (entry) =>
        !record(entry) ||
        !nonempty(entry.id) ||
        !nonempty(entry.sprint) ||
        !nonempty(entry.owner) ||
        !nonempty(entry.reference) ||
        !['HOSTED_ENVIRONMENT_BLOCKED', 'POLICY_BLOCKED', 'EXTERNAL_BLOCKED'].includes(entry.state),
    )
  )
    errors.push('G2 external blocker requires its scope, owner and evidence');
  if (gate.decision === 'ACCEPTED') {
    const platform = evidence.find((entry) => entry?.id === 'r28-checked-platform-plan');
    if (
      platform?.scope !== 'CONFIGURATION_ONLY' ||
      !list(gate.externalBlockers).some(
        (entry) => entry?.sprint === 'R28' && entry.state === 'HOSTED_ENVIRONMENT_BLOCKED',
      )
    )
      errors.push(
        'G2 checked R28 configuration must retain its explicit hosted environment blocker',
      );
  }

  const lanes = list(wave.lanes);
  const startable = list(wave.startableLanes);
  const held = list(wave.blockedLanes);
  if (lanes.length !== 5 || new Set(lanes.map((lane) => lane?.id)).size !== 5)
    errors.push('Wave 3 requires five unique lanes');
  if (
    !Array.isArray(wave.startableLanes) ||
    !Array.isArray(wave.blockedLanes) ||
    [...startable, ...held].length !== 5 ||
    new Set([...startable, ...held]).size !== 5 ||
    [...startable, ...held].some((id) => !lanes.some((lane) => lane?.id === id))
  )
    errors.push('startable and blocked lanes must partition Wave 3');
  if (wave.status === 'BLOCKED' && startable.length)
    errors.push('blocked Wave 3 cannot have startable lanes');
  if (wave.status === 'READY_TO_START' && (gate.decision !== 'ACCEPTED' || !startable.length))
    errors.push('Wave 3 start requires accepted G2 and a complete startable package');

  const writers = new Map();
  lanes.forEach((lane, index) => {
    if (!record(lane)) {
      errors.push('invalid Wave 3 lane record');
      return;
    }
    const sprint = list(registry?.sprints).find((entry) => entry.id === lane.id);
    if (lane.id !== `R${29 + index}` || lane.lane !== index + 1 || !sprint || sprint.wave !== 3)
      errors.push('Wave 3 lane identity mismatch');
    const reserved = sprint?.status === 'RESERVED_PENDING_PACKAGE';
    if (reserved) {
      if (
        lane.status !== 'RESERVED_PENDING_PACKAGE' ||
        !held.includes(lane.id) ||
        startable.includes(lane.id) ||
        lane.title !== null ||
        lane.branch !== null ||
        lane.owner !== null ||
        lane.frozenBaseSha !== null ||
        lane.dependencies !== null ||
        !Array.isArray(lane.exactFiles) ||
        lane.exactFiles.length ||
        !Array.isArray(lane.leases) ||
        lane.leases.length ||
        sprint.title !== null ||
        sprint.branch !== null ||
        sprint.owner !== null ||
        sprint.frozenBase !== null ||
        sprint.dependencies !== null ||
        sprint.ownedPaths !== null ||
        sprint.requiredEvidence !== null ||
        sprint.pr !== null
      )
        errors.push(
          `${lane.id}: missing package must remain reserved without executable ownership`,
        );
      return;
    }
    if (!sprint || !nonempty(lane.title) || !nonempty(lane.branch) || !namedOwner(lane.owner))
      errors.push(`${lane.id}: missing Wave 3 package or ownership`);
    if (lane.frozenBaseSha !== wave.baseSha || sprint?.frozenBase !== wave.baseSha)
      errors.push(`${lane.id}: inconsistent Wave 3 bases`);
    if (
      sprint?.title !== lane.title ||
      sprint?.branch !== lane.branch ||
      JSON.stringify(sprint?.owner) !== JSON.stringify(lane.owner) ||
      !Array.isArray(lane.dependencies) ||
      JSON.stringify(sprint?.dependencies) !== JSON.stringify(lane.dependencies)
    )
      errors.push(`${lane.id}: registry differs from Wave 3 manifest`);
    if (
      !Array.isArray(lane.exactFiles) ||
      !lane.exactFiles.length ||
      !Array.isArray(lane.leases) ||
      JSON.stringify(sprint?.ownedPaths?.exact ?? []) !== JSON.stringify(lane.exactFiles) ||
      JSON.stringify(sprint?.ownedPaths?.leases ?? []) !== JSON.stringify(lane.leases) ||
      list(sprint?.ownedPaths?.prefixes).length
    )
      errors.push(`${lane.id}: ownership differs from exact Wave 3 manifest`);
    for (const dependency of list(lane.dependencies)) {
      const upstream = list(registry?.sprints).find((entry) => entry.id === dependency);
      if (!upstream || upstream.wave >= 3)
        errors.push(`${lane.id}: invalid dependency ${dependency}`);
      if (startable.includes(lane.id) && !accepted.includes(dependency))
        errors.push(`${lane.id}: unresolved dependency ${dependency}`);
    }
    if (blocked && (lane.status !== 'BLOCKED' || sprint?.status !== 'PLANNED'))
      errors.push(`${lane.id}: blocked G2 lane cannot claim readiness`);
    if (
      startable.includes(lane.id) &&
      (lane.status !== 'READY_TO_START' || sprint?.status !== 'READY_TO_START')
    )
      errors.push(`${lane.id}: Wave 3 start status must agree with registry`);
    if (
      startable.includes(lane.id) &&
      (lane.ownershipApproval !== 'APPROVED_AFTER_VERIFIED_G2_PUBLICATION' ||
        lane.ownershipApproval !== sprint?.ownershipApproval ||
        !record(lane.sessionAssignment) ||
        !nonempty(lane.sessionAssignment.sessionId) ||
        !nonempty(lane.sessionAssignment.assignedBy) ||
        !nonempty(lane.sessionAssignment.assignedAt))
    )
      errors.push(
        `${lane.id}: Wave 3 start requires approved ownership and exact writer assignment`,
      );
    if (
      held.includes(lane.id) &&
      (lane.status !== 'BLOCKED' || sprint?.status === 'READY_TO_START')
    )
      errors.push(`${lane.id}: held Wave 3 lane cannot claim readiness`);
    const paths = [...list(lane.exactFiles)];
    for (const lease of list(lane.leases)) {
      if (
        !record(lease) ||
        !nonempty(lease.grantedBy) ||
        !nonempty(lease.expires) ||
        !nonempty(lease.scope) ||
        !nonempty(lease.handoff) ||
        !list(lease.paths).length
      )
        errors.push(`${lane.id}: incomplete Wave 3 lease`);
      paths.push(...list(lease?.paths));
    }
    for (const file of paths) {
      if (
        !safe(file) ||
        [...file].some(
          (character) => character.charCodeAt(0) <= 31 || character.charCodeAt(0) === 127,
        )
      )
        errors.push(`${lane.id}: unsafe or non-exact path ${file}`);
      if (writers.has(file)) errors.push(`conflicting Wave 3 ownership/leases: ${file}`);
      writers.set(file, lane.id);
    }
  });
  return errors;
}
