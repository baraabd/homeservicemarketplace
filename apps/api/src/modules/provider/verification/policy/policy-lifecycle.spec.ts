import {
  PolicyLifecycleError,
  assertNoLiveOverlap,
  assertPublishable,
  assertRetirable,
  assertVersionFormat,
  isLiveAt,
} from './policy-lifecycle';

// Sprint 9B.2 — when a policy version may be published, retired, or changed.
//
// docs/adr/0010-policy-versioned-verification.md
//
// The governing rule is that policies are APPEND-ONLY. Nothing about a
// published version is ever edited except its retirement date. Correcting a
// policy means publishing a new version and retiring the old one, so the
// question "what were they judged against?" always has an answer that did not
// change after the fact.
//
// That is stricter than "do not mutate a version a case references", and
// deliberately so: the weaker rule makes immutability depend on whether anyone
// happened to use the policy yet, which means the first case silently changes
// the rules for editing it.

const AT = new Date('2026-08-25T12:00:00Z');

const policy = (over: Partial<Parameters<typeof isLiveAt>[0]> = {}) => ({
  version: '2026.08-global-v1',
  country: null,
  providerType: null,
  categoryId: null,
  publishedAt: new Date('2026-08-01T00:00:00Z'),
  retiredAt: null,
  ...over,
});

describe('version identity', () => {
  it.each(['2026.08-global-v1', '2026.08-sy-v1', '2026.12-sy-business-v2', '2027.01-global-v10'])(
    'accepts %s',
    (v) => {
      expect(() => assertVersionFormat(v)).not.toThrow();
    },
  );

  it.each([
    ['empty', ''],
    ['whitespace only', '   '],
    ['a space inside', '2026.08 global v1'],
    ['uppercase', '2026.08-GLOBAL-v1'],
    ['no version suffix', '2026.08-global'],
    ['path traversal', '../../etc/passwd'],
    ['a quote', "2026.08-global-v1'"],
  ])('refuses %s', (_label, v) => {
    expect(() => assertVersionFormat(v)).toThrow(PolicyLifecycleError);
  });

  it('sorts chronologically as a plain string', () => {
    // The version is the case's pointer to its rules, and operators read it in
    // logs. Sortability is what lets "which policy came first" be answered
    // without a join.
    const sorted = ['2026.12-global-v1', '2026.08-global-v1', '2027.01-global-v1'].sort();
    expect(sorted).toEqual(['2026.08-global-v1', '2026.12-global-v1', '2027.01-global-v1']);
  });
});

describe('liveness', () => {
  it('is live once published and not yet retired', () => {
    expect(isLiveAt(policy(), AT)).toBe(true);
  });

  it('is not live before its publication date', () => {
    expect(isLiveAt(policy({ publishedAt: new Date('2026-09-01T00:00:00Z') }), AT)).toBe(false);
  });

  it('is not live once retired', () => {
    expect(isLiveAt(policy({ retiredAt: new Date('2026-08-10T00:00:00Z') }), AT)).toBe(false);
  });

  it('is still live up to the instant of retirement', () => {
    // Half-open interval. A case opened at the retirement instant belongs to
    // the NEXT policy, which is the only reading that cannot put one case
    // under two policies.
    expect(isLiveAt(policy({ retiredAt: AT }), AT)).toBe(false);
    expect(isLiveAt(policy({ retiredAt: new Date(AT.getTime() + 1) }), AT)).toBe(true);
  });
});

describe('publishing', () => {
  it('allows publication now', () => {
    expect(() => assertPublishable({ publishedAt: AT }, AT)).not.toThrow();
  });

  it('allows scheduling a future publication', () => {
    expect(() =>
      assertPublishable({ publishedAt: new Date(AT.getTime() + 86_400_000) }, AT),
    ).not.toThrow();
  });

  it('refuses back-dating', () => {
    // Back-dating would retroactively change what a case opened yesterday was
    // resolved against, which is the whole thing versioning exists to prevent.
    try {
      assertPublishable({ publishedAt: new Date(AT.getTime() - 1000) }, AT);
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as PolicyLifecycleError).code).toBe('BACKDATED_PUBLICATION');
    }
  });
});

