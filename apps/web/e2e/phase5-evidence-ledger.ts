import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PHASE5_STATES, type Phase5State } from './phase5-visual-states';

// Sprint 09B.29 Phase 5 — the evidence ledger.
//
// docs/provider-experience-v2/PHASE5_VERIFICATION.md
//
// WHY THIS EXISTS
//
// The conformance gate once carried a hand-written list of "migrated" screens.
// Adding a filename was enough to claim one — an assertion about work, written
// by the same change that was meant to prove it.
//
// WHY IT WAS REBUILT
//
// Replacing the list with file reads was not enough. The first ledger trusted
// a number written into JSON, accepted `{}` as a clean accessibility scan, and
// took a self-authored boolean as proof that a test ran without interception.
// Sixteen attack tests in `phase5-evidence-ledger.test.ts` produced the
// cheapest possible fake for each, and all sixteen passed.
//
// So nothing here believes a claim. A PNG must decode as a PNG, a ratio is
// bounded and must agree with the cell it is filed under, an axe result must
// carry its engine version and its WCAG tags and must not have disabled rules,
// and route and persistence evidence must agree with the run manifest they say
// they belong to. A self-authored boolean is not evidence.

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = join(HERE, '..');
const RESULTS = join(WEB_ROOT, 'test-results', 'phase5-visual');

/** Immutable, disjoint namespaces. A run is never overwritten or promoted. */
export const PROVISIONAL_ROOT = join(RESULTS, 'PROVISIONAL_UI');
export const FINAL_VISUAL_ROOT = join(RESULTS, 'FINAL_VISUAL');
export const FINAL_REAL_API_ROOT = join(RESULTS, 'FINAL_REAL_API');

export type EvidenceClass = 'PROVISIONAL_UI' | 'FINAL_VISUAL' | 'FINAL_REAL_API';

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
 * Which approved states each task controller renders.
 *
 * Credit is computed over these ids rather than over the file, so a screen is
 * only ever as migrated as the states it actually draws.
 */
export const SCREEN_STATES: Readonly<Record<TaskScreenFile, readonly number[]>> = Object.freeze({
  'BasicsTaskScreen.tsx': [3],
  'ServicesTaskScreen.tsx': [4, 5],
  'ServiceAreaTaskScreen.tsx': [6],
  'AvailabilityTaskScreen.tsx': [7],
  'PublicProfileTaskScreen.tsx': [8, 9],
  'ReviewTaskScreen.tsx': [11, 12, 13],
});

/** States owned by the shell and lifecycle surfaces rather than a task. */
export const NON_TASK_STATES = [0, 1, 2, 10, 14, 15, 16, 17] as const;

export const LOCALES = ['en', 'ar'] as const;
export type Locale = (typeof LOCALES)[number];

/**
 * The ONLY viewport a pixel comparison is geometrically valid at.
 *
 * The prototype has no genuine wide rendering, and 320x568 is a structural
 * cell for the same reason: there is no immutable reference to compare against,
 * so a "baseline" there would be one the application generated for itself.
 */
export const CANONICAL_VIEWPORT = { width: 390, height: 844 } as const;

export const RESPONSIVE_VIEWPORTS = [
  { width: 320, height: 568, pixelComparison: false },
  { width: 390, height: 844, pixelComparison: true },
  { width: 430, height: 932, pixelComparison: false },
  { width: 768, height: 1024, pixelComparison: false },
  { width: 1024, height: 768, pixelComparison: false },
  { width: 1440, height: 900, pixelComparison: false },
] as const;

export const MAX_DIFF_PIXEL_RATIO = 0.005;

/** WCAG tag set every scan must declare it ran. */
export const REQUIRED_AXE_TAGS = ['wcag2a', 'wcag2aa'] as const;

/** Mechanisms whose presence disqualifies route evidence. */
export const FORBIDDEN_MECHANISMS = [
  'page.route',
  'context.route',
  'route.fulfill',
  'har',
  'msw',
  'service-worker',
  'fixture-provider',
  'local-draft',
  'state-injection',
] as const;

/** What a run says about itself. Compared against, never taken on trust. */
export interface RunManifest {
  readonly runId?: string;
  readonly gitSha?: string;
  readonly bundleHash?: string;
  readonly apiOrigin?: string;
}

