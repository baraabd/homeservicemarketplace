import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  SCREEN_STATES,
  TASK_SCREENS,
  axeIsClean,
  canonicalCellEvidence,
  canonicalCellPasses,
  countersFrom,
  creditFor,
  persistenceEvidence,
  routeEvidence,
  type TaskScreenFile,
} from '../../../../e2e/phase5-evidence-ledger';
import { PHASE5_STATES } from '../../../../e2e/phase5-visual-states';

// Sprint 09B.29 Phase 5 — attacking the evidence ledger.
//
// docs/provider-experience-v2/PHASE5_VERIFICATION.md
//
// The ledger exists so that a counter cannot be advanced by editing a list. It
// only achieves that if the artifacts it reads cannot be forged as easily as
// the list was. Its first version could: it trusted a number written into
// JSON, accepted `{}` as a clean accessibility scan, and took a self-authored
// boolean as proof that a test ran without interception.
//
// So these are written as ATTACKS. Each one produces the cheapest possible
// fake that a tired engineer — or a future me — might write by hand, and
// asserts the ledger refuses it. Every test here failed against the first
// implementation; that is the point of having them.
//
// A PNG is a real PNG, a ratio is recomputed rather than read, an axe result
// carries its schema, and route and persistence evidence must agree with the
// run manifest they claim to belong to.

const STATE_BASICS = PHASE5_STATES.find((s) => s.id === 3)!;
const SCREEN: TaskScreenFile = 'BasicsTaskScreen.tsx';

/** A minimal but genuinely valid 1x1 PNG. */
const REAL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

let root: string;

function cell(locale: 'en' | 'ar' = 'en'): string {
  const dir = join(root, STATE_BASICS.slug, locale, '390');
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writePngTrio(dir: string, buffer: Buffer = REAL_PNG): void {
  writeFileSync(join(dir, 'expected.png'), buffer);
  writeFileSync(join(dir, 'actual.png'), buffer);
  writeFileSync(join(dir, 'diff.png'), buffer);
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'phase5-ledger-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('the ledger refuses forged VISUAL evidence', () => {
  it('rejects zero-byte PNGs even when all three files exist', () => {
    const dir = cell();
    writePngTrio(dir, Buffer.alloc(0));
    writeFileSync(join(dir, 'metrics.json'), JSON.stringify({ diffPixelRatio: 0 }));

    const evidence = canonicalCellEvidence(root, STATE_BASICS, 'en');
    expect(canonicalCellPasses(evidence)).toBe(false);
  });

  it('rejects a file that is named .png but is not one', () => {
    const dir = cell();
    writePngTrio(dir, Buffer.from('this is not a png, it is a sentence'));
    writeFileSync(join(dir, 'metrics.json'), JSON.stringify({ diffPixelRatio: 0 }));

    expect(canonicalCellPasses(canonicalCellEvidence(root, STATE_BASICS, 'en'))).toBe(false);
  });

  it('rejects a NEGATIVE diffPixelRatio, which would pass a naive <= check', () => {
    const dir = cell();
    writePngTrio(dir);
    writeFileSync(join(dir, 'metrics.json'), JSON.stringify({ diffPixelRatio: -1 }));

    expect(canonicalCellPasses(canonicalCellEvidence(root, STATE_BASICS, 'en'))).toBe(false);
  });

  it('rejects a ratio that is not finite', () => {
    const dir = cell();
    writePngTrio(dir);
    writeFileSync(join(dir, 'metrics.json'), '{"diffPixelRatio": 1e999}');

    expect(canonicalCellPasses(canonicalCellEvidence(root, STATE_BASICS, 'en'))).toBe(false);
  });

  it('rejects a ratio above 1, which cannot describe a proportion of pixels', () => {
    const dir = cell();
    writePngTrio(dir);
    writeFileSync(join(dir, 'metrics.json'), JSON.stringify({ diffPixelRatio: 4 }));

    expect(canonicalCellPasses(canonicalCellEvidence(root, STATE_BASICS, 'en'))).toBe(false);
  });

  it('rejects a cell whose metrics claim a state or locale it is not filed under', () => {
    const dir = cell('en');
    writePngTrio(dir);
    writeFileSync(
      join(dir, 'metrics.json'),
      JSON.stringify({ diffPixelRatio: 0, stateId: 99, locale: 'ar' }),
    );

    expect(canonicalCellPasses(canonicalCellEvidence(root, STATE_BASICS, 'en'))).toBe(false);
  });
});

