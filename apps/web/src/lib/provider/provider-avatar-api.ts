import type { ProviderOnboardingDraftView } from '@homeservicemarketplace/contracts';

import { api } from '../api';

// Sprint 9B.17 — the avatar upload pipeline, client side.
//
// Three stages, and the third is the one that matters:
//
//   1. POST /v1/media/presigned-url  { purpose: 'avatar' }
//   2. PUT  <uploadUrl>              raw bytes, straight to storage
//   3. POST /v1/me/provider/onboarding/avatar  { key, version }
//
// Stage 2 succeeding means the bytes are somewhere. It does NOT mean they are
// this provider's photo: with S3 that PUT never touches our API, so at that
// moment the server has verified nothing but a content type it agreed to five
// minutes ago. Stage 3 is where the server reads the object back, checks what
// actually landed, and links it. Nothing on this screen may report success
// before stage 3 returns.
//
// The KEY is what stage 3 sends, never the URL. The server recomputes the URL
// from a key it minted and owns; a client-supplied URL would be a pointer
// nobody validated.

/** The formats an avatar may be, mirroring the server allowlist. Narrower than
 *  the shared upload allowlist — no GIF, no HEIC, no video. */
export const AVATAR_UPLOAD_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type AvatarUploadType = (typeof AVATAR_UPLOAD_TYPES)[number];

export function isAvatarUploadType(value: string): value is AvatarUploadType {
  return (AVATAR_UPLOAD_TYPES as readonly string[]).includes(value);
}

export interface PresignedAvatar {
  uploadUrl: string;
  fileUrl: string;
  expiresAt: string;
}

/** Stage 1. Goes through the shared axios instance, so auth, CSRF and the
 *  401-refresh flow behave as on every other authed call. */
export async function presignAvatar(file: {
  contentType: AvatarUploadType;
  sizeBytes: number;
  filename?: string;
}): Promise<PresignedAvatar> {
  const { data } = await api.post<{ items: PresignedAvatar[] }>('/v1/media/presigned-url', {
    purpose: 'avatar',
    items: [file],
  });
  const item = data.items[0];
  if (!item) throw new Error('presign returned no item');
  return item;
}

/**
 * Stage 2 — PUT the bytes, reporting progress.
 *
 * XMLHttpRequest rather than fetch, for one reason: fetch cannot report UPLOAD
 * progress. On a phone connection an avatar upload is several seconds of
 * nothing, and a spinner that cannot say how far along it is has no answer to
 * "is this stuck?" other than making the person guess.
 *
 * The signed URL IS the auth — no Authorization header and no cookies, exactly
 * like an S3 PUT.
 */
export function putAvatarBytes(
  blob: Blob,
  uploadUrl: string,
  options: { onProgress?: (fraction: number) => void; signal?: AbortSignal } = {},
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', uploadUrl, true);
    // The presigned URL was issued for THIS exact content type; both backends
    // reject a PUT whose header disagrees with the signed value.
    xhr.setRequestHeader('Content-Type', blob.type);

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;
      options.onProgress?.(event.loaded / event.total);
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        options.onProgress?.(1);
        resolve();
        return;
      }
      // The body is an XML envelope on S3 and JSON locally. Neither is useful
      // to a provider, and echoing it would put backend detail on screen.
      reject(new Error(`upload-failed-${xhr.status}`));
    };
    xhr.onerror = () => reject(new Error('upload-network'));
    xhr.onabort = () => reject(new DOMException('aborted', 'AbortError'));

    if (options.signal) {
      if (options.signal.aborted) {
        xhr.abort();
        return;
      }
      options.signal.addEventListener('abort', () => xhr.abort(), { once: true });
    }

    xhr.send(blob);
  });
}

/**
 * Stage 3 — the server verifies the stored object and links it.
 *
 * Sends the KEY derived from the presigned upload URL, plus the draft version
 * for the same optimistic-concurrency contract every other field write uses.
 * Returns the complete draft view, so the caller seeds its cache rather than
 * refetching.
 */
export async function finalizeAvatar(input: {
  key: string;
  version: number;
}): Promise<ProviderOnboardingDraftView> {
  const { data } = await api.post<ProviderOnboardingDraftView>(
    '/v1/me/provider/onboarding/avatar',
    input,
  );
  return data;
}

/** Detach the photo. Versioned like any other write, so it cannot slip past
 *  the edit lock on a submitted application. */
export async function removeAvatar(version: number): Promise<ProviderOnboardingDraftView> {
  const { data } = await api.post<ProviderOnboardingDraftView>(
    '/v1/me/provider/onboarding/avatar/remove',
    { version },
  );
  return data;
}

/**
 * Recover the storage key from a presigned upload URL.
 *
 * Both backends put the key in the PATH — `/v1/media/uploads/<key>` locally,
 * `/<bucket-or-host>/<key>` on S3 — with the signature in the query string, so
 * the key is the path with the local route prefix removed and the query
 * dropped. Derived here rather than sent by the server as a separate field so
 * there is one fewer thing for the two to disagree about.
 */
export function keyFromUploadUrl(uploadUrl: string): string {
  const withoutQuery = uploadUrl.split('?')[0] ?? '';
  const marker = '/v1/media/uploads/';
  const idx = withoutQuery.indexOf(marker);
  if (idx >= 0) return decodeURIComponent(withoutQuery.slice(idx + marker.length));

  // S3-style: everything after the origin, minus a leading slash. The bucket
  // is part of the host in virtual-hosted style, and part of the path in
  // path-style — the `avatars/` prefix is what the server checks, and it
  // survives either.
  try {
    const url = new URL(withoutQuery);
    const path = url.pathname.replace(/^\/+/, '');
    const avatarsAt = path.indexOf('avatars/');
    return decodeURIComponent(avatarsAt >= 0 ? path.slice(avatarsAt) : path);
  } catch {
    return withoutQuery;
  }
}
