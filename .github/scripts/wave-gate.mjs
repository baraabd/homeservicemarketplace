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