function readJson(file: string): Record<string, unknown> | null {
  if (!existsSync(file)) return null;
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * Is this file genuinely a PNG?
 *
 * The eight-byte signature plus a non-trivial length. A zero-byte file and a
 * sentence saved as `.png` both existed in the attack tests, and both passed
 * an `existsSync` check — which is all the first ledger did.
 */
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function isRealPng(file: string): boolean {
  if (!existsSync(file)) return false;
  try {
    if (statSync(file).size < PNG_SIGNATURE.length + 4) return false;
    const head = readFileSync(file).subarray(0, PNG_SIGNATURE.length);
    return head.equals(PNG_SIGNATURE);
  } catch {
    return false;
  }
}

export interface CanonicalCellEvidence {
  readonly stateId: number;
  readonly locale: Locale;
  readonly expected: boolean;
  readonly actual: boolean;
  readonly diff: boolean;
  readonly metricsValid: boolean;
  readonly identityMatches: boolean;
  readonly runId: string | null;
  readonly diffPixelRatio: number | null;
  readonly problems: readonly string[];
}

function cellDir(root: string, stateSlug: string, locale: Locale, width: number): string {
  return join(root, stateSlug, locale, String(width));
}

export function canonicalCellEvidence(
  root: string,
  state: Phase5State,
  locale: Locale,
): CanonicalCellEvidence {
  const dir = cellDir(root, state.slug, locale, CANONICAL_VIEWPORT.width);
  const problems: string[] = [];

  const expected = isRealPng(join(dir, 'expected.png'));
  const actual = isRealPng(join(dir, 'actual.png'));
  const diff = isRealPng(join(dir, 'diff.png'));
  if (!expected) problems.push('expected.png missing or not a PNG');
  if (!actual) problems.push('actual.png missing or not a PNG');
  if (!diff) problems.push('diff.png missing or not a PNG');

  const metrics = readJson(join(dir, 'metrics.json'));
  let ratio: number | null = null;
  let metricsValid = false;
  let identityMatches = true;

  if (metrics === null) {
    problems.push('metrics.json missing or unparseable');
  } else {
    const raw = metrics.diffPixelRatio;
    // Finite, and a genuine proportion. A negative number passed the first
    // ledger's `<= 0.005`, and so did Infinity once JSON turned 1e999 into it.
    if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 && raw <= 1) {
      ratio = raw;
      metricsValid = true;
    } else {
      problems.push(`diffPixelRatio is not a finite proportion: ${String(raw)}`);
    }

    // A cell must not claim to be a different state or language than the
    // directory it is filed under.
    if (metrics.stateId !== undefined && metrics.stateId !== state.id) {
      identityMatches = false;
      problems.push(`metrics claim state ${String(metrics.stateId)}, filed under ${state.id}`);
    }
    if (metrics.locale !== undefined && metrics.locale !== locale) {
      identityMatches = false;
      problems.push(`metrics claim locale ${String(metrics.locale)}, filed under ${locale}`);
    }
  }

  return {
    stateId: state.id,
    locale,
    expected,
    actual,
    diff,
    metricsValid,
    identityMatches,
    runId: typeof metrics?.runId === 'string' ? metrics.runId : null,
    diffPixelRatio: ratio,
    problems,
  };
}

export function canonicalCellPasses(e: CanonicalCellEvidence): boolean {
  return (
    e.expected &&
    e.actual &&
    e.diff &&
    e.metricsValid &&
    e.identityMatches &&
    e.diffPixelRatio !== null &&
    e.diffPixelRatio <= MAX_DIFF_PIXEL_RATIO
  );
}

/**
 * Was this accessibility scan real, complete and clean?
 *
 * `{}` has no violations only because it has nothing, so the schema itself is
 * checked: a violations ARRAY, the engine that produced it, the WCAG tags it
 * ran, and the state/locale/viewport it ran against. A scan that disabled a
 * rule or excluded part of the application is refused outright — that is how a
 * contrast failure becomes invisible.
 */
export function axeIsClean(root: string, state: Phase5State, locale: Locale): boolean {
  return axeResult(root, state, locale).clean;
}

export interface AxeResult {
  readonly clean: boolean;
  readonly runId: string | null;
  readonly problems: readonly string[];
}

export function axeResult(root: string, state: Phase5State, locale: Locale): AxeResult {
  const dir = cellDir(root, state.slug, locale, CANONICAL_VIEWPORT.width);
  const parsed = readJson(join(dir, 'axe.json'));
  const problems: string[] = [];

  if (parsed === null) return { clean: false, runId: null, problems: ['axe.json missing'] };

  if (!Array.isArray(parsed.violations)) problems.push('violations is not an array');
  else if (parsed.violations.length > 0) problems.push(`${parsed.violations.length} violation(s)`);

  const engine = parsed.testEngine as { name?: unknown; version?: unknown } | undefined;
  if (!engine || typeof engine.version !== 'string')
    problems.push('no axe engine version recorded');

  const tools = parsed.toolOptions as
    | { runOnly?: { values?: unknown }; rules?: Record<string, { enabled?: unknown }> }
    | undefined;
  const tags = Array.isArray(tools?.runOnly?.values) ? (tools!.runOnly!.values as string[]) : [];
  for (const required of REQUIRED_AXE_TAGS) {
    if (!tags.includes(required)) problems.push(`missing WCAG tag ${required}`);
  }
  if (tools?.rules && Object.values(tools.rules).some((r) => r?.enabled === false)) {
    problems.push('a rule was disabled');
  }

  if (parsed.stateId !== state.id) problems.push('scan is for a different state');
  if (parsed.locale !== locale) problems.push('scan is for a different locale');
  if (typeof parsed.url !== 'string') problems.push('no url recorded');
  const vp = parsed.viewport as { width?: unknown } | undefined;
  if (!vp || vp.width !== CANONICAL_VIEWPORT.width) problems.push('scan viewport is not canonical');

  return {
    clean: problems.length === 0,
    runId: typeof parsed.runId === 'string' ? parsed.runId : null,
    problems,
  };
}

