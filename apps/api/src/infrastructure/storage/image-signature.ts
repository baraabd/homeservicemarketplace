// Sprint 9B.17 — what an uploaded IMAGE actually is, from its leading bytes.
//
// WHY THIS EXISTS SEPARATELY FROM THE EVIDENCE DETECTOR
//
// `provider/verification/media/file-signature.ts` answers the same question for
// identity evidence, and it is deliberately not reused here. The two have
// different allowlists — evidence accepts PDF and refuses WebP, an avatar is
// the reverse — and they protect different things. Sharing one table would mean
// every future change to the avatar allowlist edits a module on the passport
// path, which is the last place a convenience edit should land.
//
// WHY THE PUBLIC PATH NEEDS IT AT ALL
//
// Until now the public upload path validated the DECLARED content type against
// the presign and never inspected a byte. With S3 the browser PUTs straight to
// the bucket, so the API sees neither the headers nor the body: a client could
// declare `image/png`, upload anything at all, and have it served back from a
// @Public() route with `Cache-Control: immutable`. For a photo of a leaking tap
// that is survivable. For an avatar — rendered next to a provider's name on
// every surface a customer sees — it is a stored-content vector.
//
// So the bytes are checked at FINALIZE, reading back from storage, which is the
// only point in a browser-direct upload where the server can see them at all.

/** The only formats an avatar may be.
 *
 *  Narrower than the platform image allowlist, on purpose:
 *
 *    no GIF        — an animated avatar is a distraction the product never
 *                    asked for, and the format buys nothing here
 *    no HEIC/HEIF  — not renderable by every browser, and a large parser
 *                    surface for a format the client already transcodes away
 *    no SVG        — never was allowed, and never should be: it is a
 *                    script-execution vector rendered inline by every browser
 *    no video      — an avatar is a picture
 */
export const AVATAR_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

export type AvatarMimeType = (typeof AVATAR_MIME_TYPES)[number];

export function isAvatarMimeType(value: unknown): value is AvatarMimeType {
  return typeof value === 'string' && (AVATAR_MIME_TYPES as readonly string[]).includes(value);
}

/** Extension for a DETECTED type. Keys are synthesised from what the file
 *  turned out to be, never from a client filename. */
export function extensionForAvatarMime(mime: AvatarMimeType): string {
  switch (mime) {
    case 'image/jpeg':
      return 'jpg';
    case 'image/png':
      return 'png';
    case 'image/webp':
      return 'webp';
  }
}

/**
 * Leading-byte signatures.
 *
 * WebP needs two runs at two offsets — `RIFF....WEBP` — and matching only the
 * `RIFF` container would accept a WAV file as an image, because WAV is also
 * RIFF. That is precisely the kind of near-miss a "first four bytes" check
 * waves through.
 */
const SIGNATURES: ReadonlyArray<{
  mime: AvatarMimeType;
  runs: ReadonlyArray<{ offset: number; magic: readonly number[] }>;
}> = [
  {
    // \x89 P N G \r \n \x1a \n — the full 8-byte header. The trailing
    // CRLF/EOF bytes are what make it a transfer-corruption detector too.
    mime: 'image/png',
    runs: [{ offset: 0, magic: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] }],
  },
  {
    // JPEG SOI + first marker byte.
    mime: 'image/jpeg',
    runs: [{ offset: 0, magic: [0xff, 0xd8, 0xff] }],
  },
  {
    // 'RIFF' ....(4 size bytes).... 'WEBP'
    mime: 'image/webp',
    runs: [
      { offset: 0, magic: [0x52, 0x49, 0x46, 0x46] },
      { offset: 8, magic: [0x57, 0x45, 0x42, 0x50] },
    ],
  },
];

/** How many bytes the caller must supply for a conclusive answer. Driven by
 *  the deepest run above (WebP's tag ends at byte 12). */
export const AVATAR_SIGNATURE_PROBE_BYTES = 16;

/**
 * What the leading bytes say this file is, or `null` for anything not
 * positively recognised.
 *
 * `null` is a REJECTION, never a shrug. Deciding by the absence of a known-bad
 * signature would let every new format through by default, which is the wrong
 * direction for bytes that get served publicly and cached for a year.
 */
export function detectAvatarMime(bytes: Uint8Array): AvatarMimeType | null {
  for (const { mime, runs } of SIGNATURES) {
    let matched = true;
    for (const { offset, magic } of runs) {
      if (bytes.length < offset + magic.length) {
        matched = false;
        break;
      }
      for (let i = 0; i < magic.length; i += 1) {
        if (bytes[offset + i] !== magic[i]) {
          matched = false;
          break;
        }
      }
      if (!matched) break;
    }
    if (matched) return mime;
  }
  return null;
}

export type AvatarSignatureVerdict =
  | { ok: true; detected: AvatarMimeType }
  | { ok: false; code: 'UNRECOGNISED_FORMAT' | 'DECLARED_TYPE_MISMATCH' | 'DISALLOWED_FORMAT' };

/**
 * The full check: the declared type must be allowed, the bytes must be
 * recognised, and the two must agree.
 *
 * Both halves matter. Trusting the declaration lets an HTML document be stored
 * and served as `image/png`. Trusting only the bytes lets a caller upload one
 * format while every consumer is told it is another, which is a spoofing
 * surface even when the file itself is benign.
 */
export function verifyAvatarSignature(
  declaredMime: string,
  bytes: Uint8Array,
): AvatarSignatureVerdict {
  if (!isAvatarMimeType(declaredMime)) return { ok: false, code: 'DISALLOWED_FORMAT' };

  const detected = detectAvatarMime(bytes);
  if (detected === null) return { ok: false, code: 'UNRECOGNISED_FORMAT' };
  if (detected !== declaredMime) return { ok: false, code: 'DECLARED_TYPE_MISMATCH' };

  return { ok: true, detected };
}
