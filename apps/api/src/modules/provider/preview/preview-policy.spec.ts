import { PREVIEW_BOUNDS, fingerprintOf, resolvePreviewPolicy } from './preview-policy';

// Sprint 9B.9 — the policy resolves to "off" whenever it cannot resolve to
// something it can defend.
//
// Every other settings reader in this codebase falls back to its schema
// default, because those limits only ever REFUSE and an outage must not stop
// the marketplace. This one only ever DISCLOSES, so its fallbacks run the
// other way, and these tests are mostly about malformed input.

const GOOD = { enabled: true, cellKm: 25, pageSize: 10, maxItems: 30 };

describe('the preview is off unless something explicitly says otherwise', () => {
  it('is off by default — an absent flag is not an enabled one', () => {
    expect(resolvePreviewPolicy({ ...GOOD, enabled: undefined })).toEqual({ enabled: false });
  });

  it.each([
    ['null', null],
    ['the string "true"', 'true'],
    ['the string "false"', 'false'],
    ['the number 1', 1],
    ['an object', {}],
    ['an empty string', ''],
  ])('is off when the flag is %s', (_label, enabled) => {
    // Strictly `true`, never truthy. The string "false" is truthy, and a row
    // holding it under a truthy check would switch the preview ON — the exact
    // inversion this test exists to prevent.
    expect(resolvePreviewPolicy({ ...GOOD, enabled })).toEqual({ enabled: false });
  });

  it('is on only for the boolean true', () => {
    const policy = resolvePreviewPolicy(GOOD);
    expect(policy.enabled).toBe(true);
  });
});

describe('a value it cannot trust becomes the most private one', () => {
  it.each([
    ['null', null],
    ['a string', '25'],
    ['a fraction', 12.5],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['below the floor', 1],
  ])('falls back to the LARGEST cell when cellKm is %s', (_label, cellKm) => {
    // Not the schema default of 25 — the maximum. A cell that cannot be
    // trusted must not be a small one: too coarse is a worse product, too fine
    // is a privacy incident, and only one of those is recoverable.
    const policy = resolvePreviewPolicy({ ...GOOD, cellKm });
    expect(policy.enabled && policy.cellKm).toBe(PREVIEW_BOUNDS.cellKm.fallback);
    expect(policy.enabled && policy.cellKm).toBe(200);
  });

  it.each([
    ['null', null],
    ['a string', '10'],
    ['zero', 0],
    ['negative', -5],
  ])('falls back to the SMALLEST page when pageSize is %s', (_label, pageSize) => {
    const policy = resolvePreviewPolicy({ ...GOOD, pageSize });
    expect(policy.enabled && policy.pageSize).toBe(1);
  });

  it('falls back to the smallest reachable total when maxItems is unusable', () => {
    const policy = resolvePreviewPolicy({ ...GOOD, maxItems: 'lots' });
    expect(policy.enabled && policy.maxItems).toBe(1);
  });

  it('clamps a value above the ceiling rather than honouring it', () => {
    // A row above the ceiling was written by something that bypassed the admin
    // validation. Honouring a 10,000-item reach would turn the preview into
    // the whole marketplace.
    const policy = resolvePreviewPolicy({ ...GOOD, maxItems: 10_000, pageSize: 500 });
    expect(policy.enabled && policy.maxItems).toBe(PREVIEW_BOUNDS.maxItems.max);
    expect(policy.enabled && policy.pageSize).toBe(PREVIEW_BOUNDS.pageSize.max);
  });

  it('honours a legitimate in-range value unchanged', () => {
    // Non-vacuity: if everything clamped, the tests above would pass for the
    // wrong reason.
    const policy = resolvePreviewPolicy({ enabled: true, cellKm: 40, pageSize: 5, maxItems: 50 });
    expect(policy).toMatchObject({ enabled: true, cellKm: 40, pageSize: 5, maxItems: 50 });
  });
});

describe('the fingerprint makes a mutable settings table auditable', () => {
  it('is stable for identical limits', () => {
    expect(fingerprintOf({ cellKm: 25, pageSize: 10, maxItems: 30 })).toBe(
      fingerprintOf({ cellKm: 25, pageSize: 10, maxItems: 30 }),
    );
  });

  it.each([
    ['cellKm', { cellKm: 26, pageSize: 10, maxItems: 30 }],
    ['pageSize', { cellKm: 25, pageSize: 11, maxItems: 30 }],
    ['maxItems', { cellKm: 25, pageSize: 10, maxItems: 31 }],
  ])('changes when %s changes', (_label, changed) => {
    // The point of recording it: settings rows keep no history, so an audit
    // line saying "a preview was served" is unanswerable a week later unless
    // the limits that applied are pinned to it.
    expect(fingerprintOf(changed)).not.toBe(
      fingerprintOf({ cellKm: 25, pageSize: 10, maxItems: 30 }),
    );
  });

  it('carries no secret and identifies nobody, so it is safe in a log line', () => {
    const fp = fingerprintOf({ cellKm: 25, pageSize: 10, maxItems: 30 });
    expect(fp).toMatch(/^[0-9a-f]{12}$/);
  });

  it('is attached to every enabled policy', () => {
    const policy = resolvePreviewPolicy(GOOD);
    expect(policy.enabled && policy.fingerprint).toMatch(/^[0-9a-f]{12}$/);
  });

  it('is absent when the preview is off, because nothing was disclosed', () => {
    expect(resolvePreviewPolicy({ ...GOOD, enabled: false })).toEqual({ enabled: false });
  });
});
