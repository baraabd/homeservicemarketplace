// Active G3/Wave 4 record adapter. A valid blocked plan is not start authority.
// Reuse G2 and the canonical registry/wave validators; never fall back to history.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBundle as readG2Bundle, recordProblems as g2Problems } from './g2-record.mjs';
import { waveGateProblems } from './wave-gate.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const BASE = 'docs/production-readiness/post-r18/';
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const list = (value) => (Array.isArray(value) ? value : []);

export async function readBundle(root = ROOT) {
  const [g2, gate, wave] = await Promise.all([
    readG2Bundle(root),
    readFile(path.join(root, `${BASE}gates/g3/SOURCE_MANIFEST.json`), 'utf8').then(JSON.parse),
    readFile(path.join(root, `${BASE}waves/wave-04.plan.json`), 'utf8').then(JSON.parse),
  ]);
  return { gate, wave, registry: g2.registry, g2 };
}

export function recordProblems(bundle) {
  if (!object(bundle) || !['gate', 'wave', 'registry', 'g2'].every((key) => object(bundle[key])))
    return ['Missing active G3 input object'];
  const { gate, wave, registry, g2 } = bundle;
  const errors = [];
  try {
    errors.push(...g2Problems(g2), ...waveGateProblems(gate, wave, registry));
  } catch {
    errors.push('Malformed G3 or prerequisite records');
  }
  if (JSON.stringify(registry) !== JSON.stringify(g2.registry))
    errors.push('G3 and its G2 prerequisite must use the same canonical registry');
  if (gate.gateId !== 'G3' || g2.gate?.gateId !== 'G2')
    errors.push('G3 requires the current canonical G2 prerequisite format');
  if (gate.decision === 'ACCEPTED') {
    const prerequisite = g2.gate;
    if (
      prerequisite?.decision !== 'ACCEPTED' ||
      prerequisite?.publication?.state !== 'MERGED' ||
      prerequisite?.publication?.verifiedMerge !== true ||
      gate.prerequisite?.frozenBaseSha !== prerequisite?.frozenBaseSha ||
      gate.prerequisite?.acceptanceRecordCommitSha !==
        prerequisite?.publication?.acceptanceRecordCommitSha
    )
      errors.push('Accepted G3 requires the exact accepted and verified merged G2 prerequisite');
  }
  return errors;
}

export function readinessProblems(bundle, laneId = 'R34') {
  const errors = recordProblems(bundle);
  const lane = list(bundle?.wave?.lanes).find((entry) => entry?.id === laneId);
  if (
    !/^R3[4-8]$/u.test(laneId) ||
    bundle?.gate?.decision !== 'ACCEPTED' ||
    bundle?.gate?.publication?.state !== 'MERGED' ||
    bundle?.gate?.publication?.verifiedMerge !== true ||
    bundle?.wave?.status !== 'READY_TO_START' ||
    lane?.status !== 'READY_TO_START' ||
    !list(bundle?.wave?.startableLanes).includes(laneId)
  )
    errors.push(`${laneId} is not authorized to start`);
  return errors;
}

async function main() {
  const [command = '--check', lane = 'R34', ...extra] = process.argv.slice(2);
  if (!['--check', '--ready'].includes(command) || !/^R3[4-8]$/u.test(lane) || extra.length)
    throw new Error('Invalid arguments');
  const bundle = await readBundle();
  const errors = command === '--ready' ? readinessProblems(bundle, lane) : recordProblems(bundle);
  if (errors.length) {
    for (const error of errors) console.error(`FAIL ${error}`);
    process.exitCode = 1;
  } else {
    console.log(
      'PASS G3 record consistency; this does not authenticate evidence or grant approval.',
    );
    console.log(
      `Recorded G3: ${bundle.gate.decision}; Wave 4: ${bundle.wave.status}; R38 final G4 join: BLOCKED`,
    );
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch(() => {
    console.error('FAIL unreadable or invalid G3 inputs');
    process.exitCode = 1;
  });
}