describe('the ledger refuses forged ACCESSIBILITY evidence', () => {
  it('rejects an empty object, which has no violations only because it has nothing', () => {
    const dir = cell();
    writeFileSync(join(dir, 'axe.json'), JSON.stringify({}));

    expect(axeIsClean(root, STATE_BASICS, 'en')).toBe(false);
  });

  it('rejects a result whose violations key is not an array', () => {
    const dir = cell();
    writeFileSync(join(dir, 'axe.json'), JSON.stringify({ violations: 'none' }));

    expect(axeIsClean(root, STATE_BASICS, 'en')).toBe(false);
  });

  it('rejects a result with no recorded axe version or WCAG tags', () => {
    const dir = cell();
    writeFileSync(join(dir, 'axe.json'), JSON.stringify({ violations: [] }));

    expect(axeIsClean(root, STATE_BASICS, 'en')).toBe(false);
  });

  it('rejects a scan that disabled rules or excluded application regions', () => {
    const dir = cell();
    writeFileSync(
      join(dir, 'axe.json'),
      JSON.stringify({
        violations: [],
        testEngine: { name: 'axe-core', version: '4.10.0' },
        toolOptions: {
          runOnly: { values: ['wcag2a', 'wcag2aa'] },
          rules: { 'color-contrast': { enabled: false } },
        },
        url: 'http://localhost/provider/onboarding/BASICS_IDENTITY',
        stateId: 3,
        locale: 'en',
        viewport: { width: 390, height: 844 },
      }),
    );

    expect(axeIsClean(root, STATE_BASICS, 'en')).toBe(false);
  });

  it('accepts a complete, honest, clean scan', () => {
    const dir = cell();
    writeFileSync(
      join(dir, 'axe.json'),
      JSON.stringify({
        violations: [],
        incomplete: [],
        testEngine: { name: 'axe-core', version: '4.10.0' },
        toolOptions: {
          runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] },
        },
        url: 'http://localhost/provider/onboarding/BASICS_IDENTITY',
        stateId: 3,
        locale: 'en',
        viewport: { width: 390, height: 844 },
      }),
    );

    expect(axeIsClean(root, STATE_BASICS, 'en')).toBe(true);
  });
});

