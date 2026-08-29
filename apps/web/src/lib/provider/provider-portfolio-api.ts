import type {
  CreateProviderPortfolioItemRequest,
  ProviderPortfolioItem,
  ProviderPortfolioListResponse,
  ProviderPublicProfilePreviewResponse,
  UpdateProviderPortfolioItemRequest,
} from '@homeservicemarketplace/contracts';

import { api } from '../api';

// Sprint 9B.10 — typed wrappers around /v1/me/provider/portfolio.
//
// Same shape as the sibling provider-*-api modules: `api` carries credentials,
// the request interceptor attaches the CSRF header on mutations, and the
// 401-refresh interceptor handles token rotation. Nothing here re-implements
// any of that.
//
// UPLOAD REUSES THE EXISTING PUBLIC MEDIA PIPELINE. There is no second upload
// system: `POST /v1/media/presigned-url` mints the key and the PUT target,
// exactly as the seeker job wizard already does, and the only addition is
// `purpose: 'portfolio'` so the server files it under the portfolio namespace
// rather than the request one.

export async function listPortfolio(): Promise<ProviderPortfolioListResponse> {
  const { data } = await api.get<ProviderPortfolioListResponse>('/v1/me/provider/portfolio');
  return data;
}

export async function createPortfolioItem(
  input: CreateProviderPortfolioItemRequest,
): Promise<ProviderPortfolioItem> {
  const { data } = await api.post<ProviderPortfolioItem>('/v1/me/provider/portfolio', input);
  return data;
}

export async function updatePortfolioItem(
  itemId: string,
  input: UpdateProviderPortfolioItemRequest,
): Promise<ProviderPortfolioItem> {
  const { data } = await api.patch<ProviderPortfolioItem>(
    `/v1/me/provider/portfolio/${itemId}`,
    input,
  );
  return data;
}

export async function reorderPortfolio(itemIds: string[]): Promise<ProviderPortfolioListResponse> {
  const { data } = await api.post<ProviderPortfolioListResponse>(
    '/v1/me/provider/portfolio/reorder',
    { itemIds },
  );
  return data;
}

export async function deletePortfolioItem(itemId: string): Promise<void> {
  await api.delete(`/v1/me/provider/portfolio/${itemId}`);
}

export interface PreparedPortfolioUpload {
  uploadUrl: string;
  /** The server-minted key. This — not the URL — is what the create call
   *  carries, because a URL is an arbitrary string the server would have to
   *  trust, and a key is one it minted itself. */
  storageKey: string;
  expiresAt: string;
}

/**
 * Step 1 of the upload: ask the existing media endpoint for a signed PUT.
 *
 * The storage key is recovered from the returned `fileUrl` rather than being
 * chosen here. The client must never invent a key: server-synthesised keys are
 * the whole reason the upload path is not a path-traversal vector.
 */
export async function preparePortfolioUpload(file: File): Promise<PreparedPortfolioUpload> {
  const { data } = await api.post<{
    items: Array<{ uploadUrl: string; fileUrl: string; expiresAt: string }>;
  }>('/v1/media/presigned-url', {
    purpose: 'portfolio',
    items: [{ contentType: file.type, sizeBytes: file.size }],
  });

  const item = data.items[0];
  return {
    uploadUrl: item.uploadUrl,
    storageKey: storageKeyFromFileUrl(item.fileUrl),
    expiresAt: item.expiresAt,
  };
}

/**
 * Step 2: PUT the bytes.
 *
 * Uses XMLHttpRequest rather than fetch for one reason — `upload.onprogress`.
 * fetch has no upload progress event, and a provider on a phone uploading a
 * multi-megabyte photo over a slow connection needs to see that something is
 * happening or they will tap again and again.
 */
export function uploadPortfolioFile(
  uploadUrl: string,
  file: File,
  onProgress?: (percent: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', uploadUrl, true);
    xhr.setRequestHeader('Content-Type', file.type);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(`upload failed: ${xhr.status}`));
    xhr.onerror = () => reject(new Error('upload failed'));
    xhr.onabort = () => reject(new Error('upload aborted'));
    xhr.send(file);
  });
}

/** `fileUrl` is `<origin>/v1/media/files/<key>` for the local backend and an
 *  S3 URL in production. Both end with the key, so it is recovered by
 *  splitting on the marker rather than by parsing an origin that differs
 *  between environments. */
function storageKeyFromFileUrl(fileUrl: string): string {
  const marker = '/v1/media/files/';
  const idx = fileUrl.indexOf(marker);
  if (idx >= 0) return fileUrl.slice(idx + marker.length);
  // S3: everything after the bucket host and before the query string.
  try {
    return new URL(fileUrl).pathname.replace(/^\/+/, '');
  } catch {
    return fileUrl;
  }
}

// ─── Sprint 9B.22 ────────────────────────────────────────────────────────────

/**
 * What a customer would see, built by the server from the PUBLIC projection.
 *
 * A separate call rather than a field on the onboarding draft, and that is the
 * point: the draft is the private working copy, and a preview rendered from it
 * would be a preview of the wrong object. This asks the server the question a
 * customer's request would ask.
 */
export async function fetchPublicProfilePreview(
  lang: 'en' | 'ar',
): Promise<ProviderPublicProfilePreviewResponse> {
  const { data } = await api.get<ProviderPublicProfilePreviewResponse>(
    '/v1/me/provider/public-profile/preview',
    { params: { lang } },
  );
  return data;
}
