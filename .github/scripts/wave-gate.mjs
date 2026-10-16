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
