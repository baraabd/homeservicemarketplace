import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// Sprint 09B.29 Phase 5B — does the testid a spec reaches for actually exist?
//
// docs/provider-experience-v2/PHASE5A_INTEGRATION_GAPS.md
//
// WHY THIS EXISTS
//
// Eight of the twelve failures in the first Phase 5B real-API run were specs
// naming testids that no component renders any more. The Phase 5A visual
// migration rebuilt the six task screens against the approved prototype and
// renamed or removed controls as it went — `radius-slider` became a stated
// fact, `title-input` went away with the server-generated title,
// `preset-sun-thu` became seven day toggles, `years-of-experience` became a
// stepper called `experience-years` — and nothing connected either side.
//
// The cost was not the failures. It was the SILENCE before them:
//
//   const years = page.getByTestId('years-of-experience');   // never existed
//   if (await years.count()) { await years.fill('9'); }
//
// guarded on `count()`, that spec passed for a whole sprint while touching
// nothing at all. A test that cannot find its control and shrugs is worse than
// a failing one, and no browser run can report it.
//
// A static check, deliberately: it costs no browser and runs in the unit gate,
// so a renamed testid is caught in seconds by whoever renamed it.
//
// WHAT IT DOES NOT DO
//
// It does not prove a testid is REACHABLE in a given state — that is what the
// browser suites are for. It proves only that the string a spec asks for is a
// string some component can emit. That is the half that was missing.
//
// IT MUST PREFER MISSING A STALE ID TO BLOCKING AN HONEST SPEC
//
// So collection is generous and matching is lenient. Every shape below is one
// this codebase actually uses, and each was added because leaving it out
// produced a false positive on a spec that was perfectly correct.

export interface TestIdUse {
  readonly file: string;
  readonly line: number;
  /** The literal text, or the fixed part of a template. */
  readonly value: string;
  /** True when the source was a template and `value` is only its fixed head. */
  readonly isPrefix: boolean;
}