describe('the ledger refuses forged ROUTE evidence', () => {
  it('rejects a marker that says only that it had no interception', () => {
    const dir = join(root, 'route');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'BasicsTaskScreen.json'), JSON.stringify({ interceptionFree: true }));

    expect(routeEvidence(root, SCREEN).verified).toBe(false);
  });

  it('rejects a marker from a DIFFERENT commit than the run it claims', () => {
    const dir = join(root, 'route');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'BasicsTaskScreen.json'),
      JSON.stringify({
        interceptionFree: true,
        gitSha: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
        bundleHash: 'abc123',
        apiOrigin: 'http://127.0.0.1:4000',
        flagSource: 'build-env',
        flagValue: true,
        route: '/provider/onboarding/BASICS_IDENTITY',
        exitStatus: 0,
      }),
    );

    // The run manifest says a different SHA, so this marker is stale.
    expect(
      routeEvidence(root, SCREEN, {
        gitSha: 'feedfacefeedfacefeedfacefeedfacefeedface',
        bundleHash: 'abc123',
      }).verified,
    ).toBe(false);
  });

  it('rejects a marker from a different BUNDLE than the run it claims', () => {
    const dir = join(root, 'route');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'BasicsTaskScreen.json'),
      JSON.stringify({
        interceptionFree: true,
        gitSha: 'feedfacefeedfacefeedfacefeedfacefeedface',
        bundleHash: 'STALE',
        apiOrigin: 'http://127.0.0.1:4000',
        flagSource: 'build-env',
        flagValue: true,
        route: '/provider/onboarding/BASICS_IDENTITY',
        exitStatus: 0,
      }),
    );

    expect(
      routeEvidence(root, SCREEN, {
        gitSha: 'feedfacefeedfacefeedfacefeedfacefeedface',
        bundleHash: 'FRESH',
      }).verified,
    ).toBe(false);
  });

  it('rejects a marker whose test did not exit successfully', () => {
    const dir = join(root, 'route');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'BasicsTaskScreen.json'),
      JSON.stringify({
        interceptionFree: true,
        gitSha: 'feedfacefeedfacefeedfacefeedfacefeedface',
        bundleHash: 'FRESH',
        apiOrigin: 'http://127.0.0.1:4000',
        flagSource: 'build-env',
        flagValue: true,
        route: '/provider/onboarding/BASICS_IDENTITY',
        exitStatus: 1,
      }),
    );

    expect(
      routeEvidence(root, SCREEN, {
        gitSha: 'feedfacefeedfacefeedfacefeedfacefeedface',
        bundleHash: 'FRESH',
      }).verified,
    ).toBe(false);
  });

  it('rejects a marker that admits to a mocking mechanism', () => {
    const dir = join(root, 'route');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'BasicsTaskScreen.json'),
      JSON.stringify({
        interceptionFree: true,
        mechanisms: ['page.route'],
        gitSha: 'feedfacefeedfacefeedfacefeedfacefeedface',
        bundleHash: 'FRESH',
        apiOrigin: 'http://127.0.0.1:4000',
        flagSource: 'build-env',
        flagValue: true,
        route: '/provider/onboarding/BASICS_IDENTITY',
        exitStatus: 0,
      }),
    );

    expect(
      routeEvidence(root, SCREEN, {
        gitSha: 'feedfacefeedfacefeedfacefeedfacefeedface',
        bundleHash: 'FRESH',
      }).verified,
    ).toBe(false);
  });
});

describe('the ledger refuses forged PERSISTENCE evidence', () => {
  it('rejects a file of hand-written true booleans', () => {
    const dir = join(root, 'persistence');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'BasicsTaskScreen.json'),
      JSON.stringify({
        hydratesFromServer: true,
        survivesHubNavigation: true,
        survivesHardReload: true,
        survivesFreshSignIn: true,
        realDatabaseAsserted: true,
      }),
    );

    // No observed values, no revision, no database identity: nothing here was
    // measured, it was typed.
    expect(persistenceEvidence(root, SCREEN).verified).toBe(false);
  });

  it('rejects persistence with no acknowledged server revision', () => {
    const dir = join(root, 'persistence');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'BasicsTaskScreen.json'),
      JSON.stringify({
        before: { displayName: 'Old' },
        after: { displayName: 'New' },
        databaseSystemId: 'pg-ephemeral-1',
        observedAfterReload: { displayName: 'New' },
        observedAfterFreshSignIn: { displayName: 'New' },
      }),
    );

    expect(persistenceEvidence(root, SCREEN).verified).toBe(false);
  });

  it('rejects persistence whose reloaded value disagrees with what was saved', () => {
    const dir = join(root, 'persistence');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'BasicsTaskScreen.json'),
      JSON.stringify({
        before: { displayName: 'Old' },
        after: { displayName: 'New' },
        acknowledgedVersion: 7,
        databaseSystemId: 'pg-ephemeral-1',
        observedAfterReload: { displayName: 'Old' },
        observedAfterFreshSignIn: { displayName: 'New' },
        databaseValues: { displayName: 'New' },
      }),
    );

    expect(persistenceEvidence(root, SCREEN).verified).toBe(false);
  });
});

