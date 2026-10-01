import type { ContentType } from './content-type';

// R06 — what the stored bytes of a request attachment actually are.
//
// With a browser-direct upload the API never sees the body, only the client's
// claim about it. Finalization reads the leading bytes back from storage and
// decides the type from them, so a renamed executable or an HTML document
// declared as `image/jpeg` is refused before anything attaches it to a request.

/** Enough for every signature below; an ISO-BMFF brand ends at byte 12. */
export const MEDIA_SIGNATURE_PROBE_BYTES = 32;

/** HEIF-family major brands (ISO/IEC 23008-12). */
const HEIF_BRANDS = new Set([
  'heic',
  'heix',
  'hevc',
  'hevx',
  'heim',
  'heis',
  'hevm',
  'hevs',
  'mif1',
  'msf1',
  'heif',
]);
/** ISO-BMFF image brands that are neither HEIF nor an accepted video. */
const OTHER_IMAGE_BRANDS = new Set(['avif', 'avis']);
const QUICKTIME_BRAND = 'qt  ';

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false;
  return signature.every((value, index) => bytes[offset + index] === value);
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.slice(start, end));
}

/** The ISO-BMFF major brand, or null when the bytes are not an `ftyp` box. */
function isoBmffBrand(bytes: Uint8Array): string | null {
  if (bytes.length < 12 || ascii(bytes, 4, 8) !== 'ftyp') return null;
  return ascii(bytes, 8, 12);
}

/**
 * The content type the leading bytes prove, or null.
 *
 * `declared` is consulted only to choose between container types that share a
 * signature family (HEIC vs HEIF, both HEIF brands). It can never turn bytes
 * of one family into another: a PNG declared as JPEG returns `image/png`.
 */
export function detectMediaType(bytes: Uint8Array, declared: ContentType): ContentType | null {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38]) && (bytes[4] === 0x37 || bytes[4] === 0x39)) {
    return bytes[5] === 0x61 ? 'image/gif' : null;
  }
  if (
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)
  ) {
    return 'image/webp';
  }
  if (startsWith(bytes, [0x1a, 0x45, 0xdf, 0xa3])) return 'video/webm';

  const brand = isoBmffBrand(bytes);
  if (brand === null) return null;
  if (HEIF_BRANDS.has(brand)) return declared === 'image/heif' ? 'image/heif' : 'image/heic';
  if (OTHER_IMAGE_BRANDS.has(brand)) return null;
  if (brand === QUICKTIME_BRAND) return 'video/quicktime';
  return 'video/mp4';
}

export type MediaSignatureVerdict =
  | { ok: true; detected: ContentType }
  | { ok: false; detected: ContentType | null };

/** Do the stored bytes match the type the reservation was issued for? */
export function verifyMediaSignature(
  declared: ContentType,
  bytes: Uint8Array,
): MediaSignatureVerdict {
  const detected = detectMediaType(bytes, declared);
  if (detected !== null && detected === declared) return { ok: true, detected };
  return { ok: false, detected };
}
