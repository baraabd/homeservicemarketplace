// Media-upload pipeline (Sprint 7.x).
//
// Two-stage flow on the wire:
//   1. POST /v1/media/presigned-url  — auth + CSRF gated. Returns one
//      presigned PUT URL per file plus the final fileUrl that goes
//      onto ServiceRequest.mediaUrls[].
//   2. PUT  <uploadUrl>               — raw binary, sent via native
//      `fetch` so axios's JSON-encoding interceptor doesn't muck with
//      the bytes. The signed URL IS the auth — no Authorization
//      header, no cookies, exactly like an S3 PUT.

import { api } from './api';

/** Whitelisted content types — mirror of
 *  apps/api/src/infrastructure/storage/content-type.ts. The wire
 *  rejects anything else with 400 VALIDATION_ERROR; pinning the
 *  union here lets the wizard's File-pick step refuse non-matching
 *  types up-front instead of round-tripping. */
export const ALLOWED_UPLOAD_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/heic',
  'image/heif',
  'video/mp4',
  'video/quicktime',
  'video/webm',
] as const;

export type AllowedUploadType = (typeof ALLOWED_UPLOAD_TYPES)[number];

export function isAllowedUploadType(value: string): value is AllowedUploadType {
  return (ALLOWED_UPLOAD_TYPES as readonly string[]).includes(value);
}

interface PresignItemRequest {
  contentType: AllowedUploadType;
  sizeBytes: number;
  filename?: string;
}

export interface PresignedItem {
  uploadUrl: string;
  fileUrl: string;
  expiresAt: string;
}

interface PresignResponse {
  items: PresignedItem[];
}

/** Stage 1 — ask the API for one presigned PUT URL per file. The
 *  response order mirrors the request order. Goes through the
 *  shared axios instance so auth + CSRF + the 401-refresh flow all
 *  work as on every other authed call. */
export async function requestPresignedUploads(
  items: PresignItemRequest[],
): Promise<PresignedItem[]> {
  const { data } = await api.post<PresignResponse>('/v1/media/presigned-url', { items });
  return data.items;
}

/** Stage 2 — PUT the binary File to the signed URL. Native fetch on
 *  purpose: axios defaults to `Content-Type: application/json` +
 *  serialises the body, and we need raw bytes. Throws on non-2xx so
 *  the wizard's `Promise.all` short-circuits cleanly. */
export async function uploadFileToPresignedUrl(
  file: File,
  uploadUrl: string,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      // The presigned URL was issued for THIS exact content type. The
      // backend (or S3) will reject the PUT if the header doesn't
      // match the signed value.
      'Content-Type': file.type,
    },
    body: file,
    signal,
  });
  if (!res.ok) {
    // Don't include the response body in the thrown error — for S3
    // it's an XML envelope and for the local backend it's a JSON
    // error. The wizard renders a friendly toast either way.
    throw new Error(`upload failed: HTTP ${res.status}`);
  }
}

/** Higher-level helper used by the wizard. Presigns every file in
 *  one round-trip then PUTs them in parallel, returning the array of
 *  fileUrls in the original input order. Throws if ANY upload fails
 *  — the wizard treats that as "post is blocked, show a retry toast"
 *  rather than persisting a request with partial media. */
export async function uploadAll(files: File[]): Promise<string[]> {
  if (files.length === 0) return [];
  const items = files.map((f) => ({
    contentType: f.type as AllowedUploadType,
    sizeBytes: f.size,
    filename: f.name,
  }));
  const presigned = await requestPresignedUploads(items);
  await Promise.all(presigned.map((p, i) => uploadFileToPresignedUrl(files[i]!, p.uploadUrl)));
  return presigned.map((p) => p.fileUrl);
}