describe('the ledger refuses MIXED or STALE runs', () => {
  it('rejects evidence whose artifacts come from two different runs', () => {
    const dir = cell();
    writePngTrio(dir);
    writeFileSync(
      join(dir, 'metrics.json'),
      JSON.stringify({ diffPixelRatio: 0, runId: 'run-A', stateId: 3, locale: 'en' }),
    );
    writeFileSync(
      join(dir, 'axe.json'),
      JSON.stringify({
        violations: [],
        runId: 'run-B',
        testEngine: { name: 'axe-core', version: '4.10.0' },
        toolOptions: { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] } },
        url: 'http://localhost/x',
        stateId: 3,
        locale: 'en',
        viewport: { width: 390, height: 844 },
      }),
    );

    const credit = creditFor(root, SCREEN, true, { runId: 'run-A' });
    expect(credit.presentationMigrated).toBe(false);
  });
});

describe('counter logic is per-screen and monotonic', () => {
  it('allows a legitimate presentation-only screen', () => {
    // presentation=1, route=0, persistence=0 is an honest intermediate state
    // and must not be treated as a failure.
    const credit = {
      screen: SCREEN,
      presentationMigrated: true,
      productionRouteIntegrated: false,
      realApiPersisted: false,
      missing: { presentation: [], route: ['live route'], persistence: ['database'] },
    };
    const counters = countersFrom([credit]);
    expect(counters.presentationMigrated).toBe(1);
    expect(counters.productionRouteIntegrated).toBe(0);
    expect(counters.realApiPersisted).toBe(0);
  });

  it('never credits persistence for a screen whose presentation is not credited', () => {
    // Persistence without presentation is incoherent: the data survived a
    // reload of a screen that has not been proved to render correctly.
    const dir = join(root, 'persistence');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'BasicsTaskScreen.json'), JSON.stringify({ everything: true }));

    const credit = creditFor(root, SCREEN, false, { runId: 'r' });
    expect(credit.realApiPersisted).toBe(false);
    expect(credit.productionRouteIntegrated).toBe(false);
  });

  it('reports what is missing in three independent groups', () => {
    const credit = creditFor(root, SCREEN, false, { runId: 'r' });
    expect(Array.isArray(credit.missing.presentation)).toBe(true);
    expect(Array.isArray(credit.missing.route)).toBe(true);
    expect(Array.isArray(credit.missing.persistence)).toBe(true);
  });
});

describe('state ownership is exhaustive and cannot silently shrink', () => {
  it('owns exactly the task states, with none missing and none duplicated', () => {
    const owned = Object.values(SCREEN_STATES)
      .flat()
      .sort((a, b) => a - b);
    // The six task controllers own exactly these approved states. Deleting one
    // from SCREEN_STATES must fail here rather than quietly reduce the work.
    expect(owned).toEqual([3, 4, 5, 6, 7, 8, 9, 11, 12, 13]);
    expect(new Set(owned).size).toBe(owned.length);
  });

  it('accounts for every one of the eighteen states, task or not', () => {
    const taskOwned = new Set(Object.values(SCREEN_STATES).flat());
    const nonTask = PHASE5_STATES.filter((s) => !taskOwned.has(s.id)).map((s) => s.id);
    // Activation, synchronisation, both Hubs, status, returned, expired and the
    // active handoff are owned elsewhere — but they are OWNED, not forgotten.
    expect(nonTask).toEqual([0, 1, 2, 10, 14, 15, 16, 17]);
    expect(taskOwned.size + nonTask.length).toBe(18);
  });

  it('maps every task screen to at least one state', () => {
    for (const screen of TASK_SCREENS) {
      expect(SCREEN_STATES[screen].length, screen).toBeGreaterThan(0);
    }
  });
});
