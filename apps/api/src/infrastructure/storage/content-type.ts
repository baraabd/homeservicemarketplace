// Whitelisted upload content types — the only mime values the presign
// endpoint accepts. Adding a new entry here is a deliberate decision
// (it changes what we let users upload + serve back to providers) so
// keep this list narrow.

export const ALLOWED_IMAGE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/heic',
  'image/heif',
] as const;

export const ALLOWED_VIDEO_TYPES = ['video/mp4', 'video/quicktime', 'video/webm'] as const;

export const ALLOWED_CONTENT_TYPES = [...ALLOWED_IMAGE_TYPES, ...ALLOWED_VIDEO_TYPES] as const;

export type ContentType = (typeof ALLOWED_CONTENT_TYPES)[number];

export function isAllowedContentType(value: unknown): value is ContentType {
  return typeof value === 'string' && (ALLOWED_CONTENT_TYPES as readonly string[]).includes(value);
}

/** Map a content type to a file extension for the synthesised key.
 *  We never trust a filename from the wire — the extension is derived
 *  server-side from the validated content type. */
export function extensionForContentType(ct: ContentType): string {
  switch (ct) {
    case 'image/jpeg':
      return 'jpg';
    case 'image/png':
      return 'png';
    case 'image/webp':
      return 'webp';
    case 'image/gif':
      return 'gif';
    case 'image/heic':
      return 'heic';
    case 'image/heif':
      return 'heif';
    case 'video/mp4':
      return 'mp4';
    case 'video/quicktime':
      return 'mov';
    case 'video/webm':
      return 'webm';
  }
}

/** Per-file size cap for the presign endpoint. Combined with
 *  `MAX_FILES_PER_REQUEST` this bounds the practical upload size of one
 *  create-request flow. */
export const MAX_BYTES_PER_FILE = 10 * 1024 * 1024; // 10 MB
/** Re-export of the shared `MAX_REQUEST_MEDIA_ITEMS` contract constant
 *  (single source of truth shared with the web wizard). Backend
 *  enforces it independently in the presign + create-request DTOs so a
 *  malicious client can't bypass the frontend cap. */
export { MAX_REQUEST_MEDIA_ITEMS as MAX_FILES_PER_REQUEST } from '@homeservicemarketplace/contracts';
