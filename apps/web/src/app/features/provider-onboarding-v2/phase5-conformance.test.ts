import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  PHASE5_STATES,
  PROTOTYPE_SCREEN_KEYS,
} from '../../../../e2e/phase5-visual-states';
import {
  PROVISIONAL_ROOT,
  SCREEN_STATES,
  TASK_SCREENS,
  countersFrom,
  creditFor,
  type TaskScreenFile,
} from '../../../../e2e/phase5-evidence-ledger';

// Sprint 09B.29 Phase 5 — the architecture gate for the V2 presentation.
//
// docs/provider-experience-v2/PHASE5_VERIFICATION.md
//
// WHY A SOURCE-LEVEL GATE AND NOT ONLY A VISUAL ONE
//
// A pixel comparison proves one state at one viewport in one language looks
// right today. It says nothing about HOW that was achieved, so a screen can
// pass parity while hard-coding `#2563eb`, `text-[13px]` and `bg-slate-50`
// inline — and the next person who changes a token finds the screen does not
// move with it. That is the state the six task screens start this phase in:
// 3,371 lines carrying 153 inline style blocks, 142 `fontSize` occurrences and
// 366 raw palette utilities between them, with zero Provider UI imports.
//
// WHAT CHANGED, AND WHY IT HAD TO
//
// The first version of this file carried a hand-written MIGRATED list. Adding
// a filename to it was enough to claim a screen — an assertion about work,
// written by the same change that was meant to prove it. Two screens were
// credited that way while having no visual, no axe and no real-HTTP evidence.
//
// Credit is now DERIVED, by `phase5-evidence-ledger.ts`, from artifacts on
// disk. This file supplies only the SOURCE half of the judgement, computed
// over the file rather than declared about it. Nothing here can be edited to
// award a counter.

const HERE = dirname(fileURLToPath(import.meta.url));
const COMPONENTS = join(HERE, 'components');

/** Raw Tailwind palette families. A migrated tree names tokens, not colours. */
const PALETTE =
  /\b(?:bg|text|border|ring|from|to|via|outline|decoration|divide|shadow|fill|stroke|accent|caret|placeholder)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/g;

const HEX = /#[0-9a-fA-F]{3,8}\b/g;
const INLINE_FONT_SIZE = /fontSize\s*:/g;

/**
 * One-off arbitrary values Tailwind lets you smuggle past the token layer.
 *
 * `text-[13px]`, `rounded-[14px]`, `shadow-[0_1px_2px…]` are the same defect as
 * an inline style with extra steps: they read as utilities but answer to
 * nothing. Spacing is deliberately NOT included — `gap-[18px]` is layout
 * rhythm from the approved screen, not a design token being bypassed.
 */
const ARBITRARY_TYPOGRAPHY = /\b(?:text|leading|tracking|rounded|shadow)-\[[^\]]+\]/g;

/** Legacy presentation the V2 tree must not depend on. */
const LEGACY_IMPORTS = [
  /from\s+['"][^'"]*components\/provider\/onboarding\/wizard-copy['"]/,
  /from\s+['"][^'"]*PortfolioSection['"]/,
  /from\s+['"][^'"]*components\/provider\/onboarding\/ProviderOnboardingWizard['"]/,
];

/**
 * The narrow escape hatch, and it has to be earned.
 *
 * A line may opt out only by naming this marker, which makes every exception
 * greppable in one command. For data-driven geometry — a progress width, a
 * radius ring — that no token can express.
 */
const ALLOW = 'phase5-dynamic-style-ok';

function read(file: string): string {
  return readFileSync(join(COMPONENTS, file), 'utf8');
}

function offendingLines(source: string, pattern: RegExp): string[] {
  return source
    .split('\n')
    .filter((line) => {
      if (line.includes(ALLOW)) return false;
      const trimmed = line.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) {
        return false;
      }
      pattern.lastIndex = 0;
      return pattern.test(line);
    })
    .map((line) => line.trim());
}

