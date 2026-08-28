import {
  AVATAR_KEY_PREFIX,
  AvatarPolicyError,
  assertAvatarContentType,
  assertAvatarKey,
  assertAvatarWithinLimit,
  avatarOwnerRef,
  referencesRestrictedMedia,
} from './avatar-policy';

// Sprint 9B.17 — the avatar rules, with no database and no HTTP.
//
// The separation these tests protect is the one that matters most: a public
// avatar must never be able to point at restricted identity evidence. Every
// other assertion here is in service of that one.

const SECRET = 'test-secret-that-is-long-enough-for-hmac';
const USER = 'u-1';
const OTHER = 'u-2';

const refFor = (userId: string) => avatarOwnerRef(userId, SECRET);
const keyFor = (userId: string, name = 'abc.jpg') =>
  `${AVATAR_KEY_PREFIX}${refFor(userId)}/${name}`;

function refusalCode(fn: () => void): string {
  try {
    fn();
  } catch (err) {
    if (err instanceof AvatarPolicyError) return err.code;
    throw err;
  }
  throw new Error('expected a refusal, got none');
}

describe('avatarOwnerRef', () => {
  it('is deterministic, so ownership can be recomputed rather than stored', () => {
    expect(refFor(USER)).toBe(refFor(USER));
  });

  it('does not contain the user id, which would otherwise be published in a URL', () => {
    // An avatar URL is handed to every customer who sees the provider. A raw
    // id in it correlates that person across every other surface.
    expect(refFor(USER)).not.toContain(USER);
  });

  it('differs per user', () => {
    expect(refFor(USER)).not.toBe(refFor(OTHER));
  });

  it('differs from the PORTFOLIO ref for the same user', async () => {
    // Domain-separated, so learning one namespace's ref does not hand over the
    // other. Without the separator both would be HMAC(userId) and identical.
    const { portfolioOwnerRef } = await import('../../portfolio/portfolio-policy');
    expect(refFor(USER)).not.toBe(portfolioOwnerRef(USER, SECRET));
  });
});

describe('assertAvatarKey', () => {
  it('accepts a key this server minted for this provider', () => {
    expect(() => assertAvatarKey(keyFor(USER), refFor(USER))).not.toThrow();
  });

  it('REFUSES a key in the restricted evidence namespace', () => {
    // The assertion this whole module exists for. A provider who linked one of
    // these would publish their own passport beside their name.
    expect(refusalCode(() => assertAvatarKey('verification/case-1/doc.jpg', refFor(USER)))).toBe(
      'NOT_AN_AVATAR_KEY',
    );
  });

  it("REFUSES another provider's avatar key", () => {
    expect(refusalCode(() => assertAvatarKey(keyFor(OTHER), refFor(USER)))).toBe(
      'NOT_AN_AVATAR_KEY',
    );
  });

  it('refuses a portfolio key, which is public but is not an avatar', () => {
    expect(refusalCode(() => assertAvatarKey('portfolio/abc/def.jpg', refFor(USER)))).toBe(
      'NOT_AN_AVATAR_KEY',
    );
  });

  it('refuses request media, for the same reason', () => {
    expect(refusalCode(() => assertAvatarKey('requests/u-1/x.jpg', refFor(USER)))).toBe(
      'NOT_AN_AVATAR_KEY',
    );
  });

  it.each([
    ['traversal', `${AVATAR_KEY_PREFIX}REF/../../etc/passwd`],
    ['a null byte', `${AVATAR_KEY_PREFIX}REF/a\0b.jpg`],
    ['a doubled separator', `${AVATAR_KEY_PREFIX}REF//x.jpg`],
  ])('refuses %s', (_label, key) => {
    // Keys are synthesised server-side, so one containing any of these did not
    // come from presign.
    const withRef = key.replace('REF', refFor(USER));
    expect(refusalCode(() => assertAvatarKey(withRef, refFor(USER)))).toBe('NOT_AN_AVATAR_KEY');
  });

  it('refuses a key that merely STARTS with the owner ref of someone else', () => {
    // Prefix matching without the trailing separator would let `avatars/<ref>x/`
    // pass for `<ref>`.
    const sneaky = `${AVATAR_KEY_PREFIX}${refFor(OTHER)}x/photo.jpg`;
    expect(refusalCode(() => assertAvatarKey(sneaky, refFor(USER)))).toBe('NOT_AN_AVATAR_KEY');
  });
});

describe('assertAvatarContentType', () => {
  it.each(['image/jpeg', 'image/png', 'image/webp'])('accepts %s', (ct) => {
    expect(() => assertAvatarContentType(ct)).not.toThrow();
  });

  it.each([
    ['video/mp4', 'a profile photo is not a video'],
    ['image/gif', 'animated avatars were never asked for'],
    ['image/heic', 'not renderable everywhere, and a large parser surface'],
    ['image/svg+xml', 'a script-execution vector rendered inline by browsers'],
    ['application/pdf', 'evidence formats do not belong on a public surface'],
  ])('refuses %s (%s)', (ct) => {
    expect(refusalCode(() => assertAvatarContentType(ct))).toBe('DISALLOWED_FORMAT');
  });
});

describe('assertAvatarWithinLimit', () => {
  it('accepts a size inside the ceiling', () => {
    expect(() => assertAvatarWithinLimit(1_000, 5_000)).not.toThrow();
  });

  it('refuses one over it', () => {
    expect(refusalCode(() => assertAvatarWithinLimit(5_001, 5_000))).toBe('FILE_TOO_LARGE');
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])('refuses the nonsense size %p', (n) => {
    // These arrive from a backend that failed to report a length, and treating
    // "unknown" as "fine" is how an unbounded object gets linked.
    expect(refusalCode(() => assertAvatarWithinLimit(n, 5_000))).toBe('FILE_TOO_LARGE');
  });
});

describe('referencesRestrictedMedia', () => {
  it.each([
    'verification/case-1/doc.jpg',
    '/verification/case-1/doc.jpg',
    'https://cdn.example.com/verification/case-1/doc.jpg',
    'http://localhost:4000/v1/media/files/verification/case-1/doc.jpg',
    'HTTPS://CDN.EXAMPLE.COM/VERIFICATION/CASE-1/DOC.JPG',
  ])('flags %s', (value) => {
    expect(referencesRestrictedMedia(value)).toBe(true);
  });

  it.each([
    'https://cdn.example.com/avatars/abc/def.jpg',
    'https://cdn.example.com/portfolio/abc/def.jpg',
    // The word appears, but not as a path segment. Refusing this would block a
    // legitimate filename for no benefit.
    'https://cdn.example.com/avatars/abc/verification-badge.png',
  ])('does not flag %s', (value) => {
    expect(referencesRestrictedMedia(value)).toBe(false);
  });
});
