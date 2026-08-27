import {
  EVIDENCE_KEY_PREFIX,
  PORTFOLIO_KEY_PREFIX,
  PortfolioPolicyError,
  assertHasRoom,
  assertPublicationRight,
  assertPublishableContentType,
  assertPublishableKey,
  assertWithinFileLimit,
  portfolioOwnerRef,
  resolveReorder,
} from './portfolio-policy';

// Sprint 9B.10 — the portfolio rules, asserted without a database.
//
// The separation between PUBLIC portfolio media and RESTRICTED verification
// evidence is the reason this file exists, so it is tested first and hardest:
// a provider who could attach an evidence asset to a portfolio item would
// publish their own identity documents to the marketplace.

const OWNER = 'user-1';

function refusalOf(fn: () => void): string {
  try {
    fn();
  } catch (err) {
    return (err as PortfolioPolicyError).code;
  }
  throw new Error('expected a refusal');
}

describe('portfolio media cannot be verification evidence', () => {
  it('refuses a key in the evidence namespace outright', () => {
    // The one direction that must be impossible.
    expect(
      refusalOf(() => assertPublishableKey(`${EVIDENCE_KEY_PREFIX}case-1/doc.pdf`, OWNER)),
    ).toBe('NOT_A_PORTFOLIO_KEY');
  });

  it('refuses an evidence key even when it names the caller', () => {
    // A provider publishing their OWN documents is still a disclosure: they
    // are consenting to something they almost certainly do not understand,
    // and the marketplace is not the place to find out.
    expect(
      refusalOf(() => assertPublishableKey(`${EVIDENCE_KEY_PREFIX}${OWNER}/passport.jpg`, OWNER)),
    ).toBe('NOT_A_PORTFOLIO_KEY');
  });

  it('refuses another provider’s portfolio key', () => {
    // Ownership is in the key's own segment, so guessing one is not enough.
    expect(
      refusalOf(() => assertPublishableKey(`${PORTFOLIO_KEY_PREFIX}user-2/a.jpg`, OWNER)),
    ).toBe('NOT_A_PORTFOLIO_KEY');
  });

  it('accepts this provider’s own portfolio key', () => {
    // Non-vacuity: if everything were refused, every test above would pass for
    // the wrong reason.
    expect(() =>
      assertPublishableKey(`${PORTFOLIO_KEY_PREFIX}${OWNER}/abc.jpg`, OWNER),
    ).not.toThrow();
  });

  it.each([
    ['traversal', `${PORTFOLIO_KEY_PREFIX}user-1/../../verification/case/doc.pdf`],
    ['double slash', `${PORTFOLIO_KEY_PREFIX}user-1//../x.jpg`],
    ['null byte', `${PORTFOLIO_KEY_PREFIX}user-1/a\0.jpg`],
    ['bare relative', '../verification/case-1/doc.pdf'],
    ['absolute', '/etc/passwd'],
    ['empty', ''],
  ])('refuses a %s key', (_label, key) => {
    // The presign endpoint synthesises keys and never echoes a filename, so a
    // key containing any of these did not come from it.
    expect(refusalOf(() => assertPublishableKey(key, OWNER))).toBe('NOT_A_PORTFOLIO_KEY');
  });

  it('refuses a key that merely CONTAINS the portfolio prefix later on', () => {
    expect(
      refusalOf(() =>
        assertPublishableKey(`verification/${PORTFOLIO_KEY_PREFIX}${OWNER}/a.jpg`, OWNER),
      ),
    ).toBe('NOT_A_PORTFOLIO_KEY');
  });
});

describe('only images, and only supported ones', () => {
  it.each(['image/jpeg', 'image/png', 'image/webp'])('accepts %s', (ct) => {
    expect(() => assertPublishableContentType(ct)).not.toThrow();
  });

  it.each(['video/mp4', 'video/quicktime', 'video/webm'])('refuses %s', (ct) => {
    // Excluded deliberately even though the shared content-type module allows
    // it: videos need transcoding and a poster frame nothing here produces, so
    // shipping the type without the pipeline puts an unplayable file in front
    // of a customer.
    expect(refusalOf(() => assertPublishableContentType(ct))).toBe('DISALLOWED_FORMAT');
  });

  it.each(['application/pdf', 'text/html', 'image/svg+xml', '', 'image/jpeg; charset=x'])(
    'refuses %p',
    (ct) => {
      expect(refusalOf(() => assertPublishableContentType(ct))).toBe('DISALLOWED_FORMAT');
    },
  );
});

