import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { verifyCanonicalCell } from './phase5-image-verify';
import { PHASE5_STATES, PHASE5_VIEWPORTS, type Phase5State } from './phase5-visual-states';

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

/**
 * The responsive matrix, DERIVED from the state registry.
 *
 * Sprint 09B.29 — this used to be a second hand-written copy of the same list
 * that `PHASE5_VIEWPORTS` holds, and the two were free to disagree. They did:
 * adding 393x852 to the registry moved the registry's own unit test from 216 to
 * 252 records and changed nothing about what the browser actually visited,
 * because the spec iterates THIS array. A passing count over a list nobody runs
 * is the same vacuous shape as a testid no component renders.
 *
 * One source now. `pixelComparison` is the registry's `mode`, which is the only
 * thing this shape added.
 */
export const RESPONSIVE_VIEWPORTS = PHASE5_VIEWPORTS.map((v) => ({
  width: v.width,
  height: v.height,
  pixelComparison: v.mode === 'pixel',
}));

export const MAX_DIFF_PIXEL_RATIO = 0.005;

/** The user's September repair brief replaces the static map, hidden schedule,
 * suggested-only title and unexplained photo requirement on these four states.
 * The immutable prototype remains captured and measured for review, but these
 * cells earn revised presentation acceptance, not prototype pixel parity.
 * There is deliberately no environment switch or artifact-controlled allowlist. */
export const ONBOARDING_REPAIR_REVISION = 'USER_REQUEST_2026_09_ONBOARDING_REPAIR';
export const REVISED_PRESENTATION_STATES = Object.freeze([6, 7, 8, 9] as const);

export interface RevisionCheck {
  readonly key: string;
  readonly selector: string;
  readonly texts?: readonly string[];
  readonly count: number;
  readonly minWidth: number;
  readonly minHeight: number;
}

/** Expected words are owned by acceptance, not imported from component copy. */
export function revisionChecks(stateId: number, locale: Locale): readonly RevisionCheck[] {
  const ar = locale === 'ar';
  const target = (key: string, selector: string, text: string): RevisionCheck => ({
    key,
    selector,
    texts: [text],
    count: 1,
    minWidth: 44,
    minHeight: 44,
  });
  if (stateId === 6)
    return [
      {
        key: 'interactive-map',
        selector: '[data-testid="service-area-map"] .leaflet-container[tabindex="0"]',
        count: 1,
        minWidth: 280,
        minHeight: 240,
      },
      {
        key: 'map-pane',
        selector: '[data-testid="service-area-map"] .leaflet-map-pane',
        count: 1,
        minWidth: 0,
        minHeight: 0,
      },
      target(
        'device-location',
        '[data-testid="service-area-locate"]',
        ar ? 'استخدام موقعي الحالي' : 'Use my current location',
      ),
      target(
        'map-centre',
        '[data-testid="service-area-use-centre"]',
        ar ? 'استخدام وسط الخريطة' : 'Use map centre',
      ),
      target(
        'zoom-in',
        `[data-testid="service-area-map"] button[aria-label="${ar ? 'تكبير الخريطة' : 'Zoom in'}"]`,
        ar ? 'تكبير الخريطة' : 'Zoom in',
      ),
      target(
        'zoom-out',
        `[data-testid="service-area-map"] button[aria-label="${ar ? 'تصغير الخريطة' : 'Zoom out'}"]`,
        ar ? 'تصغير الخريطة' : 'Zoom out',
      ),
    ];
  if (stateId === 7) {
    const days = ar
      ? ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت']
      : ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    return [
      {
        key: 'weekly-table',
        selector: '[data-testid="availability-week-summary"] table',
        count: 1,
        minWidth: 280,
        minHeight: 280,
      },
      ...days.map((day, index) => ({
        key: `day-${index}`,
        selector: `[data-testid="availability-summary-day-${index}"]`,
        texts: [`${day} ${index < 5 ? '09:00–17:00' : ar ? 'غير متاح' : 'Unavailable'}`],
        count: 1,
        minWidth: 280,
        minHeight: 36,
      })),
    ];
  }
  if (stateId === 8)
    return [
      {
        key: 'stored-title',
        selector: '[data-testid="preview-title"]',
        texts: ['Painting professional'],
        count: 1,
        minWidth: 40,
        minHeight: 10,
      },
    ];
  if (stateId === 9)
    return [
      {
        key: 'optional-photos',
        selector: '[data-testid="portfolio-optional-hint"]',
        texts: [
          ar
            ? 'صور الأعمال اختيارية. أضف أمثلة من أعمالك؛ مراجعة الصور لا تمنع إكمال طلبك.'
            : 'Work photos are optional. Add examples of your own work; photo review does not stop you completing your application.',
        ],
        count: 1,
        minWidth: 280,
        minHeight: 20,
      },
    ];
  return [];
}

type MeasuredRect = { x: number; y: number; width: number; height: number };
function measuredRect(value: unknown): value is MeasuredRect {
  if (!value || typeof value !== 'object') return false;
  const rect = value as Record<string, unknown>;
  return (
    ['x', 'y', 'width', 'height'].every(
      (key) => typeof rect[key] === 'number' && Number.isFinite(rect[key]),
    ) &&
    (rect.width as number) >= 0 &&
    (rect.height as number) >= 0
  );
}

