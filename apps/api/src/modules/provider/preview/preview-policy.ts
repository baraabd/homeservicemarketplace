import { createHash } from 'node:crypto';

import type { PreviewPolicy } from './preview-redaction';

// Sprint 9B.9 — resolving the preview policy, and failing closed while doing it.
//
// docs/sprint-09b9/REDACTED_MARKETPLACE_PREVIEW.md
//
// The values live in ADMIN_SETTINGS_SCHEMA and are read from the same
// PlatformSetting rows the admin screen writes, so the policy enforced is the
// policy an operator was shown.
//
// THE FALLBACK DIRECTION IS THE OPPOSITE OF THE OTHER SETTINGS IN THIS
// CODEBASE, AND DELIBERATELY SO
//
// Every other limit here falls back to its schema default on a bad read,
// because those limits can only ever REFUSE something and a settings outage
// must not stop the marketplace. This one can only ever DISCLOSE something.
// A missing, malformed or unreadable value therefore resolves to
// `enabled: false` — the preview disappears rather than appearing with
// unknown limits.
//
// The same asymmetry applies inside an enabled policy: a cell size that cannot
// be trusted resolves to the LARGEST configured cell, not the default one,
// because a too-coarse preview is a worse product and a too-fine one is a
// privacy incident.

export const PREVIEW_ENABLED_KEY = 'marketplace_preview_enabled';
export const PREVIEW_CELL_KM_KEY = 'marketplace_preview_cell_km';
export const PREVIEW_PAGE_SIZE_KEY = 'marketplace_preview_page_size';
export const PREVIEW_MAX_ITEMS_KEY = 'marketplace_preview_max_items';

/** Bounds mirrored from the settings schema. Duplicated here ON PURPOSE: a row
 *  written by something that bypassed the admin validation must still be
 *  clamped at the point of use, and the clamp must not depend on the schema
 *  being loadable. */
export const PREVIEW_BOUNDS = {
  cellKm: { min: 5, max: 200, fallback: 200 },
  pageSize: { min: 1, max: 25, fallback: 1 },
  maxItems: { min: 1, max: 200, fallback: 1 },
} as const;

export type ResolvedPreviewPolicy =
  | { enabled: false }
  | ({ enabled: true; fingerprint: string } & PreviewPolicy);

/**
 * Turn raw setting values into a policy, or into "off".
 *
 * Takes plain values rather than a service so the whole decision table is
 * assertable without a database — which matters, because the interesting cases
 * are all malformed input.
 */
export function resolvePreviewPolicy(raw: {
  enabled: unknown;
  cellKm: unknown;
  pageSize: unknown;
  maxItems: unknown;
}): ResolvedPreviewPolicy {
  // Strictly `true`. Not truthy: the string "false" is truthy, and a settings
  // row that somehow held it would otherwise switch the preview ON.
  if (raw.enabled !== true) return { enabled: false };

  const cellKm = clamp(raw.cellKm, PREVIEW_BOUNDS.cellKm);
  const pageSize = clamp(raw.pageSize, PREVIEW_BOUNDS.pageSize);
  const maxItems = clamp(raw.maxItems, PREVIEW_BOUNDS.maxItems);

  return {
    enabled: true,
    cellKm,
    pageSize,
    maxItems,
    fingerprint: fingerprintOf({ cellKm, pageSize, maxItems }),
  };
}

/**
 * A short, stable digest of the policy actually applied.
 *
 * This is what makes a mutable settings table auditable. The rows can be
 * edited at any time and keep no history of their own, so an audit line saying
 * "a preview was served" would be unanswerable a week later: served under what
 * limits? The fingerprint is recorded alongside, so "which policy was in force
 * when this was disclosed" has an answer that survives the next edit.
 *
 * It carries no secret and identifies no person, so it is safe in a log line.
 */
export function fingerprintOf(policy: PreviewPolicy): string {
  return createHash('sha256')
    .update(`${policy.cellKm}|${policy.pageSize}|${policy.maxItems}`)
    .digest('hex')
    .slice(0, 12);
}

function clamp(value: unknown, bounds: { min: number; max: number; fallback: number }): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) {
    return bounds.fallback;
  }
  if (value < bounds.min) return bounds.fallback;
  if (value > bounds.max) return bounds.max;
  return value;
}