describe('retiring', () => {
  it('retires a live policy', () => {
    expect(() => assertRetirable(policy(), AT)).not.toThrow();
  });

  it('refuses to retire a policy twice', () => {
    try {
      assertRetirable(policy({ retiredAt: new Date('2026-08-10T00:00:00Z') }), AT);
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as PolicyLifecycleError).code).toBe('ALREADY_RETIRED');
    }
  });

  it('refuses to retire a policy that was never published', () => {
    try {
      assertRetirable(policy({ publishedAt: new Date(AT.getTime() + 86_400_000) }), AT);
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as PolicyLifecycleError).code).toBe('NOT_YET_PUBLISHED');
    }
  });
});

describe('overlap is refused at publish time, not discovered at resolution', () => {
  // resolveRequirements() throws AMBIGUOUS_POLICY when two live policies tie on
  // specificity. That is the right behaviour but the wrong MOMENT: it fails a
  // provider trying to start a case, over a mistake an admin made days earlier.
  it('refuses a second live global default', () => {
    try {
      assertNoLiveOverlap(policy({ version: '2026.08-global-v2' }), [policy()], AT);
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as PolicyLifecycleError).code).toBe('OVERLAPPING_POLICY');
    }
  });

  it('names the version it collides with', () => {
    try {
      assertNoLiveOverlap(policy({ version: '2026.08-global-v2' }), [policy()], AT);
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as PolicyLifecycleError).message).toContain('2026.08-global-v1');
    }
  });

  it('allows a country policy alongside the global default', () => {
    // Different specificity — the resolver picks the most specific, so there is
    // no ambiguity to prevent.
    expect(() =>
      assertNoLiveOverlap(policy({ version: '2026.08-sy-v1', country: 'SY' }), [policy()], AT),
    ).not.toThrow();
  });

  it('allows the same scope once the previous version is retired', () => {
    // The ordinary way to correct a policy: retire, then publish. The
    // replacement starts now, after the old one ended.
    expect(() =>
      assertNoLiveOverlap(
        policy({ version: '2026.08-global-v2', publishedAt: AT }),
        [policy({ retiredAt: new Date('2026-08-20T00:00:00Z') })],
        AT,
      ),
    ).not.toThrow();
  });

  it('refuses a replacement that starts BEFORE the old one is retired', () => {
    // The trap in "retire, then publish": retiring on the 20th while the
    // replacement claims to have started on the 1st leaves nineteen days
    // covered by two policies of identical scope. The overlap is in the past,
    // so nothing live would reveal it — but a case opened in that window has
    // two equally specific policies and no defined answer.
    try {
      assertNoLiveOverlap(
        policy({ version: '2026.08-global-v2' }),
        [policy({ retiredAt: new Date('2026-08-20T00:00:00Z') })],
        AT,
      );
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as PolicyLifecycleError).code).toBe('OVERLAPPING_POLICY');
    }
  });

  it('allows the same scope when the old version retires before the new one starts', () => {
    const future = new Date(AT.getTime() + 86_400_000);
    expect(() =>
      assertNoLiveOverlap(
        policy({ version: '2026.08-global-v2', publishedAt: future }),
        [policy({ retiredAt: future })],
        AT,
      ),
    ).not.toThrow();
  });

  it('refuses when a scheduled publication would overlap an un-retired policy', () => {
    // The overlap is in the FUTURE, so a naive "is it live right now" check
    // misses it and the ambiguity appears on the day it takes effect.
    try {
      assertNoLiveOverlap(
        policy({ version: '2026.08-global-v2', publishedAt: new Date(AT.getTime() + 86_400_000) }),
        [policy()],
        AT,
      );
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as PolicyLifecycleError).code).toBe('OVERLAPPING_POLICY');
    }
  });

  it('does not treat a policy as overlapping itself', () => {
    // Re-validating an existing row (a retirement, say) must not trip on its
    // own presence in the live set.
    expect(() => assertNoLiveOverlap(policy(), [policy()], AT)).not.toThrow();
  });

  it('separates category-scoped policies from base policies of the same scope', () => {
    // Category policies are additive, not competing, so they never collide
    // with the base row.
    expect(() =>
      assertNoLiveOverlap(
        policy({ version: '2026.08-global-elec-v1', categoryId: 'cat-elec' }),
        [policy()],
        AT,
      ),
    ).not.toThrow();
  });

  it('still refuses two live policies for the SAME category', () => {
    try {
      assertNoLiveOverlap(
        policy({ version: '2026.08-global-elec-v2', categoryId: 'cat-elec' }),
        [policy({ version: '2026.08-global-elec-v1', categoryId: 'cat-elec' })],
        AT,
      );
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as PolicyLifecycleError).code).toBe('OVERLAPPING_POLICY');
    }
  });
});
