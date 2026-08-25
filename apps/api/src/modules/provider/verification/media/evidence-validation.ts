import { isEvidenceMimeType, detectEvidenceMime, type EvidenceMimeType } from './file-signature';

// Sprint 9B.4 — is this an allowed, intact, honestly-named evidence file?
//
// docs/adr/0009-restricted-identity-media.md §4
//
// Deliberately separate from the malware scanner. A scanner answers "is this
// malicious?" and nothing else; it will happily clear a truncated PDF or a
// genuine PDF called `passport.png`. Neither is malware, and both are problems:
// the first hands a reviewer a document that will not open, and the second puts
// a lie next to the document in the review UI.
//
// Every rule fails CLOSED. Anything not positively recognised as an allowed,
// intact, honestly-named evidence file is refused — an unknown format is a
// rejection, never a shrug.
//
// Pure, so the decision is testable without a disk, a database or a scanner.

export type EvidenceValidationCode =
  /** Not a type identity evidence may ever be (SVG, video, anything else). */
  | 'DISALLOWED_FORMAT'
  /** The leading bytes match nothing we recognise. */
  | 'UNRECOGNISED_FORMAT'
  /** The bytes and the declared content type disagree. */
  | 'DECLARED_TYPE_MISMATCH'
  /** The bytes and the filename's extension disagree. */
  | 'EXTENSION_MISMATCH'
  /** Zero bytes. */
  | 'EMPTY'
  /** Over the configured ceiling. */
  | 'TOO_LARGE'
  /** The right format, but it does not end where that format must end. */
  | 'TRUNCATED';

export type EvidenceValidationVerdict =
  | { ok: true; detected: EvidenceMimeType }
  | { ok: false; code: EvidenceValidationCode };

/**
 * How far back from the end to look for an end-of-file marker.
 *
 * Bounded on purpose. A marker in the middle of a file is not an end marker,
 * so searching the whole body would accept a truncated document that happens
 * to contain the bytes earlier — and it would make validation O(file) instead
 * of O(window) for something that runs on every upload.
 *
 * 2 KiB comfortably covers a PDF trailer plus the padding real writers emit.
 */
const TAIL_WINDOW_BYTES = 2048;

/** The extensions each detected type may legitimately carry. */
const ALLOWED_EXTENSIONS: Record<EvidenceMimeType, readonly string[]> = {
  'application/pdf': ['pdf'],
  'image/png': ['png'],
  // Both spellings are ordinary and neither is more correct.
  'image/jpeg': ['jpg', 'jpeg'],
};

/** The bytes each format must END with, and how to look for them. */
const TERMINATORS: Record<EvidenceMimeType, { marker: Uint8Array; exact: boolean }> = {
  // A PDF ends with %%EOF, but writers legitimately pad after it, so the
  // marker only has to appear inside the tail window.
  'application/pdf': { marker: Buffer.from('%%EOF'), exact: false },
  // A PNG ends with the IEND chunk INCLUDING its CRC. Those are the final
  // bytes of a complete file, so anything after them means truncation or
  // tampering rather than padding.
  'image/png': {
    marker: Buffer.from([0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]),
    exact: true,
  },
  // JPEG ends with the EOI marker.
  'image/jpeg': { marker: Buffer.from([0xff, 0xd9]), exact: true },
};

/**
 * The final extension of a filename, lowercased, or null.
 *
 * The LAST extension is the one that decides: `passport.pdf.exe` is an
 * executable wearing a pdf in the middle, and judging the first would be
 * exactly the wrong answer.
 */
export function extensionForFilename(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const base = raw.split(/[\\/]/).pop() ?? '';
  const dot = base.lastIndexOf('.');
  // `dot < 1` covers both "no dot" and a LEADING dot — `.gitignore` is a
  // hidden file, not a file with a `gitignore` extension.
  if (dot < 1 || dot === base.length - 1) return null;
  return base.slice(dot + 1).toLowerCase();
}

function endsCorrectly(bytes: Uint8Array, detected: EvidenceMimeType): boolean {
  const { marker, exact } = TERMINATORS[detected];
  if (bytes.length < marker.length) return false;

  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  if (exact) {
    return buf.subarray(buf.length - marker.length).equals(Buffer.from(marker));
  }

  const from = Math.max(0, buf.length - TAIL_WINDOW_BYTES);
  return buf.subarray(from).includes(Buffer.from(marker));
}

/**
 * Validate a complete evidence body.
 *
 * ORDER IS DELIBERATE, because a caller acts on the reason they are given:
 *
 *   1. EMPTY / TOO_LARGE  — size first, so an oversized blob is refused
 *                           without inspecting it at all.
 *   2. DISALLOWED_FORMAT  — the declared type is not one we accept. Answered
 *                           before anything about the bytes, so a caller
 *                           sending SVG is told the format is wrong rather
 *                           than being invited to send a longer SVG.
 *   3. UNRECOGNISED / MISMATCH — what the bytes actually are.
 *   4. EXTENSION_MISMATCH — the name, once the bytes are known.
 *   5. TRUNCATED          — integrity, last, because it is only meaningful
 *                           once we know which format's rules apply.
 */
export function validateEvidenceBytes(input: {
  declaredMime: string;
  filename?: string | null;
  bytes: Uint8Array;
  maxBytes: number;
}): EvidenceValidationVerdict {
  const { declaredMime, filename, bytes, maxBytes } = input;

  if (bytes.length === 0) return { ok: false, code: 'EMPTY' };
  if (bytes.length > maxBytes) return { ok: false, code: 'TOO_LARGE' };

  if (!isEvidenceMimeType(declaredMime)) return { ok: false, code: 'DISALLOWED_FORMAT' };

  const detected = detectEvidenceMime(bytes);
  if (detected === null) return { ok: false, code: 'UNRECOGNISED_FORMAT' };
  if (detected !== declaredMime) return { ok: false, code: 'DECLARED_TYPE_MISMATCH' };

  const ext = extensionForFilename(filename);
  // A missing extension is not a lie. Only a PRESENT and WRONG one is.
  if (ext !== null && !ALLOWED_EXTENSIONS[detected].includes(ext)) {
    return { ok: false, code: 'EXTENSION_MISMATCH' };
  }

  if (!endsCorrectly(bytes, detected)) return { ok: false, code: 'TRUNCATED' };

  return { ok: true, detected };
}
