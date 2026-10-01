import { MAX_REQUEST_MEDIA_ITEMS } from './constants';

export const MAX_REQUEST_UPLOAD_BYTES = 10 * 1024 * 1024;
export interface UploadReservation {
  /** R06 — the server-issued asset id. Request creation accepts only this. */
  assetId: string;
  uploadUrl: string;
  fileUrl: string;
  expiresAt: string;
}

/** Server-minted cuid. Mirrors the API's own edge validation. */
const ASSET_ID = /^[a-z0-9]{20,40}$/;

function usableUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.trim() !== value) return false;
  try {
    const url = new URL(value);
    return (
      ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.hash
    );
  } catch {
    return false;
  }
}

function usableAssetId(value: unknown): value is string {
  return typeof value === 'string' && ASSET_ID.test(value);
}

/** Validate the complete batch BEFORE starting any binary transfer. */
export function validateUploadReservations(
  raw: unknown,
  expected: number,
  now = Date.now(),
): UploadReservation[] {
  if (
    !Number.isInteger(expected) ||
    expected < 1 ||
    expected > MAX_REQUEST_MEDIA_ITEMS ||
    !raw ||
    typeof raw !== 'object' ||
    !('items' in raw) ||
    !Array.isArray(raw.items) ||
    raw.items.length !== expected
  ) {
    throw new Error('Media upload reservation count does not match the selected files.');
  }
  const uploads = new Set<string>();
  const destinations = new Set<string>();
  const assets = new Set<string>();
  return raw.items.map((item: unknown) => {
    if (
      !item ||
      typeof item !== 'object' ||
      !('uploadUrl' in item) ||
      !('fileUrl' in item) ||
      !('expiresAt' in item) ||
      !('assetId' in item) ||
      !usableAssetId(item.assetId) ||
      !usableUrl(item.uploadUrl) ||
      !usableUrl(item.fileUrl) ||
      typeof item.expiresAt !== 'string' ||
      !Number.isFinite(Date.parse(item.expiresAt)) ||
      Date.parse(item.expiresAt) <= now ||
      uploads.has(item.uploadUrl) ||
      destinations.has(item.fileUrl) ||
      assets.has(item.assetId)
    ) {
      // Never include signed URLs or response bodies in diagnostics.
      throw new Error('Media upload reservation is invalid, duplicated or expired.');
    }
    uploads.add(item.uploadUrl);
    destinations.add(item.fileUrl);
    assets.add(item.assetId);
    return {
      assetId: item.assetId,
      uploadUrl: item.uploadUrl,
      fileUrl: item.fileUrl,
      expiresAt: item.expiresAt,
    };
  });
}

/**
 * Validate the server's finalize answer against the ids that were sent.
 *
 * The request is only published with ids the server confirmed, in the order
 * the files were selected. A short, reordered or substituted answer is refused
 * rather than trusted.
 */
export function validateFinalizedAttachments(
  raw: unknown,
  expectedAssetIds: readonly string[],
): string[] {
  if (
    !raw ||
    typeof raw !== 'object' ||
    !('items' in raw) ||
    !Array.isArray(raw.items) ||
    raw.items.length !== expectedAssetIds.length
  ) {
    throw new Error('Media upload could not be confirmed.');
  }
  return raw.items.map((item: unknown, index: number) => {
    if (
      !item ||
      typeof item !== 'object' ||
      !('assetId' in item) ||
      item.assetId !== expectedAssetIds[index]
    ) {
      throw new Error('Media upload could not be confirmed.');
    }
    return expectedAssetIds[index];
  });
}
