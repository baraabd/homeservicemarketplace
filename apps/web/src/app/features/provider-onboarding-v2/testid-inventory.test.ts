import { describe, expect, it } from 'vitest';

import { renderedTestIds, testIdUses, unresolvableTestIds } from '../../../../e2e/testid-inventory';

// Sprint 09B.29 Phase 5B — every testid a spec reaches for must exist.
//
// docs/provider-experience-v2/PHASE5A_INTEGRATION_GAPS.md
//
// This is the gate that would have caught eight of the twelve failures in the
// first Phase 5B real-API run, in seconds, without a browser. The Phase 5A
// visual migration renamed and removed controls to match the approved
// prototype and nothing connected the specs to that.
//
// The worst of them did not fail at all. `years-of-experience` never existed,
// and its spec wrapped every use in `if (await years.count())`, so it passed
// for a sprint while touching nothing. That is the failure mode this test is
// really aimed at: not a red run, but a green one that proved nothing.

describe('spec testids exist in the components', () => {
  it('names no control that no component can render', () => {
    const rendered = renderedTestIds('src');
    const uses = testIdUses('e2e');

    // Guard the guard. If either side comes back empty the assertion below is
    // vacuous, and a refactor that moved either directory would make this test
    // pass by finding nothing at all.
    expect(rendered.exact.size, 'no rendered testids found — is srcDir right?').toBeGreaterThan(
      100,
    );
    expect(uses.length, 'no getByTestId calls found — is e2eDir right?').toBeGreaterThan(100);

    const unresolvable = unresolvableTestIds(uses, rendered);
    const report = unresolvable
      .map((u) => `${u.file.replace(/^.*e2e[\\/]/, 'e2e/')}:${u.line} -> ${u.value}`)
      .sort();

    expect(
      report,
      'these specs reach for testids nothing renders — the control was renamed or removed',
    ).toEqual([]);
  });

  it('resolves a family prefix and a primitive that appends a suffix', () => {
    // The two shapes that would produce false positives if handled naively,
    // asserted directly so a future tightening of the matcher cannot quietly
    // start failing honest specs.
    const rendered = {
      exact: new Set(['services-task']),
      prefixes: new Set(['day-toggle-', 'experience-years']),
      suffixes: new Set(['-save-status']),
    };

    const resolved = unresolvableTestIds(
      [
        { file: 'a', line: 1, value: 'services-task', isPrefix: false },
        { file: 'a', line: 2, value: 'day-toggle-', isPrefix: true },
        // ProviderStepper turns one `testId` into three rendered ids.
        { file: 'a', line: 3, value: 'experience-years-value', isPrefix: false },
        // AutosaveStatus puts the variable FIRST, so only the tail is fixed.
        { file: 'a', line: 4, value: 'task-save-status', isPrefix: false },
      ],
      rendered,
    );
    expect(resolved).toEqual([]);
  });

  it('reports a testid that genuinely does not exist', () => {
    // The real regression: `radius-slider` was removed when the approved
    // work-area screen replaced the slider with a stated radius.
    const found = unresolvableTestIds(
      [{ file: 'a', line: 1, value: 'radius-slider', isPrefix: false }],
      { exact: new Set(['service-area-radius']), prefixes: new Set(), suffixes: new Set() },
    );
    expect(found.map((f) => f.value)).toEqual(['radius-slider']);
  });
});
