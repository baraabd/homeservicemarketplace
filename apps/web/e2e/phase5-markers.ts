import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { FINAL_REAL_API_ROOT, type TaskScreenFile } from './phase5-evidence-ledger';
import { unobservedRouteFlagEvidence } from './provider-v2-flag-evidence';
import { phase5RunId } from './phase5-run-id';

// Sprint 09B.29 Phase 5B — the evidence the ledger has always demanded and
// nothing has ever produced.
//
// docs/provider-experience-v2/PHASE5_VERIFICATION.md
//
// WHY route AND persistence WERE 0/6
//
// Not because the journeys were untested. `provider-onboarding-v2-real-api` and
// `provider-onboarding-v2-persistence` have driven all six task screens against
// a real API, real Postgres, real Redis, real cookies and real guards for two
// sprints. They simply never WROTE anything the ledger reads, so the counters
// reported the absence of a file rather than the absence of a test.
//
// This module is that file, and nothing more. It records what a run did; it
// decides nothing. Every field here is checked by `routeEvidence` or
// `persistenceEvidence`, and a marker that disagrees with the run manifest is
// refused — so writing one cannot, by itself, earn anything.
//
// WHAT A MARKER CANNOT DO
//
// It cannot assert that a test was honest. `interceptionFree` is written by the
// spec, and a spec that lied about it would be believed. What stops that is a
// separate mechanism: `assertCleanTraffic` watches the real network and fails
// if any onboarding endpoint was served by anything other than the API, and
// `phase5-spec-scan` reads the spec SOURCE for `page.route` and friends. The
// marker is the record; those two are the proof.

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = join(HERE, '..');

/** The commit under test. Recorded so evidence cannot outlive its revision. */
function gitSha(): string {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: WEB_ROOT,
      encoding: 'utf8',
    }).trim();
  } catch {
    return 'unknown';
  }
}

/**
 * A digest of the bundle actually served.
 *
 * Hashes the built entry files rather than the source: the question a reviewer
 * asks of route evidence is "was this the artefact the browser loaded", and a
 * source hash cannot answer it — a stale `dist/` would pass.
 */
function bundleHash(): string {
  const assets = join(WEB_ROOT, 'dist', 'assets');
  try {
    const hash = createHash('sha256');
    for (const name of readdirSync(assets).sort()) {
      if (!name.endsWith('.js') && !name.endsWith('.css')) continue;
      hash.update(name);
      hash.update(readFileSync(join(assets, name)));
    }
    return hash.digest('hex');
  } catch {
    return 'unknown';
  }
}

let cachedSha: string | null = null;
let cachedBundle: string | null = null;

function stamp(): { runId: string; gitSha: string; bundleHash: string } {
  cachedSha ??= gitSha();
  cachedBundle ??= bundleHash();
  return { runId: phase5RunId(), gitSha: cachedSha, bundleHash: cachedBundle };
}

function write(kind: 'route' | 'persistence', screen: TaskScreenFile, body: unknown): void {
  const dir = join(FINAL_REAL_API_ROOT, kind);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${screen.replace(/\.tsx$/, '')}.json`);
  writeFileSync(file, `${JSON.stringify(body, null, 2)}\n`);
}

export interface RouteMarkerInput {
  screen: TaskScreenFile;
  /** The address the browser was actually on. */
  route: string;
  apiOrigin: string;
  /** How the V2 flag was switched on — build env, storage override, cohort. */
  flagSource: string;
  /**
   * Every interception mechanism the spec used. EMPTY is the claim being made;
   * the ledger refuses the marker if any forbidden name appears here, so a
   * spec that needed one cannot quietly keep its credit.
   */
  mechanisms?: readonly string[];
}

/**
 * Record that a screen was reached over real HTTP with the flag ON.
 *
 * Called only after the assertions have passed, so `exitStatus: 0` is a fact
 * about this screen's checks rather than about the process — a marker written
 * before an assertion would claim a success that had not happened yet.
 */
export function writeRouteMarker(input: RouteMarkerInput): void {
  write('route', input.screen, {
    ...stamp(),
    screen: input.screen,
    route: input.route,
    apiOrigin: input.apiOrigin,
    ...unobservedRouteFlagEvidence(input.flagSource),
    flagValue: true,
    interceptionFree: true,
    mechanisms: input.mechanisms ?? [],
    exitStatus: 0,
    recordedAt: new Date().toISOString(),
  });
}

export interface PersistenceMarkerInput {
  screen: TaskScreenFile;
  /** The field(s) under test, before the edit. */
  before: Record<string, unknown>;
  /** The same field(s) after it, as the provider left them. */
  after: Record<string, unknown>;
  /** Read back through the UI after a hard reload. */
  observedAfterReload: Record<string, unknown>;
  /** Read back in a brand-new context after signing in again. */
  observedAfterFreshSignIn: Record<string, unknown>;
  /** Read straight from Postgres, bypassing the API entirely. */
  databaseValues: Record<string, unknown>;
  /** Which database answered — so two runs cannot be conflated. */
  databaseSystemId: string;
  /** The revision the server acknowledged for the write. */
  acknowledgedVersion: number;
}

/**
 * Record that an edit survived, and what independently agreed that it had.
 *
 * The ledger compares `after` against all three observations and refuses the
 * marker if any disagrees — so a run that captured a durable-looking edit and a
 * database that never received it produces a FAILURE rather than credit.
 */
export function writePersistenceMarker(input: PersistenceMarkerInput): void {
  write('persistence', input.screen, {
    ...stamp(),
    ...input,
    recordedAt: new Date().toISOString(),
  });
}
