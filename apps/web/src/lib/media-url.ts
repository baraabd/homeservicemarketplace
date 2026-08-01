// Sprint 7.13 — media URL resolution for <img src>.
//
// Media fileUrls usually arrive already absolute (the local-disk
// backend builds `${PUBLIC_API_URL}/v1/media/files/<key>`; S3 returns
// absolute object URLs). But to be robust against a backend that
// emits a relative path (e.g. `/v1/media/files/<key>`) or a bare
// storage key, this helper normalises any input to something the
// browser can render directly — without ever double-prefixing an
// already-absolute URL.
//
// Rules:
//   - empty / nullish              → '' (caller renders a placeholder)
//   - absolute http(s):// URL      → unchanged
//   - data: / blob: URL            → unchanged (local preview)
//   - protocol-relative //host/... → unchanged
//   - root-relative /path          → API_BASE_URL + path
//   - bare key `requests/a/b.jpg`  → API_BASE_URL + '/v1/media/files/' + key
//
// Never logs the URL (signed URLs must not leak to logs/analytics).

import { API_BASE_URL } from './api';

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

export function resolveMediaUrl(
  url: string | null | undefined,
  base: string = API_BASE_URL,
): string {
  if (url == null) return '';
  const trimmed = url.trim();
  if (trimmed.length === 0) return '';

  // Already-renderable forms — pass through untouched (no double-prefix).
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^(data|blob):/i.test(trimmed)) return trimmed;
  if (trimmed.startsWith('//')) return trimmed;

  const baseClean = trimTrailingSlash(base ?? '');

  // Root-relative API path.
  if (trimmed.startsWith('/')) return `${baseClean}${trimmed}`;

  // Bare storage key → the public file-serve route.
  return `${baseClean}/v1/media/files/${trimmed}`;
}