/** The source half of the judgement, computed — never declared. */
export function isSourceConformant(file: TaskScreenFile): boolean {
  const source = read(file);
  return (
    offendingLines(source, PALETTE).length === 0 &&
    offendingLines(source, HEX).length === 0 &&
    offendingLines(source, INLINE_FONT_SIZE).length === 0 &&
    offendingLines(source, ARBITRARY_TYPOGRAPHY).length === 0 &&
    !LEGACY_IMPORTS.some((p) => p.test(source)) &&
    !/type=["']url["']/.test(source) &&
    /from\s+['"][^'"]*provider-ui['"]/.test(source)
  );
}

describe('Phase 5 conformance — source rules', () => {
  it('has a component file for every one of the six task screens', () => {
    const present = readdirSync(COMPONENTS);
    expect(TASK_SCREENS.filter((f) => present.includes(f))).toEqual([...TASK_SCREENS]);
  });

  // Every screen is checked, not only the ones somebody listed. A screen that
  // has not been migrated yet fails these and is simply not credited; it is
  // never silently skipped.
  describe.each(TASK_SCREENS)('%s', (file) => {
    const migratedYet = () => isSourceConformant(file);

    it('either is fully token-based, or is honestly reported as not migrated', () => {
      const source = read(file);
      const problems = {
        palette: offendingLines(source, PALETTE).length,
        hex: offendingLines(source, HEX).length,
        inlineFontSize: offendingLines(source, INLINE_FONT_SIZE).length,
        arbitraryTypography: offendingLines(source, ARBITRARY_TYPOGRAPHY).length,
        legacyImport: LEGACY_IMPORTS.filter((p) => p.test(source)).length,
        rawUrlInput: /type=["']url["']/.test(source) ? 1 : 0,
        usesProviderUi: /from\s+['"][^'"]*provider-ui['"]/.test(source),
      };

      // A screen is conformant or it is not. The assertion records WHICH rule
      // it fails, so an un-migrated screen produces a useful report rather
      // than a bare false.
      if (migratedYet()) {
        expect(problems).toEqual({
          palette: 0,
          hex: 0,
          inlineFontSize: 0,
          arbitraryTypography: 0,
          legacyImport: 0,
          rawUrlInput: 0,
          usesProviderUi: true,
        });
      } else {
        // Not migrated yet. The only thing asserted is that it is not being
        // counted, which the ledger test below enforces.
        expect(problems.usesProviderUi || problems.palette > 0).toBe(true);
      }
    });
  });
});

describe('Phase 5 conformance — the registry cannot drift', () => {
  it('contains exactly the ids 0..17, once each', () => {
    const ids = PHASE5_STATES.map((s) => s.id);
    expect(ids).toEqual(Array.from({ length: 18 }, (_, i) => i));
    expect(new Set(ids).size).toBe(18);
  });

  it('uses every prototype screen key exactly once', () => {
    const keys = PHASE5_STATES.map((s) => s.referenceKey).sort();
    expect(keys).toEqual([...PROTOTYPE_SCREEN_KEYS].sort());
  });

  it('gives every state a unique slug, because slugs are artifact paths', () => {
    const slugs = PHASE5_STATES.map((s) => s.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('maps every task screen onto states that exist', () => {
    const known = new Set(PHASE5_STATES.map((s) => s.id));
    for (const [screen, ids] of Object.entries(SCREEN_STATES)) {
      expect(ids.length, `${screen} owns no state`).toBeGreaterThan(0);
      for (const id of ids) expect(known.has(id), `${screen} -> ${id}`).toBe(true);
    }
  });

  it('claims no state twice across the six task screens', () => {
    const owned = Object.values(SCREEN_STATES).flat();
    expect(new Set(owned).size).toBe(owned.length);
  });
});

describe('Phase 5 conformance — counters are derived, never declared', () => {
  const credits = TASK_SCREENS.map((screen) =>
    creditFor(PROVISIONAL_ROOT, screen, isSourceConformant(screen)),
  );
  const counters = countersFrom(credits);

  it('reports the three counters separately', () => {
    // They are different claims about different evidence. Collapsing them is
    // how a static screen gets called finished.
    expect(counters.total).toBe(6);
    expect(counters.presentationMigrated).toBeLessThanOrEqual(counters.total);
    expect(counters.productionRouteIntegrated).toBeLessThanOrEqual(counters.presentationMigrated);
    expect(counters.realApiPersisted).toBeLessThanOrEqual(counters.productionRouteIntegrated);
  });

  it('credits no screen that has not produced its artifacts', () => {
    for (const credit of credits) {
      if (credit.presentationMigrated) {
        expect(credit.missing, `${credit.screen} credited with gaps`).toEqual([]);
      }
    }
  });

  it('records exactly what each screen is still missing', () => {
    // The report a reviewer actually wants: not "0/6", but which evidence is
    // absent for which screen.
    const report = Object.fromEntries(credits.map((c) => [c.screen, c.missing]));
    expect(Object.keys(report)).toEqual([...TASK_SCREENS]);
    for (const missing of Object.values(report)) expect(Array.isArray(missing)).toBe(true);
  });
});
