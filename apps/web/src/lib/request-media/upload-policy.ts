import { MAX_REQUEST_MEDIA_ITEMS } from './constants';

export const MAX_REQUEST_UPLOAD_BYTES = 10 * 1024 * 1024;
export interface UploadReservation {
  uploadUrl: string;
  fileUrl: string;
  expiresAt: string;
}

function usableUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.trim() !== value) return false;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.hash;
  } catch {
    return false;
  }
}

/** Validate the complete batch BEFORE starting any binary transfer. */
export function validateUploadReservations(raw: unknown, expected: number, now = Date.now()): UploadReservation[] {
  if (!Number.isInteger(expected) || expected < 1 || expected > MAX_REQUEST_MEDIA_ITEMS ||
      !raw || typeof raw !== 'object' || !('items' in raw) || !Array.isArray(raw.items) || raw.items.length !== expected) {
    throw new Error('Media upload reservation count does not match the selected files.');
  }
  const uploads = new Set<string>();
  const destinations = new Set<string>();
  return raw.items.map((item: unknown) => {
    if (!item || typeof item !== 'object' || !('uploadUrl' in item) || !('fileUrl' in item) || !('expiresAt' in item) ||
        !usableUrl(item.uploadUrl) || !usableUrl(item.fileUrl) || typeof item.expiresAt !== 'string' ||
        !Number.isFinite(Date.parse(item.expiresAt)) || Date.parse(item.expiresAt) <= now ||
        uploads.has(item.uploadUrl) || destinations.has(item.fileUrl)) {
      // Never include signed URLs or response bodies in diagnostics.
      throw new Error('Media upload reservation is invalid, duplicated or expired.');
    }
    uploads.add(item.uploadUrl);
    destinations.add(item.fileUrl);
    return { uploadUrl: item.uploadUrl, fileUrl: item.fileUrl, expiresAt: item.expiresAt };
  });
}
