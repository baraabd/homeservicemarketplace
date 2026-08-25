// Sprint 9B — what the BYTES say, not what the client claimed.
//
// docs/adr/0009-restricted-identity-media.md §4.
//
// The public request-media path validates the DECLARED content type against the
// presign and never inspects a byte of the body. That is survivable for a photo
// of a leaking tap. For identity evidence it means an attacker chooses the
// content type we record, and the file we hand a reviewer is whatever they sent.
//
// This module answers one question — "what is this actually?" — from the leading
// bytes, and the caller compares that to the claim.

/** The only formats identity evidence may be. Deliberately NARROWER than the
 *  public media allowlist:
 *
 *    no SVG    — it is a script-execution vector rendered by every browser
 *    no HEIC   — reviewers cannot reliably view it, and its parser surface is
 *                large for a format that adds nothing here
 *    no video  — a passport is not a video; allowing one is pure attack surface
 */
export const EVIDENCE_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png'] as const;

export type EvidenceMimeType = (typeof EVIDENCE_MIME_TYPES)[number];

export function isEvidenceMimeType(value: unknown): value is EvidenceMimeType {
  return typeof value === 'string' && (EVIDENCE_MIME_TYPES as readonly string[]).includes(value);
}

/** Extension for a DETECTED type. Keys are synthesised from what the file
 *  turned out to be, never from a client filename. */
export function extensionForEvidenceMime(mime: EvidenceMimeType): string {
  switch (mime) {
    case 'application/pdf':
      return 'pdf';
    case 'image/jpeg':
      return 'jpg';
    case 'image/png':
      return 'png';
  }
}

/** Leading-byte signatures. Matched in order; first hit wins. */
const SIGNATURES: ReadonlyArray<{ mime: EvidenceMimeType; magic: readonly number[] }> = [
  // %PDF-
  { mime: 'application/pdf', magic: [0x25, 0x50, 0x44, 0x46, 0x2d] },
  // \x89 P N G \r \n \x1a \n — the full 8-byte header, not just the first
  // three. The trailing CRLF/EOF bytes are what make a PNG header a
  // transfer-corruption detector, and truncating the check throws that away.
  { mime: 'image/png', magic: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  // JPEG SOI + first marker byte.
  { mime: 'image/jpeg', magic: [0xff, 0xd8, 0xff] },
];

/** How many bytes the caller must supply for a conclusive answer. */
export const SIGNATURE_PROBE_BYTES = 8;

/**
 * What the leading bytes say this file is, or `null` for anything we do not
 * positively recognise.
 *
 * `null` is a REJECTION, never a shrug: an unrecognised file is not stored as
 * "probably fine". Deciding by absence of a known-bad signature would let every
 * new format through by default, which is the wrong direction for a bucket that
 * holds passports.
 */
export function detectEvidenceMime(bytes: Uint8Array): EvidenceMimeType | null {
  for (const { mime, magic } of SIGNATURES) {
    if (bytes.length < magic.length) continue;
    let matched = true;
    for (let i = 0; i < magic.length; i += 1) {
      if (bytes[i] !== magic[i]) {
        matched = false;
        break;
      }
    }
    if (matched) return mime;
  }
  return null;
}

export type SignatureVerdict =
  | { ok: true; detected: EvidenceMimeType }
  | { ok: false; code: 'UNRECOGNISED_FORMAT' | 'DECLARED_TYPE_MISMATCH' | 'DISALLOWED_FORMAT' };

/**
 * The full check: the declared type must be allowed, the bytes must be
 * recognised, and the two must agree.
 *
 * Both halves matter. Trusting the declaration lets an executable be stored as
 * `image/png`. Trusting only the bytes lets a caller upload a PDF while telling
 * the reviewer UI it is a photo — which is a spoofing surface even though the
 * file itself is benign.
 */
export function verifyEvidenceSignature(declaredMime: string, bytes: Uint8Array): SignatureVerdict {
  if (!isEvidenceMimeType(declaredMime)) return { ok: false, code: 'DISALLOWED_FORMAT' };

  const detected = detectEvidenceMime(bytes);
  if (detected === null) return { ok: false, code: 'UNRECOGNISED_FORMAT' };
  if (detected !== declaredMime) return { ok: false, code: 'DECLARED_TYPE_MISMATCH' };

  return { ok: true, detected };
}

/**
 * A display label for a client-supplied filename.
 *
 * The filename NEVER builds a storage key — keys are synthesised from ids and
 * the DETECTED type — so this is purely about what a reviewer sees. It still
 * needs sanitising, because that label is rendered, logged as a length, and
 * would otherwise carry:
 *
 *   - path traversal (`../../etc/passwd`)
 *   - double extensions (`passport.pdf.exe`)
 *   - control characters and RTL overrides (U+202E), which visually reverse a
 *     filename so `exe.pdf` reads as `fdp.exe` — a classic spoof, and one that
 *     matters more in a product with real RTL users
 */
export function safeDisplayFilename(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;

  // Strip any directory component, both separators.
  const base = raw.split(/[\\/]/).pop() ?? '';

  const cleaned = Array.from(base)
    .filter((ch) => {
      const code = ch.codePointAt(0) ?? 0;
      // C0/C1 control characters and DEL.
      if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) return false;
      // Bidi overrides/embeddings and the isolate family.
      if (code >= 0x202a && code <= 0x202e) return false;
      if (code >= 0x2066 && code <= 0x2069) return false;
      return true;
    })
    .join('')
    .trim();

  if (cleaned === '' || cleaned === '.' || cleaned === '..') return null;

  // Collapse everything but the LAST extension, so `passport.pdf.exe` is shown
  // as `passport_pdf.exe` rather than being silently accepted as a PDF. The
  // stored type comes from the bytes regardless; this stops the LABEL lying.
  const parts = cleaned.split('.');
  const display =
    parts.length > 2 ? `${parts.slice(0, -1).join('_')}.${parts[parts.length - 1]}` : cleaned;

  return display.slice(0, 120);
}