export interface RouteEvidence {
  readonly screen: TaskScreenFile;
  readonly verified: boolean;
  readonly runId: string | null;
  readonly problems: readonly string[];
}

/**
 * Real-HTTP route evidence.
 *
 * `present && interceptionFree` was the first ledger's whole check, which made
 * a two-line JSON file sufficient. The marker must now agree with the run it
 * claims to belong to — the same commit, the same bundle — declare the flag
 * source it read, exit successfully, and list no mocking mechanism.
 */
export function routeEvidence(
  root: string,
  screen: TaskScreenFile,
  manifest: RunManifest = {},
): RouteEvidence {
  const file = join(root, 'route', `${screen.replace(/\.tsx$/, '')}.json`);
  const parsed = readJson(file);
  const problems: string[] = [];

  if (parsed === null) {
    return { screen, verified: false, runId: null, problems: ['route marker missing'] };
  }

  if (parsed.interceptionFree !== true) problems.push('interceptionFree not asserted');

  const mechanisms = Array.isArray(parsed.mechanisms) ? (parsed.mechanisms as string[]) : [];
  for (const m of mechanisms) {
    if (FORBIDDEN_MECHANISMS.some((f) => m.toLowerCase().includes(f))) {
      problems.push(`declares a mocking mechanism: ${m}`);
    }
  }

  if (typeof parsed.gitSha !== 'string') problems.push('no gitSha');
  else if (manifest.gitSha && parsed.gitSha !== manifest.gitSha) problems.push('stale gitSha');

  if (typeof parsed.bundleHash !== 'string') problems.push('no bundleHash');
  else if (manifest.bundleHash && parsed.bundleHash !== manifest.bundleHash) {
    problems.push('stale bundleHash');
  }

  if (typeof parsed.apiOrigin !== 'string') problems.push('no apiOrigin');
  if (typeof parsed.flagSource !== 'string') problems.push('no flagSource');
  if (parsed.flagValue !== true) problems.push('V2 flag was not ON');
  if (typeof parsed.route !== 'string') problems.push('no route');
  if (parsed.exitStatus !== 0) problems.push(`test exit status ${String(parsed.exitStatus)}`);

  return {
    screen,
    verified: problems.length === 0,
    runId: typeof parsed.runId === 'string' ? parsed.runId : null,
    problems,
  };
}

export interface PersistenceEvidence {
  readonly screen: TaskScreenFile;
  readonly verified: boolean;
  readonly runId: string | null;
  readonly problems: readonly string[];
}

/**
 * Real persistence evidence.
 *
 * A file of hand-written `true` booleans passed the first ledger. What is
 * required now is what a real test can only produce by actually running: the
 * values before and after, the revision the server acknowledged, what was
 * observed after a reload and after a fresh sign-in, the values read
 * independently from PostgreSQL, and which database they came from.
 *
 * The observations must AGREE with what was saved. A reload that returned the
 * old value is a failed persistence test, not a passing one.
 */
export function persistenceEvidence(
  root: string,
  screen: TaskScreenFile,
  manifest: RunManifest = {},
): PersistenceEvidence {
  const file = join(root, 'persistence', `${screen.replace(/\.tsx$/, '')}.json`);
  const parsed = readJson(file);
  const problems: string[] = [];

  if (parsed === null) {
    return { screen, verified: false, runId: null, problems: ['persistence marker missing'] };
  }

  const before = parsed.before as Record<string, unknown> | undefined;
  const after = parsed.after as Record<string, unknown> | undefined;
  const reload = parsed.observedAfterReload as Record<string, unknown> | undefined;
  const fresh = parsed.observedAfterFreshSignIn as Record<string, unknown> | undefined;
  const db = parsed.databaseValues as Record<string, unknown> | undefined;

  if (!before || !after) problems.push('no before/after values recorded');
  if (typeof parsed.acknowledgedVersion !== 'number') {
    problems.push('no acknowledged server revision');
  }
  if (typeof parsed.databaseSystemId !== 'string') problems.push('no database system identifier');
  if (!reload) problems.push('nothing observed after reload');
  if (!fresh) problems.push('nothing observed after a fresh sign-in');
  if (!db) problems.push('no independent database values');

  // The observations have to match what was saved, or the test disproved
  // persistence rather than proving it.
  const same = (a: Record<string, unknown> | undefined, b: Record<string, unknown> | undefined) =>
    a && b && JSON.stringify(a) === JSON.stringify(b);
  if (after && reload && !same(after, reload))
    problems.push('reload disagrees with what was saved');
  if (after && fresh && !same(after, fresh)) problems.push('fresh sign-in disagrees');
  if (after && db && !same(after, db)) problems.push('database disagrees');

  if (manifest.gitSha && parsed.gitSha !== undefined && parsed.gitSha !== manifest.gitSha) {
    problems.push('stale gitSha');
  }

  return {
    screen,
    verified: problems.length === 0,
    runId: typeof parsed.runId === 'string' ? parsed.runId : null,
    problems,
  };
}