/** Same-run DOM observations supplement, never replace, PNG integrity and axe.
 * Functional interaction/persistence remains a separate real-API requirement. */
export function revisionProblems(
  parsed: Record<string, unknown> | null,
  state: Phase5State,
  locale: Locale,
  runId: string | null,
): string[] {
  if (!revisionChecks(state.id, locale).length) return [];
  if (!parsed) return ['revision.json missing or unparseable'];
  const problems: string[] = [];
  if (parsed.revision !== ONBOARDING_REPAIR_REVISION)
    problems.push('unknown presentation revision');
  if (!runId || parsed.runId !== runId)
    problems.push('revision belongs to a different or missing run');
  if (parsed.stateId !== state.id || parsed.locale !== locale || parsed.route !== state.route)
    problems.push('revision identity disagrees with the canonical cell');
  const viewport = parsed.viewport as Record<string, unknown> | undefined;
  if (viewport?.width !== 390 || viewport?.height !== 844)
    problems.push('revision viewport is not canonical');
  if (parsed.lang !== locale || parsed.dir !== (locale === 'ar' ? 'rtl' : 'ltr'))
    problems.push('revision language or direction is incorrect');
  if (
    typeof parsed.documentWidth !== 'number' ||
    !Number.isFinite(parsed.documentWidth) ||
    parsed.documentWidth < 390 ||
    parsed.documentWidth > 391
  )
    problems.push('revision has horizontal overflow or no width measurement');
  const shell = parsed.shell;
  if (
    !measuredRect(shell) ||
    Math.abs(shell.x) > 1 ||
    Math.abs(shell.width - 390) > 1 ||
    Math.abs(shell.height - 844) > 1
  )
    problems.push('revision shell geometry is incorrect');
  const main = parsed.main;
  const footer = parsed.footer;
  if (
    !measuredRect(main) ||
    !measuredRect(footer) ||
    main.height <= 0 ||
    footer.height <= 0 ||
    main.y + main.height > footer.y + 1 ||
    footer.y + footer.height > 845
  )
    problems.push('revision footer covers the scrollable content');
  const elements = Array.isArray(parsed.elements) ? parsed.elements : [];
  for (const check of revisionChecks(state.id, locale)) {
    const matches = elements.filter(
      (item) => item && typeof item === 'object' && item.key === check.key,
    );
    const observation = matches.length === 1 ? matches[0] : null;
    if (
      !observation ||
      !Array.isArray(observation.rects) ||
      observation.rects.length !== check.count ||
      !Array.isArray(observation.texts) ||
      observation.texts.length !== check.count
    ) {
      problems.push(`revision ${check.key}: missing or duplicate observations`);
      continue;
    }
    if (check.texts && JSON.stringify(observation.texts) !== JSON.stringify(check.texts))
      problems.push(`revision ${check.key}: incorrect rendered text`);
    for (const rect of observation.rects) {
      if (
        !measuredRect(rect) ||
        rect.width < check.minWidth ||
        rect.height < check.minHeight ||
        (check.key !== 'map-pane' && (rect.x < -1 || rect.x + rect.width > 391))
      )
        problems.push(`revision ${check.key}: missing, clipped or undersized geometry`);
    }
  }
  return problems;
}

/** WCAG tag set every scan must declare it ran. */
/**
 * The WCAG tag set every scan must declare it ran.
 *
 * Sprint 09B.29 Phase 5B — widened from 2.0 alone.
 *
 * `wcag2a`/`wcag2aa` are WCAG **2.0**. The acceptance criteria name WCAG 2.2
 * AA, and 2.2 is cumulative: it contains 2.1, which contains 2.0. Running only
 * the 2.0 tags therefore skipped every success criterion added since 2008 —
 * among them target size, focus appearance, dragging movements, reflow, and
 * orientation, which are exactly the criteria a phone-first onboarding flow is
 * most likely to break.
 *
 * Requiring the tags here is what makes the omission impossible to repeat: a
 * scan that does not DECLARE these tags is refused by the ledger, so narrowing
 * the scan narrows the evidence rather than quietly narrowing the gate.
 *
 * WHAT THIS IS STILL NOT. Automated rules detect a minority of WCAG failures.
 * A clean scan across these tags is necessary and nowhere near sufficient, and
 * nothing in this repository may describe it as WCAG certification — see
 * PHASE5_VERIFICATION.md for the checks that require a human.
 */
export const REQUIRED_AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] as const;

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

/**
 * Read a JSON artifact, or nothing.
 *
 * READ FIRST, ASK NOTHING. An `existsSync` before the read is a
 * time-of-check/time-of-use window — CodeQL `js/file-system-race` flagged
 * exactly that here, at high severity, and it was right: between the check and
 * the read the file can be replaced, and a verifier that can be raced is not a
 * verifier. Attempting the read and handling its failure is one syscall path
 * with no window, and it is simpler.
 */