export interface RenderedTestIds {
  /** Names a component emits verbatim. */
  readonly exact: Set<string>;
  /** Fixed heads of templates — `axis-` from `` `axis-${row.id}` ``. */
  readonly prefixes: Set<string>;
  /**
   * Fixed TAILS of templates.
   *
   * `AutosaveStatus` renders `` `${testIdPrefix}-save-status` ``: the variable
   * comes first, so there is no prefix at all and the only fixed part is the
   * end. Every `task-save-status` assertion in the suite depends on this, and
   * a prefix-only collector calls all of them stale.
   */
  readonly suffixes: Set<string>;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

/** Record a template's fixed head and tail, ignoring empty ones. */
function addTemplate(raw: string, into: RenderedTestIds): void {
  const head = raw.indexOf('${');
  if (head === -1) {
    into.exact.add(raw);
    return;
  }
  if (head > 0) into.prefixes.add(raw.slice(0, head));
  const lastClose = raw.lastIndexOf('}');
  if (lastClose !== -1 && lastClose < raw.length - 1) {
    into.suffixes.add(raw.slice(lastClose + 1));
  }
}

/**
 * Every testid any component can render.
 *
 * Four shapes, because the codebase uses all four:
 *
 *   data-testid="literal"                   the common case
 *   data-testid={cond ? 'a' : 'b'}          a ternary — both branches count
 *   data-testid={`axis-${row.id}`}          a family, kept as its fixed part
 *   primaryTestId: 'review-submit'          a name held in a copy table and
 *                                           spread onto an element elsewhere
 *
 * The last two are why this is not a one-line regex. `review-submit` lives in
 * `task-chrome-copy.ts` as a property and reaches the DOM through
 * `data-testid={primary.testId}`, so no attribute in the source ever spells it.
 */
export function renderedTestIds(srcDir: string): RenderedTestIds {
  const found: RenderedTestIds = {
    exact: new Set<string>(),
    prefixes: new Set<string>(),
    suffixes: new Set<string>(),
  };

  // Production components only. A unit test's own fixture is not a component,
  // and treating one as renderable is not a harmless over-count: the
  // `ProviderStepper` spec renders `testId="years"`, which as a family prefix
  // resolved `years-of-experience` — the single most misleading locator in the
  // suite, and the one this guard exists to name.
  const isTest = (f: string) => /\.(test|spec)\.tsx?$/.test(f);

  for (const file of walk(srcDir).filter((f) => !isTest(f))) {
    const text = readFileSync(file, 'utf8');

    // data-testid="literal" and testId="literal"
    for (const m of text.matchAll(/(?:data-testid|testId)=["']([^"']+)["']/g)) {
      found.exact.add(m[1]);
      // A primitive may append its own suffix to a `testId` it is handed —
      // `ProviderStepper` turns `experience-years` into `-decrease`, `-value`
      // and `-increase` — so the name it was given is also a prefix.
      found.prefixes.add(m[1]);
    }

    // Any testid-ish name followed by a `{...}` expression, read to its own
    // closing brace so a multi-line ternary is covered.
    //
    // Anchored on the expression, not on a fixed window of characters. A
    // 240-character window was tried and is why this comment exists: it
    // harvested every unrelated literal nearby into the set of "names a
    // component can render", and three of the four stale ids this guard was
    // built to catch resolved against that noise. A guard that collects
    // generously does not fail safe — it stops failing at all.
    //
    // Plain brace counting is enough: `${x}` contributes one `{` and one `}`,
    // so it balances, and no testid expression in this codebase contains a
    // brace inside a string.
    for (const m of text.matchAll(/[\w-]*[Tt]est-?[Ii]d\w*\s*=\s*\{/g)) {
      const open = m.index + m[0].length - 1;
      let depth = 0;
      let end = open;
      for (let i = open; i < text.length; i += 1) {
        if (text[i] === '{') depth += 1;
        else if (text[i] === '}') {
          depth -= 1;
          if (depth === 0) {
            end = i;
            break;
          }
        }
      }
      const expr = text.slice(open + 1, end);
      for (const lit of expr.matchAll(/'([^'\n]+)'|"([^"\n]+)"/g)) {
        found.exact.add(lit[1] ?? lit[2]);
      }
      for (const tpl of expr.matchAll(/`([^`\n]*)`/g)) addTemplate(tpl[1], found);
    }

    // A testid held in a table: `primaryTestId: 'review-submit'`, `testId: 'x'`.
    for (const m of text.matchAll(/\b\w*[tT]est[iI]d\w*\s*:\s*['"]([^'"]+)['"]/g)) {
      found.exact.add(m[1]);
      found.prefixes.add(m[1]);
    }

    // A bare template assigned to such a property.
    for (const m of text.matchAll(/\b\w*[tT]est[iI]d\w*\s*:\s*`([^`]*)`/g)) {
      addTemplate(m[1], found);
    }
  }

  return found;
}

/**
 * Every `getByTestId(...)` in a spec directory.
 *
 * Absence assertions are skipped. `expect(getByTestId('title-input'))
 * .toHaveCount(0)` is a deliberate statement that a control stayed gone —
 * ruling C1 removed the provider-type chooser and the legal-business-name
 * field, and those assertions are how that ruling is enforced. Naming an id
 * nothing renders is the POINT there, not a mistake.
 */
export function testIdUses(e2eDir: string): TestIdUse[] {
  const uses: TestIdUse[] = [];
  const ABSENCE = /toHaveCount\(\s*0\s*\)|\.not\./;

  // Only `.spec.ts` files. The helpers beside them — this module included —
  // quote testids in their own prose, and a doc comment is not a locator.
  for (const file of walk(e2eDir).filter((f) => f.endsWith('.spec.ts'))) {
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, index) => {
      if (ABSENCE.test(line)) return;
      for (const m of line.matchAll(/getByTestId\(\s*(["'`])([^"'`]*)\1?/g)) {
        const raw = m[2];
        if (m[1] === '`') {
          const cut = raw.indexOf('${');
          uses.push({
            file,
            line: index + 1,
            value: cut === -1 ? raw : raw.slice(0, cut),
            isPrefix: cut !== -1,
          });
        } else {
          uses.push({ file, line: index + 1, value: raw, isPrefix: false });
        }
      }
    });
  }

  return uses;
}

/**
 * Uses that no component can satisfy.
 *
 * Conservative on purpose: reported only when the string matches no literal,
 * is not covered by any family prefix or tail, and is not itself the fixed head
 * of some literal. What is left is a name nothing in the source could produce,
 * which so far has always been a control that was renamed or removed.
 */
export function unresolvableTestIds(
  uses: readonly TestIdUse[],
  rendered: RenderedTestIds,
): TestIdUse[] {
  const exact = [...rendered.exact];
  const prefixes = [...rendered.prefixes].filter((p) => p !== '');
  const suffixes = [...rendered.suffixes].filter((p) => p !== '');

  return uses.filter((use) => {
    if (rendered.exact.has(use.value)) return false;
    if (prefixes.some((p) => use.value.startsWith(p))) return false;
    if (suffixes.some((sfx) => use.value.endsWith(sfx))) return false;
    // The spec built the name from a variable and some literal begins with the
    // fixed part it did supply.
    if (use.isPrefix && exact.some((name) => name.startsWith(use.value))) return false;
    return true;
  });
}
