// Dispatch explicitly by record shape. The active CLI never falls back to an
// archived snapshot when the current coordinator record is missing or invalid.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { recordProblems as legacyProblems, readinessProblems as legacyReadiness } from './g2-legacy-record.mjs';
import { canonicalG2Problems, canonicalG2ReadinessProblems } from './g2-current-record.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const BASE = 'docs/production-readiness/post-r18/';
const GATE = `${BASE}gates/g2/`;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export function recordProblems(bundle) {
  if (object(bundle?.gate) && Object.hasOwn(bundle.gate, 'gateId')) {
    if (Object.hasOwn(bundle.gate, 'gate')) return ['Ambiguous G2 record format'];
    return canonicalG2Problems(bundle);
  }
  return legacyProblems(bundle);
}

export function readinessProblems(bundle, laneId = 'R29') {
  if (object(bundle?.gate) && Object.hasOwn(bundle.gate, 'gateId')) {
    if (Object.hasOwn(bundle.gate, 'gate')) return ['Ambiguous G2 record format'];
    return canonicalG2ReadinessProblems(bundle, laneId);
  }
  return legacyReadiness(bundle, laneId);
}

async function readFiles(root, files) {
  return Object.fromEntries(await Promise.all(Object.entries(files).map(async ([key, file]) =>
    [key, JSON.parse(await readFile(path.join(root, file), 'utf8'))])));
}

export async function readBundle(root = ROOT) {
  const bundle = await readFiles(root, {
    gate: `${GATE}SOURCE_MANIFEST.json`,
    closeout: `${BASE}waves/wave-02.closeout.json`,
    wave: `${BASE}waves/wave-03.plan.json`,
    r25: `${GATE}evidence/r25-summary.json`,
    registry: `${BASE}SPRINT_REGISTRY.json`,
  });
  if (object(bundle.gate) && Object.hasOwn(bundle.gate, 'gateId')) {
    Object.assign(bundle, await readFiles(root, {
      g1: `${BASE}gates/g1/SOURCE_MANIFEST.json`,
      wave2: `${BASE}waves/wave-02.plan.json`,
    }));
  }
  return bundle;
}

/** Test/audit reader only. The CLI always calls readBundle above. */
export async function readHistoricalBundle(root = ROOT) {
  const archive = `${GATE}history/closeout-6e13120/`;
  return readFiles(root, {
    gate: `${archive}SOURCE_MANIFEST.json`,
    closeout: `${archive}wave-02.closeout.json`,
    wave: `${archive}wave-03.plan.json`,
    r25: `${archive}r25-summary.json`,
    registry: `${archive}SPRINT_REGISTRY.json`,
  });
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
