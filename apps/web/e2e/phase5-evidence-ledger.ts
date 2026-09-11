import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PHASE5_STATES, type Phase5State } from './phase5-visual-states';

// Sprint 09B.29 Phase 5 — the evidence ledger.
//
// docs/provider-experience-v2/PHASE5_VERIFICATION.md
//
// WHY THIS EXISTS, AND WHAT IT REPLACES
//
// The first version of the conformance gate carried a hand-written list of
// "migrated" screens. Adding a filename to that list was enough to claim a
// screen, which is exactly backwards: the list was an ASSERTION about work,
// written by the same change that was supposed to be proving it. Two screens
// were credited that way before anyone noticed they had no visual, no axe and
// no real-HTTP evidence at all.
//
// So credit is now DERIVED. Nothing here records an opinion about whether a
// screen is done; every counter is computed by looking for artifacts on disk.
// A screen that has not produced its evidence cannot be counted, and there is
// no field anyone can edit to pretend otherwise.
//
// THE THREE COUNTERS ARE DELIBERATELY NOT ONE
//
//   presentation migrated        the approved Provider UI tree exists and its
//                                own conformance/visual checks pass
//   production-route integrated  the LIVE flag-ON route renders that tree
//                                through the real typed API, with no response
//                                interception and no injected state
//   real-API persisted           the data survives Hub navigation, a hard
//                                reload and a fresh sign-in, through real HTTP
//                                and real PostgreSQL
//
// Collapsing them is how a static screen gets called finished. A screen may sit
// at presentation 1 / route 0 / persisted 0 for a long time, and that is an
// honest state rather than a failure to report.

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = join(HERE, '..');

/** Where PROVISIONAL_UI artifacts are written. Never mixed with FINAL. */
export const PROVISIONAL_ROOT = join(WEB_ROOT, 'test-results', 'phase5-visual', 'provisional');

/** Where FINAL_VISUAL artifacts are written, keyed by the final commit SHA. */
export const FINAL_ROOT = join(WEB_ROOT, 'test-results', 'phase5-visual', 'final');

/** The six live task controllers this phase migrates. */
export const TASK_SCREENS = [
  'BasicsTaskScreen.tsx',
  'ServicesTaskScreen.tsx',
  'ServiceAreaTaskScreen.tsx',
  'AvailabilityTaskScreen.tsx',
  'PublicProfileTaskScreen.tsx',
  'ReviewTaskScreen.tsx',
] as const;

export type TaskScreenFile = (typeof TASK_SCREENS)[number];

/**
 * Which approved states each task controller is responsible for.
 *
 * A screen is only as migrated as the states it actually renders, so credit is
 * computed over these ids rather than over the file.
 */
export const SCREEN_STATES: Readonly<Record<TaskScreenFile, readonly number[]>> = Object.freeze({
  'BasicsTaskScreen.tsx': [3],
  'ServicesTaskScreen.tsx': [4, 5],
  'ServiceAreaTaskScreen.tsx': [6],
  'AvailabilityTaskScreen.tsx': [7],
  'PublicProfileTaskScreen.tsx': [8, 9],
  'ReviewTaskScreen.tsx': [11, 12, 13],
});

export const LOCALES = ['en', 'ar'] as const;
export type Locale = (typeof LOCALES)[number];

/** The one viewport a pixel comparison is geometrically valid at. */
export const CANONICAL_VIEWPORT = { width: 390, height: 844 } as const;

/** Every viewport the structural matrix inspects. */
export const RESPONSIVE_VIEWPORTS = [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1440, height: 900 },
] as const;

/** What a single canonical cell must have emitted to count. */
export interface CanonicalCellEvidence {
  readonly stateId: number;
  readonly locale: Locale;
  readonly expected: boolean;
  readonly actual: boolean;
  readonly diff: boolean;
  readonly metrics: boolean;
  /** The measured ratio, when metrics were emitted. */
  readonly diffPixelRatio: number | null;
}

export const MAX_DIFF_PIXEL_RATIO = 0.005;

function cellDir(root: string, stateSlug: string, locale: Locale, width: number): string {
  return join(root, stateSlug, locale, String(width));
}

function readMetrics(dir: string): { diffPixelRatio: number | null; ok: boolean } {
  const file = join(dir, 'metrics.json');
  if (!existsSync(file)) return { diffPixelRatio: null, ok: false };
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as { diffPixelRatio?: unknown };
    const ratio = typeof parsed.diffPixelRatio === 'number' ? parsed.diffPixelRatio : null;
    return { diffPixelRatio: ratio, ok: ratio !== null };
  } catch {
    return { diffPixelRatio: null, ok: false };
  }
}

/** What exists on disk for one canonical cell. Never an assertion — a read. */
export function canonicalCellEvidence(
  root: string,
  state: Phase5State,
  locale: Locale,
): CanonicalCellEvidence {
  const dir = cellDir(root, state.slug, locale, CANONICAL_VIEWPORT.width);
  const metrics = readMetrics(dir);
  return {
    stateId: state.id,
    locale,
    expected: existsSync(join(dir, 'expected.png')),
    actual: existsSync(join(dir, 'actual.png')),
    diff: existsSync(join(dir, 'diff.png')),
    metrics: metrics.ok,
    diffPixelRatio: metrics.diffPixelRatio,
  };
}

