import { describe, it, expect } from 'vitest';

import {
  CANONICAL_VIEWPORT,
  FOCUSED_COLUMN_BREAKPOINT,
  FOCUSED_COLUMN_MAX_WIDTH,
  MAX_DIFF_PIXEL_RATIO,
  PHASE5_LOCALES,
  PHASE5_STATES,
  PHASE5_VIEWPORTS,
  PROTOTYPE_SCREEN_KEYS,
  canonicalCells,
  responsiveCells,
  stateById,
} from '../../../../e2e/phase5-visual-states';

// Sprint 09B.29 Phase 5 — the registry's guards, run by the UNIT suite.
//
// The registry asserts itself at import time, which is the guard that matters
// for the Playwright jobs. This file exists because those jobs are not part of
// `pnpm --filter web test`, so a registry mistake would otherwise only surface
// in a browser run that takes twenty minutes to start.
//
// It is also the second of the two guards the mandate requires: the scoped
// `--noEmit` typecheck proves the SHAPE, and this proves the CONTENT.

describe('Phase 5 — the 18-state registry', () => {
  it('holds exactly the integer ids 0..17, once each', () => {
    expect(PHASE5_STATES).toHaveLength(18);
    expect(PHASE5_STATES.map((s) => s.id)).toEqual([...Array(18).keys()]);
  });

  it('agrees with the prototype it is measured against', () => {
    // The registry is ordered by the prototype, so a state's own id, its
    // reference index, and the prototype's key must all line up. If they ever
    // drift, the gate would compare the product against the WRONG approved
    // screen and still report a number.
    expect(PROTOTYPE_SCREEN_KEYS).toHaveLength(18);
    for (const s of PHASE5_STATES) {
      expect(s.referenceIndex, `state ${s.slug}`).toBe(s.id);
      expect(PROTOTYPE_SCREEN_KEYS[s.referenceIndex], `state ${s.slug}`).toBe(s.referenceKey);
    }
  });

  it('gives every state a unique slug, because slugs are artifact paths', () => {
    const slugs = PHASE5_STATES.map((s) => s.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    // Filesystem-safe: these become directory names on Linux and Windows.
    for (const slug of slugs) expect(slug).toMatch(/^[a-z0-9-]+$/);
  });

  it('names a ready selector and required copy in BOTH languages for every state', () => {
    // A state with no ready selector would be captured on a timeout, and a
    // state with no required copy would pass a screenshot comparison while
    // rendering the wrong screen entirely.
    for (const s of PHASE5_STATES) {
      expect(s.readySelector, `state ${s.slug}`).toMatch(/^\[data-testid=/);
      expect(s.requiredCopy.en.length, `state ${s.slug} en`).toBeGreaterThan(0);
      expect(s.requiredCopy.ar.length, `state ${s.slug} ar`).toBeGreaterThan(0);
      // Arabic copy must actually be Arabic. A registry that carried the
      // English string twice would let an untranslated screen pass the
      // bilingual gate.
      for (const line of s.requiredCopy.ar) expect(line).toMatch(/[؀-ۿ]/);
    }
  });

  it('permits workspace navigation in exactly one state', () => {
    const visible = PHASE5_STATES.filter((s) => s.nav === 'visible');
    expect(visible.map((s) => s.id)).toEqual([17]);
    // And every DRAFT / SUBMITTED / RETURNED state hides it, which is the
    // product rule the prototype's own README states.
    for (const s of PHASE5_STATES) {
      if (s.id !== 17) expect(s.nav, `state ${s.slug}`).toBe('hidden');
    }
  });

  it('states the four axes only where the design shows them', () => {
    // The status centre and the active handoff are the two states that carry
    // all four; a state claiming an axis it does not render would make the
    // axis assertion vacuous elsewhere.
    expect(stateById(14).axes).toEqual(['onboarding', 'standing', 'verification', 'workAccess']);
    expect(stateById(17).axes).toEqual(['onboarding', 'standing', 'verification', 'workAccess']);
  });

  it('produces 36 canonical cells and 216 responsive records', () => {
    expect(PHASE5_LOCALES).toEqual(['en', 'ar']);
    expect(PHASE5_VIEWPORTS).toHaveLength(6);
    expect(canonicalCells()).toHaveLength(36);
    expect(responsiveCells()).toHaveLength(216);
  });

  it('compares pixels only where the prototype supplies valid geometry', () => {
    // Conflict C4: the frozen prototype has no genuine wide rendering, so a
    // pixel baseline above the breakpoint would be invented rather than
    // approved. Those widths are checked structurally instead.
    const pixel = PHASE5_VIEWPORTS.filter((v) => v.mode === 'pixel');
    expect(pixel.map((v) => v.width)).toEqual([320, 390]);
    for (const v of PHASE5_VIEWPORTS) {
      if (v.width >= FOCUSED_COLUMN_BREAKPOINT) expect(v.mode).toBe('structural');
    }
  });

  it('pins the canonical viewport and the parity ceiling', () => {
    expect(CANONICAL_VIEWPORT).toEqual({ width: 390, height: 844 });
    // 0.005 per cell, not the repository-wide 0.02, and not an average.
    expect(MAX_DIFF_PIXEL_RATIO).toBe(0.005);
    expect(FOCUSED_COLUMN_MAX_WIDTH).toBe(480);
  });

  it('rejects an unknown id loudly rather than returning undefined', () => {
    expect(() => stateById(18)).toThrow(/no Phase 5 state with id 18/);
  });
});
