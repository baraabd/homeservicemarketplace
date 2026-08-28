import { createHmac } from 'node:crypto';

import {
  AVATAR_MIME_TYPES,
  type AvatarMimeType,
} from '../../../../infrastructure/storage/image-signature';
import { EVIDENCE_KEY_PREFIX } from '../../portfolio/portfolio-policy';

// Sprint 9B.17 — the avatar rules, with no database in sight.
//
// Modelled on portfolio-policy.ts deliberately, because the separation it
// protects is the same one and it must not be re-derived per feature: a
// provider's avatar is PUBLIC, identity evidence is RESTRICTED, and the
// direction that must be impossible is an avatar pointing at an evidence
// object. A provider who managed that would publish their own passport beside
// their name on every screen a customer sees.
//
// So the storage KEY is checked, not the visibility column. A key is fixed at
// upload time, written by the server, and cannot be changed later by any
// route. A column is a field, and fields get updated by code nobody re-reads.

/** Where avatar uploads live.
 *
 *  Its own prefix rather than a reuse of `portfolio/`: the two have different
 *  lifecycles (an avatar is replaced, a portfolio grows), different limits, and
 *  a cleanup job for one must not be able to reach the other. Sharing a
 *  namespace by convenience is how a portfolio sweep deletes people's faces. */
export const AVATAR_KEY_PREFIX = 'avatars/';

/**
 * The owner segment of an avatar storage key.
 *
 * An HMAC of the user id, NOT the user id — the same reasoning as
 * `portfolioOwnerRef`, and for a URL that is even more widely handed out. An
 * avatar appears next to a provider on search results, bids, chat and bookings,
 * so a raw user id inside it publishes an internal identifier to everyone who
 * ever loads one, and correlates that provider across every other surface.
 *
 * Deterministic, so ownership can be RECOMPUTED at finalize rather than stored
 * and trusted, and one-way, so a URL cannot be walked back to an account.
 *
 * The domain separator differs from the portfolio's, so the same user's two
 * namespaces cannot be swapped for one another by anyone who learns one ref.
 */
export function avatarOwnerRef(userId: string, secret: string): string {
  return createHmac('sha256', secret).update(`avatar-owner:${userId}`).digest('hex').slice(0, 24);
}

export type AvatarRefusal =
  | 'NOT_AN_AVATAR_KEY'
  | 'DISALLOWED_FORMAT'
  | 'FILE_TOO_LARGE'
  | 'FILE_MISSING'
  | 'CONTENT_MISMATCH';

export class AvatarPolicyError extends Error {
  constructor(
    readonly code: AvatarRefusal,
    message: string,
  ) {
    super(message);
    this.name = 'AvatarPolicyError';
  }
}

/**
 * Only the image formats an avatar may be.
 *
 * Narrower than the platform allowlist — see image-signature.ts for which and
 * why. Checked on the DECLARED type at presign, and again on the DETECTED type
 * at finalize; passing one is not passing the other.
 */
export function assertAvatarContentType(contentType: string): void {
  if (!(AVATAR_MIME_TYPES as readonly string[]).includes(contentType)) {
    throw new AvatarPolicyError(
      'DISALLOWED_FORMAT',
      'A profile photo must be a JPEG, PNG or WebP image.',
    );
  }
}

/**
 * The key must be one the presign step minted for THIS provider's avatar.
 *
 * Four refusals in one, and the order is the point:
 *
 *   1. the evidence prefix, named explicitly so the intent survives a refactor
 *      that changes what "avatar" means;
 *   2. the portfolio prefix is NOT refused here — it is simply not the avatar
 *      prefix, and (2) catches it — but the ownership segment is what stops one
 *      provider adopting another's uploaded file by guessing a key;
 *   3. traversal, absolute paths and null bytes, because the presign endpoint
 *      synthesises keys and never echoes a filename, so a key containing any of
 *      these did not come from it.
 */
export function assertAvatarKey(key: string, ownerRef: string): void {
  const expectedPrefix = `${AVATAR_KEY_PREFIX}${ownerRef}/`;

  if (key.startsWith(EVIDENCE_KEY_PREFIX)) {
    throw new AvatarPolicyError('NOT_AN_AVATAR_KEY', 'That file is not a profile photo.');
  }
  if (!key.startsWith(expectedPrefix)) {
    throw new AvatarPolicyError('NOT_AN_AVATAR_KEY', 'That file is not a profile photo.');
  }
  if (key.includes('..') || key.includes('\0') || key.includes('//')) {
    throw new AvatarPolicyError('NOT_AN_AVATAR_KEY', 'That file is not a profile photo.');
  }
}

/** The ceiling for a stored avatar, checked against what the BACKEND counted
 *  rather than what the client declared. */
export function assertAvatarWithinLimit(sizeBytes: number, maxFileBytes: number): void {
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0 || sizeBytes > maxFileBytes) {
    throw new AvatarPolicyError('FILE_TOO_LARGE', 'That image is too large to use as a photo.');
  }
}

/**
 * Is this string safe to store as a profile image reference at all?
 *
 * Used on the LEGACY wizard's free-text `profileImageUrl` as well as the V2
 * path. The legacy field accepts any URL a provider types, which was harmless
 * while nothing restricted was addressable — and stopped being harmless the
 * moment an evidence namespace existed. This does not try to validate that the
 * URL is an avatar we minted (the legacy field predates the concept and
 * tightening it would break existing profiles); it refuses the one shape that
 * must never be stored there.
 */
export function referencesRestrictedMedia(value: string): boolean {
  const lowered = value.toLowerCase();
  // Match the namespace as a PATH SEGMENT, so `/verification/...` is caught
  // wherever it appears in a URL, while an innocent host or filename
  // containing the word (say `verification-badge.png`) is not.
  return (
    lowered.startsWith(`${EVIDENCE_KEY_PREFIX.toLowerCase()}`) ||
    /(^|[/])verification\//.test(lowered)
  );
}

export type { AvatarMimeType };
