import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

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
// move with it. That is exactly the state the six task screens are in at the
// start of this phase: 3,371 lines carrying 153 inline style blocks, 142
// `fontSize` occurrences and 366 raw palette utilities between them, with zero
// Provider UI imports.
//
// So geometry and colour belong inside the shared primitives, and the screens
// pass MEANING. This test is what makes that reviewable rather than a
// convention people drift away from.
//
// IT IS DELIBERATELY NOT A BLANKET BAN ON DYNAMIC STYLE
//
// A progress bar's width and a map ring's radius are data, not design tokens,
// and no token can express them. Those are allowed through a narrow, named
// escape hatch so the gate stays credible instead of being suppressed
// wholesale the first time someone hits a legitimate case.

const HERE = dirname(fileURLToPath(import.meta.url));
const COMPONENTS = join(HERE, 'components');

/** The six live task controllers this phase migrates. */
export const TASK_SCREENS = [
  'BasicsTaskScreen.tsx',
  'ServicesTaskScreen.tsx',
  'ServiceAreaTaskScreen.tsx',
  'AvailabilityTaskScreen.tsx',
  'PublicProfileTaskScreen.tsx',
  'ReviewTaskScreen.tsx',
] as const;

/**
 * Screens that have been migrated to Provider UI and must STAY migrated.
 *
 * This list grows by one entry per slice. A screen is added only once its
 * Provider UI tree is mounted on the live route, which is what stops the gate
 * from being satisfied by a component nobody renders.
 */
const MIGRATED: readonly string[] = ['BasicsTaskScreen.tsx', 'ServicesTaskScreen.tsx'];

/** Raw Tailwind palette families. A migrated tree names tokens, not colours. */
const PALETTE =
  /\b(?:bg|text|border|ring|from|to|via|outline|decoration|divide|shadow|fill|stroke|accent|caret|placeholder)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/g;

const HEX = /#[0-9a-fA-F]{3,8}\b/g;
const INLINE_FONT_SIZE = /fontSize\s*:/g;

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
 * greppable and reviewable in one command. Used for data-driven geometry — a
 * progress width, a radius ring — that no token can express.
 */
const ALLOW = 'phase5-dynamic-style-ok';

function read(file: string): string {
  return readFileSync(join(COMPONENTS, file), 'utf8');
}

/** Lines that actually violate, minus comments and explicitly allowed lines. */
function offendingLines(source: string, pattern: RegExp): string[] {
  return source
    .split('\n')
    .filter((line) => {
      if (line.includes(ALLOW)) return false;
      const trimmed = line.trim();
      // A rule quoted inside a comment is documentation, not styling.
      if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) {
        return false;
      }
      pattern.lastIndex = 0;
      return pattern.test(line);
    })
    .map((line) => line.trim());
}

describe('Phase 5 conformance — the migrated V2 presentation', () => {
  it('has a component file for every one of the six task screens', () => {
    const present = readdirSync(COMPONENTS);
    expect(TASK_SCREENS.filter((f) => present.includes(f))).toEqual([...TASK_SCREENS]);
  });

  describe.each(MIGRATED)('%s', (file) => {
    it('uses no raw Tailwind colour palette', () => {
      expect(offendingLines(read(file), PALETTE)).toEqual([]);
    });

    it('uses no raw hex colours', () => {
      expect(offendingLines(read(file), HEX)).toEqual([]);
    });

    it('sets no inline fontSize', () => {
      expect(offendingLines(read(file), INLINE_FONT_SIZE)).toEqual([]);
    });

    it('imports no legacy presentation', () => {
      const source = read(file);
      const found = LEGACY_IMPORTS.filter((p) => p.test(source)).map((p) => p.source);
      expect(found).toEqual([]);
    });

    it('offers no raw image URL input', () => {
      // Phase 4 replaced this with a real presigned upload. A URL field is the
      // regression that quietly brings back "host it somewhere else first".
      //
      // The rule is about an INPUT the provider types a URL into, which is
      // `type="url"`. An earlier version of this test also banned the
      // identifier `imageUrl`, and that was simply wrong: `AvatarUploader`
      // takes `imageUrl` as the display source of the already-uploaded photo.
      // Banning it would have forced a rename to satisfy a test rather than
      // removing anything a provider can type into.
      expect(read(file)).not.toMatch(/type=["']url["']/);
    });

    it('actually uses Provider UI primitives', () => {
      // The negative rules above are all satisfiable by a blank file. This is
      // the positive one: the screen must be BUILT from the shared system.
      expect(read(file)).toMatch(/from\s+['"][^'"]*provider-ui['"]/);
    });
  });

  it('records how many of the six task screens are migrated', () => {
    // A visible, asserted counter. It changes in the same commit as the screen
    // it describes, so "6/6" can never be a claim made ahead of the work.
    expect(MIGRATED.length).toBeLessThanOrEqual(TASK_SCREENS.length);
    expect(new Set(MIGRATED).size).toBe(MIGRATED.length);
    for (const file of MIGRATED) expect(TASK_SCREENS).toContain(file as never);
  });
});