/** A canonical cell counts only when every artifact exists AND it passed. */
export function canonicalCellPasses(e: CanonicalCellEvidence): boolean {
  return (
    e.expected &&
    e.actual &&
    e.diff &&
    e.metrics &&
    e.diffPixelRatio !== null &&
    e.diffPixelRatio <= MAX_DIFF_PIXEL_RATIO
  );
}

/** Axe results for one state/locale, if a scan has been recorded. */
export function axeIsClean(root: string, state: Phase5State, locale: Locale): boolean {
  const file = join(cellDir(root, state.slug, locale, CANONICAL_VIEWPORT.width), 'axe.json');
  if (!existsSync(file)) return false;
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as {
      violations?: { impact?: string }[];
    };
    const violations = parsed.violations ?? [];
    // Serious and critical are the bar. A "minor" is still recorded and still
    // reported; it does not silently block a counter it was never about.
    return !violations.some((v) => v.impact === 'serious' || v.impact === 'critical');
  } catch {
    return false;
  }
}

/**
 * Real-HTTP route evidence for one screen.
 *
 * Emitted only by a test that ran against a production build with NO response
 * interception. The marker file records the bundle and API origin it ran
 * against, so a stale one cannot be mistaken for a fresh pass.
 */
export interface RouteEvidence {
  readonly screen: TaskScreenFile;
  readonly present: boolean;
  readonly interceptionFree: boolean;
  readonly bundleHash: string | null;
  readonly apiOrigin: string | null;
}

export function routeEvidence(root: string, screen: TaskScreenFile): RouteEvidence {
  const file = join(root, 'route', `${screen.replace(/\.tsx$/, '')}.json`);
  if (!existsSync(file)) {
    return { screen, present: false, interceptionFree: false, bundleHash: null, apiOrigin: null };
  }
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as {
      interceptionFree?: unknown;
      bundleHash?: unknown;
      apiOrigin?: unknown;
    };
    return {
      screen,
      present: true,
      // The flag has to be asserted BY the test that had no interception. A
      // missing flag is not a pass.
      interceptionFree: parsed.interceptionFree === true,
      bundleHash: typeof parsed.bundleHash === 'string' ? parsed.bundleHash : null,
      apiOrigin: typeof parsed.apiOrigin === 'string' ? parsed.apiOrigin : null,
    };
  } catch {
    return { screen, present: false, interceptionFree: false, bundleHash: null, apiOrigin: null };
  }
}

/** Real persistence evidence: survives reload and a fresh sign-in. */
export function persistenceEvidence(root: string, screen: TaskScreenFile): boolean {
  const file = join(root, 'persistence', `${screen.replace(/\.tsx$/, '')}.json`);
  if (!existsSync(file)) return false;
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    return (
      parsed.hydratesFromServer === true &&
      parsed.survivesHubNavigation === true &&
      parsed.survivesHardReload === true &&
      parsed.survivesFreshSignIn === true &&
      parsed.realDatabaseAsserted === true
    );
  } catch {
    return false;
  }
}

export interface ScreenCredit {
  readonly screen: TaskScreenFile;
  readonly presentationMigrated: boolean;
  readonly productionRouteIntegrated: boolean;
  readonly realApiPersisted: boolean;
  /** Why it is not credited, for the report. Empty when fully credited. */
  readonly missing: readonly string[];
}

/**
 * Compute one screen's credit from artifacts alone.
 *
 * `conformant` is the only input that is not a file read: it comes from the
 * source-level gate, which is itself a computed check over the file rather
 * than a list someone edits.
 */
export function creditFor(
  root: string,
  screen: TaskScreenFile,
  conformant: boolean,
): ScreenCredit {
  const missing: string[] = [];
  const stateIds = SCREEN_STATES[screen];
  const states = PHASE5_STATES.filter((s) => stateIds.includes(s.id));

  if (!conformant) missing.push('source conformance');

  const cells = states.flatMap((state) =>
    LOCALES.map((locale) => canonicalCellEvidence(root, state, locale)),
  );
  const visualComplete = cells.length > 0 && cells.every(canonicalCellPasses);
  if (!visualComplete) missing.push('canonical 390x844 expected/actual/diff');

  const axeComplete = states.every((state) => LOCALES.every((l) => axeIsClean(root, state, l)));
  if (!axeComplete) missing.push('axe (EN and AR)');

  const route = routeEvidence(root, screen);
  const routeOk = route.present && route.interceptionFree;
  if (!routeOk) missing.push('real-HTTP flag-ON route evidence');

  const persisted = persistenceEvidence(root, screen);
  if (!persisted) missing.push('real-API persistence');

  return {
    screen,
    presentationMigrated: conformant && visualComplete && axeComplete,
    productionRouteIntegrated: conformant && visualComplete && axeComplete && routeOk,
    realApiPersisted: persisted && routeOk,
    missing,
  };
}

export interface Counters {
  readonly presentationMigrated: number;
  readonly productionRouteIntegrated: number;
  readonly realApiPersisted: number;
  readonly total: number;
}

export function countersFrom(credits: readonly ScreenCredit[]): Counters {
  return {
    presentationMigrated: credits.filter((c) => c.presentationMigrated).length,
    productionRouteIntegrated: credits.filter((c) => c.productionRouteIntegrated).length,
    realApiPersisted: credits.filter((c) => c.realApiPersisted).length,
    total: TASK_SCREENS.length,
  };
}

/** Artifact roots that exist, for reporting which runs produced evidence. */
export function provisionalRunIds(): string[] {
  if (!existsSync(PROVISIONAL_ROOT)) return [];
  return readdirSync(PROVISIONAL_ROOT, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);
}
