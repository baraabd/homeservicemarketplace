import {
  AVATAR_SIGNATURE_PROBE_BYTES,
  detectAvatarMime,
  extensionForAvatarMime,
  isAvatarMimeType,
  verifyAvatarSignature,
} from './image-signature';

// Sprint 9B.17 — what the bytes say.
//
// The threat this module answers: with a browser-direct upload the API never
// sees the body, so "content type" is whatever the client claimed. These tests
// pin the claim being checked against reality.

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const WEBP = Buffer.from([
  0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20,
]);
// Same RIFF container as WebP, different tag. This is the near-miss that a
// "first four bytes" check waves through.
const WAV = Buffer.from([
  0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45, 0x66, 0x6d, 0x74, 0x20,
]);
const HTML = Buffer.from('<!doctype html><script>alert(1)</script>', 'utf8');
const GIF = Buffer.from('GIF89a', 'utf8');
const PDF = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);

describe('detectAvatarMime', () => {
  it.each([
    ['PNG', PNG, 'image/png'],
    ['JPEG', JPEG, 'image/jpeg'],
    ['WebP', WEBP, 'image/webp'],
  ])('recognises %s', (_label, bytes, expected) => {
    expect(detectAvatarMime(bytes)).toBe(expected);
  });

  it('does NOT mistake a WAV for a WebP — both are RIFF containers', () => {
    expect(detectAvatarMime(WAV)).toBeNull();
  });

  it.each([
    ['HTML', HTML],
    ['a GIF, which is not in the avatar allowlist', GIF],
    ['a PDF, which belongs to the evidence path', PDF],
    ['an empty buffer', Buffer.alloc(0)],
    ['a truncated PNG header', Buffer.from([0x89, 0x50, 0x4e])],
  ])('returns null for %s', (_label, bytes) => {
    // Null is a REJECTION, not a shrug: deciding by the absence of a known-bad
    // signature would admit every new format by default.
    expect(detectAvatarMime(bytes)).toBeNull();
  });

  it('probes deeply enough for the format that needs it', () => {
    // WebP's tag ends at byte 12, so a probe shorter than that could not
    // recognise one.
    expect(AVATAR_SIGNATURE_PROBE_BYTES).toBeGreaterThanOrEqual(12);
  });
});

describe('verifyAvatarSignature', () => {
  it('accepts a declaration that matches the bytes', () => {
    expect(verifyAvatarSignature('image/png', PNG)).toEqual({ ok: true, detected: 'image/png' });
  });

  it('REFUSES bytes that disagree with the declaration', () => {
    // The spoof: "this is a PNG" over JPEG bytes. Benign here, but it is the
    // same mechanism that serves an HTML document from an image URL.
    expect(verifyAvatarSignature('image/png', JPEG)).toEqual({
      ok: false,
      code: 'DECLARED_TYPE_MISMATCH',
    });
  });

  it('REFUSES a script payload declared as an image', () => {
    expect(verifyAvatarSignature('image/png', HTML)).toEqual({
      ok: false,
      code: 'UNRECOGNISED_FORMAT',
    });
  });

  it('refuses a type outside the allowlist even when the bytes are genuine', () => {
    // A real PDF, honestly declared, is still not an avatar.
    expect(verifyAvatarSignature('application/pdf', PDF)).toEqual({
      ok: false,
      code: 'DISALLOWED_FORMAT',
    });
  });

  it('refuses an empty declaration', () => {
    expect(verifyAvatarSignature('', PNG)).toEqual({ ok: false, code: 'DISALLOWED_FORMAT' });
  });
});

describe('isAvatarMimeType / extensionForAvatarMime', () => {
  it('agrees with the allowlist', () => {
    expect(isAvatarMimeType('image/webp')).toBe(true);
    expect(isAvatarMimeType('image/gif')).toBe(false);
    expect(isAvatarMimeType(null)).toBe(false);
  });

  it('maps each allowed type to an extension', () => {
    expect(extensionForAvatarMime('image/jpeg')).toBe('jpg');
    expect(extensionForAvatarMime('image/png')).toBe('png');
    expect(extensionForAvatarMime('image/webp')).toBe('webp');
  });
});
