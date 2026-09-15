import { readFileSync } from 'node:fs';

// Sprint 09B.29 Phase 5 — proving a spec is interception-free by reading it.
//
// docs/provider-experience-v2/PHASE5_VERIFICATION.md
//
// WHY A SELF-DECLARED BOOLEAN WAS NEVER EVIDENCE
//
// Route credit used to require a marker file saying `interceptionFree: true`.
// A spec that mocks every request can write that line exactly as easily as one
// that mocks nothing, so the field recorded an intention, not a fact.
//
// This reads the spec that produced the evidence and reports what it actually
// contains. It is deliberately only HALF the answer — a static scan cannot see
// a mock installed by a helper it does not follow — so the ledger pairs it
// with network evidence recorded during the run itself. Together they close
// both directions: the code cannot claim what it does not do, and the run
// cannot hide what it did.

export interface MockingFinding {
  readonly mechanism: string;
  readonly line: number;
  readonly text: string;
}

export interface SpecScanResult {
  readonly file: string;
  readonly clean: boolean;
  readonly findings: readonly MockingFinding[];
}

/**
 * Mechanisms that disqualify a spec from producing route evidence.
 *
 * Each is a way of answering a request without the server answering it, or of
 * putting state into the browser that the server did not send.
 */
const MECHANISMS: ReadonlyArray<{ name: string; pattern: RegExp }> = [
  { name: 'page.route', pattern: /\bpage\s*\.\s*route\s*\(/ },
  { name: 'context.route', pattern: /\bcontext\s*\.\s*route\s*\(/ },
  { name: 'route.fulfill', pattern: /\.\s*fulfill\s*\(/ },
  { name: 'routeFromHAR', pattern: /\.\s*routeFromHAR\s*\(/ },
  { name: 'msw', pattern: /\bfrom\s+['"]msw|setupWorker|setupServer\b/ },
  { name: 'serviceWorker', pattern: /\bserviceWorker\s*\.\s*register\b/ },
  { name: 'localStorage-seed', pattern: /localStorage\s*\.\s*setItem\s*\(/ },
  { name: 'sessionStorage-seed', pattern: /sessionStorage\s*\.\s*setItem\s*\(/ },
];

/**
 * Is this line code, or prose about code?
 *
 * A spec that documents "this deliberately does NOT use page.route" must not
 * be failed by the sentence saying so. Only line comments and the common block
 * forms are recognised; a mechanism hidden inside a template literal is still
 * reported, because that is how it would run.
 */
function isComment(line: string): boolean {
  const t = line.trim();
  return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*');
}

/**
 * A URL that merely contains the word "route" is not interception.
 *
 * The patterns above already require a call shape — `page.route(` — so a path
 * like `/provider/onboarding/route-test` does not match. This only guards the
 * looser `.fulfill(` pattern from a string that happens to contain it.
 */
function isLikelyString(line: string, index: number): boolean {
  const before = line.slice(0, index);
  const quotes = (before.match(/['"`]/g) ?? []).length;
  return quotes % 2 === 1;
}

export function scanSpecForMocking(file: string): SpecScanResult {
  let source: string;
  try {
    source = readFileSync(file, 'utf8');
  } catch {
    // A spec that cannot be read cannot be vouched for.
    return { file, clean: false, findings: [{ mechanism: 'unreadable', line: 0, text: '' }] };
  }

  const findings: MockingFinding[] = [];
  const lines = source.split('\n');

  lines.forEach((line, i) => {
    if (isComment(line)) return;
    for (const { name, pattern } of MECHANISMS) {
      const match = pattern.exec(line);
      if (!match) continue;
      if (isLikelyString(line, match.index)) continue;
      findings.push({ mechanism: name, line: i + 1, text: line.trim().slice(0, 120) });
    }
  });

  return { file, clean: findings.length === 0, findings };
}

/** Network evidence recorded BY the run, to pair with the static scan. */
export interface ObservedNetwork {
  /** Requests the browser actually issued to the API origin. */
  readonly apiRequests: number;
  /** Responses served by something other than the server. Must be zero. */
  readonly fulfilledLocally: number;
  readonly apiOrigin: string;
}

/**
 * Both halves must agree before a run counts as interception-free.
 *
 * The scan proves the code contains no mocking; the observation proves the run
 * reached a real server. A spec can be clean and still have talked to nothing
 * — for example if every assertion was skipped — so a run with zero API
 * requests is refused as well.
 */
export function isInterceptionFree(
  scan: SpecScanResult,
  observed: ObservedNetwork | null,
): { ok: boolean; problems: string[] } {
  const problems: string[] = [];

  if (!scan.clean) {
    problems.push(
      `spec contains ${scan.findings.length} mocking mechanism(s): ` +
        scan.findings.map((f) => `${f.mechanism}@${f.line}`).join(', '),
    );
  }

  if (!observed) {
    problems.push('no network observation was recorded for the run');
  } else {
    if (observed.fulfilledLocally > 0) {
      problems.push(`${observed.fulfilledLocally} response(s) were served locally`);
    }
    if (observed.apiRequests <= 0) {
      problems.push('the run issued no requests to the API origin');
    }
  }

  return { ok: problems.length === 0, problems };
}