function readJson(file: string): Record<string, unknown> | null {
  let raw: string;
  try {
    raw = readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
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
  /** What the METRICS FILE claims. A claim, never a verdict. */
  readonly diffPixelRatio: number | null;
  /**
   * What the decoded pixels actually measure, or null when the pair could not
   * be compared at all.
   *
   * This is the number that decides. The stored one is kept beside it only so
   * a disagreement can be reported.
   */
  readonly recomputedRatio: number | null;
  /** Every check in the image verifier passed. */
  readonly imageOk: boolean;
  /** A scoped, validated repair brief replaces parity only for states 6–9. */
  readonly revisedPresentationAccepted?: boolean;
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

  // The images are DECODED and the difference RECOMPUTED by the verifier;
  // this function only reports what it found. A signature check could not tell
  // a 390x844 capture from a 10x10 one, nor a real diff from a blank one.
  const image = verifyCanonicalCell(dir);
  const expected = !image.problems.some((p) => p.includes('expected.png'));
  const actual = !image.problems.some((p) => p.includes('actual.png'));
  const diff = !image.problems.some((p) => p.includes('diff.png'));

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

  const revised = revisionChecks(state.id, locale).length > 0;
  const revisionIssues = revised
    ? revisionProblems(
        readJson(join(dir, 'revision.json')),
        state,
        locale,
        typeof metrics?.runId === 'string' ? metrics.runId : null,
      )
    : [];
  problems.push(...revisionIssues);
  const revisedPresentationAccepted = revised && revisionIssues.length === 0;
  // The old prototype still supplies an honest measured diff. Only its ratio
  // budget is superseded by the explicit user brief; malformed PNGs, geometry,
  // forged metrics and a false diff remain fatal. No threshold is widened.
  const imageProblems = image.problems.filter(
    (problem) =>
      !(
        revisedPresentationAccepted &&
        /^recomputed diffPixelRatio [0-9.]+ exceeds 0\.005$/.test(problem)
      ),
  );
  problems.push(...imageProblems);

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
    recomputedRatio: image.recomputedRatio,
    imageOk: imageProblems.length === 0,
    revisedPresentationAccepted,
    problems,
  };
}

/**
 * Does this cell pass? FAIL CLOSED.
 *
 * Sprint 09B.29 Phase 5B — this used to decide on the STORED ratio.
 *
 * `verifyCanonicalCell` already decoded both images, recomputed the difference
 * and compared it against the stored claim. Every one of those findings landed
 * in `problems` — and this function read none of them. It checked three
 * booleans derived by substring-matching problem strings, the stored number,
 * and nothing else. So "recomputed diffPixelRatio exceeds 0.005" and "stored
 * and recomputed ratios disagree" were both computed, written down, and
 * ignored: a metrics file claiming 0.001 over two wholly different images
 * passed.
 *
 * The rule now is the one the evidence design always intended. A cell passes
 * only when the verifier is clean, NOTHING was reported against it, the
 * difference was genuinely RECOMPUTED, and that recomputed difference is
 * within budget for the immutable screens. The four explicitly revised states
 * additionally require the repair's semantic and geometry observations even
 * when their ratio is zero. The stored ratio can establish nothing on its own;
 * it is checked against the measurement rather than trusted instead of it.
 */
export function canonicalCellPasses(e: CanonicalCellEvidence): boolean {
  return (
    e.imageOk &&
    e.problems.length === 0 &&
    e.expected &&
    e.actual &&
    e.diff &&
    e.metricsValid &&
    e.identityMatches &&
    // RECOMPUTED, not stored. A comparison that could not be performed is not
    // a pass — it is an absence of evidence.
    e.recomputedRatio !== null &&
    (revisionChecks(e.stateId, e.locale).length > 0
      ? e.revisedPresentationAccepted === true
      : e.recomputedRatio <= MAX_DIFF_PIXEL_RATIO) &&
    e.diffPixelRatio !== null
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
  /**
   * Where the REAL-API markers live, when that is not `root`.
   *
   * Sprint 09B.29 Phase 5B. Presentation evidence and real-API evidence are
   * filed under two namespaces on purpose — `PROVISIONAL_UI` for the stubbed
   * visual run, `FINAL_REAL_API` for the un-stubbed one — and this function
   * used to take a single root and look for all three kinds of evidence under
   * it. So route and persistence were read from `PROVISIONAL_UI/route`, which
   * the visual run never writes and the real-API run never writes to.
   *
   * The counters were therefore pinned at 0/6 by arithmetic, not by absence:
   * six route markers and six persistence markers could sit on disk, correct
   * and complete, and the ledger would still report nothing. That is worse
   * than a missing file, because the fix looks like more testing when it is
   * actually one argument.
   *
   * Defaults to `root` so a test that builds all three under one temporary
   * directory still exercises the mechanism.
   */
  realApiRoot: string = root,
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

  const routeEv = routeEvidence(realApiRoot, screen, manifest);
  if (!routeEv.verified) route.push(...routeEv.problems);

  const persistEv = persistenceEvidence(realApiRoot, screen, manifest);
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
  // Same reason as the readers above: attempt it, handle the failure. An
  // absent directory and an unreadable one are both "no runs here".
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return [];
  }
}