describe('file and gallery limits', () => {
  it('accepts a file at exactly the limit', () => {
    expect(() => assertWithinFileLimit(1000, 1000)).not.toThrow();
  });

  it('refuses one byte over', () => {
    expect(refusalOf(() => assertWithinFileLimit(1001, 1000))).toBe('FILE_TOO_LARGE');
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])('refuses a size of %p', (size) => {
    expect(refusalOf(() => assertWithinFileLimit(size, 1000))).toBe('FILE_TOO_LARGE');
  });

  it('allows the last free slot and refuses the one after', () => {
    expect(() => assertHasRoom(11, 12)).not.toThrow();
    expect(refusalOf(() => assertHasRoom(12, 12))).toBe('LIMIT_REACHED');
  });

  it('a LOWERED limit refuses additions and deletes nothing', () => {
    // An operator tightening the ceiling must not silently unpublish work a
    // provider already showed to customers. The function can only ever refuse
    // an addition — it has no power to remove, and that is the design.
    expect(refusalOf(() => assertHasRoom(20, 5))).toBe('LIMIT_REACHED');
  });
});

describe('the publication right is acknowledged, not assumed', () => {
  it('accepts a literal true', () => {
    expect(() => assertPublicationRight(true)).not.toThrow();
  });

  it.each([
    ['the string "true"', 'true'],
    ['the string "false"', 'false'],
    ['1', 1],
    ['undefined', undefined],
    ['null', null],
    ['an object', {}],
  ])('refuses %s', (_label, ack) => {
    // A customer's home is in the photo. "Truthy" is not consent, and the
    // string "false" is truthy.
    expect(refusalOf(() => assertPublicationRight(ack))).toBe('PUBLICATION_RIGHT_NOT_ACKNOWLEDGED');
  });
});

describe('reordering converges instead of failing', () => {
  it('gives a dense 0-based position to every item', () => {
    const out = resolveReorder(['c', 'a', 'b'], ['a', 'b', 'c']);
    expect([...out.entries()].sort()).toEqual([
      ['a', 1],
      ['b', 2],
      ['c', 0],
    ]);
  });

  it('ignores an id the provider does not own or that is deleted', () => {
    // A stale tab reordering a gallery someone deleted from on another device
    // should converge, not 409. The provider's intent for the items that DO
    // exist is still honoured.
    const out = resolveReorder(['ghost', 'b', 'a'], ['a', 'b']);
    expect(out.get('b')).toBe(0);
    expect(out.get('a')).toBe(1);
    expect(out.has('ghost')).toBe(false);
  });

  it('keeps omitted live items, after the named ones, in their existing order', () => {
    // A partial list must not silently drop work out of the gallery.
    const out = resolveReorder(['c'], ['a', 'b', 'c']);
    expect(out.get('c')).toBe(0);
    expect(out.get('a')).toBe(1);
    expect(out.get('b')).toBe(2);
  });

  it('collapses duplicates, because two positions for one id is not an order', () => {
    const out = resolveReorder(['a', 'a', 'b'], ['a', 'b']);
    expect(out.get('a')).toBe(0);
    expect(out.get('b')).toBe(1);
    expect(out.size).toBe(2);
  });

  it('an empty request preserves the existing order exactly', () => {
    const out = resolveReorder([], ['a', 'b', 'c']);
    expect([...out.entries()]).toEqual([
      ['a', 0],
      ['b', 1],
      ['c', 2],
    ]);
  });

  it('always produces contiguous positions with no gaps or repeats', () => {
    // The property a renderer depends on: index === position.
    const live = ['a', 'b', 'c', 'd', 'e'];
    for (const req of [[], ['e'], ['e', 'd'], ['x', 'e', 'a'], ['a', 'a', 'a']]) {
      const positions = [...resolveReorder(req, live).values()].sort((x, y) => x - y);
      expect(positions).toEqual([0, 1, 2, 3, 4]);
    }
  });
});

describe('the owner segment of a portfolio key is opaque', () => {
  const SECRET = 'test-secret';

  it('is not the user id', () => {
    // A portfolio image URL is handed to every customer who views the gallery.
    // A raw user id in it publishes an internal identifier that correlates the
    // provider across every other surface that exposes one.
    const ref = portfolioOwnerRef('user-1', SECRET);
    expect(ref).not.toContain('user-1');
    expect(ref).toMatch(/^[0-9a-f]{24}$/);
  });

  it('is stable, so the ownership check can recompute rather than store it', () => {
    expect(portfolioOwnerRef('user-1', SECRET)).toBe(portfolioOwnerRef('user-1', SECRET));
  });

  it('differs between users', () => {
    expect(portfolioOwnerRef('user-1', SECRET)).not.toBe(portfolioOwnerRef('user-2', SECRET));
  });

  it('differs under a different secret, so a leaked URL is not portable', () => {
    expect(portfolioOwnerRef('user-1', SECRET)).not.toBe(portfolioOwnerRef('user-1', 'other'));
  });

  it('produces a key the publishable check accepts', () => {
    // The two halves must agree, or every upload is refused.
    const ref = portfolioOwnerRef('user-1', SECRET);
    expect(() => assertPublishableKey(`portfolio/${ref}/abc.jpg`, ref)).not.toThrow();
  });

  it('produces a key ANOTHER user’s ref does not satisfy', () => {
    const mine = portfolioOwnerRef('user-1', SECRET);
    const theirs = portfolioOwnerRef('user-2', SECRET);
    expect(() => assertPublishableKey(`portfolio/${mine}/abc.jpg`, theirs)).toThrow();
  });
});