/** Missing evidence, in three independent groups. */
export interface MissingEvidence {
  readonly presentation: readonly string[];
  readonly route: readonly string[];
  readonly persistence: readonly string[];
}

export interface ScreenCredit {
  readonly screen: TaskScreenFile;
  readonly presentationMigrated: boolean;
  readonly productionRouteIntegrated: boolean;
  readonly realApiPersisted: boolean;
  readonly missing: MissingEvidence;
}

/**
 * One screen's credit, computed from artifacts.
 *
 * The three levels are strictly nested per SCREEN, not merely in aggregate:
 * persistence without a verified route, or a route without a credited
 * presentation, is incoherent — the data survived a reload of a screen nobody
 * has shown renders correctly.
 */
export function creditFor(
  root: string,
  screen: TaskScreenFile,
  sourceConformant: boolean,
  manifest: RunManifest = {},
): ScreenCredit {
  const presentation: string[] = [];
  const route: string[] = [];
  const persistence: string[] = [];

  if (!sourceConformant) presentation.push('source conformance');

  const states = PHASE5_STATES.filter((s) => SCREEN_STATES[screen].includes(s.id));
  const runIds = new Set<string>();

  for (const state of states) {
    for (const locale of LOCALES) {
      const cell = canonicalCellEvidence(root, state, locale);
      if (!canonicalCellPasses(cell)) {
        presentation.push(
          `visual ${state.slug}/${locale}: ${cell.problems.join('; ') || 'incomplete'}`,
        );
      }
      if (cell.runId) runIds.add(cell.runId);

      const axe = axeResult(root, state, locale);
      if (!axe.clean) presentation.push(`axe ${state.slug}/${locale}: ${axe.problems.join('; ')}`);
      if (axe.runId) runIds.add(axe.runId);
    }
  }

  // Artifacts from two different runs describe two different builds. Mixing
  // them is how a stale pass survives a change that broke it.
  if (runIds.size > 1) {
    presentation.push(`evidence mixes runs: ${[...runIds].join(', ')}`);
  }
  if (manifest.runId && runIds.size === 1 && !runIds.has(manifest.runId)) {
    presentation.push('evidence belongs to a different run than the manifest');
  }

  const routeEv = routeEvidence(root, screen, manifest);
  if (!routeEv.verified) route.push(...routeEv.problems);

  const persistEv = persistenceEvidence(root, screen, manifest);
  if (!persistEv.verified) persistence.push(...persistEv.problems);

  const presentationMigrated = presentation.length === 0;
  const productionRouteIntegrated = presentationMigrated && routeEv.verified;
  const realApiPersisted = productionRouteIntegrated && persistEv.verified;

  return {
    screen,
    presentationMigrated,
    productionRouteIntegrated,
    realApiPersisted,
    missing: { presentation, route, persistence },
  };
}

export interface Counters {
  readonly presentationMigrated: number;
  readonly productionRouteIntegrated: number;
  readonly realApiPersisted: number;
  readonly total: number;
}

export function countersFrom(credits: readonly ScreenCredit[]): Counters {
  // Monotonicity is a property of each screen, asserted where it is computed.
  for (const c of credits) {
    if (c.realApiPersisted && !c.productionRouteIntegrated) {
      throw new Error(`${c.screen}: persisted credited without a verified route`);
    }
    if (c.productionRouteIntegrated && !c.presentationMigrated) {
      throw new Error(`${c.screen}: route credited without presentation`);
    }
  }

  return {
    presentationMigrated: credits.filter((c) => c.presentationMigrated).length,
    productionRouteIntegrated: credits.filter((c) => c.productionRouteIntegrated).length,
    realApiPersisted: credits.filter((c) => c.realApiPersisted).length,
    total: TASK_SCREENS.length,
  };
}

/** Run directories that exist, for reporting which runs produced evidence. */
export function runIdsUnder(root: string): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);
}
