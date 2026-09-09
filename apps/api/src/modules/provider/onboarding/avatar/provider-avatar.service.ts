import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ProviderOnboardingDraftView } from '@homeservicemarketplace/contracts';

import { AppConfigService } from '../../../../config/app-config.service';
import {
  AVATAR_SIGNATURE_PROBE_BYTES,
  isAvatarMimeType,
  verifyAvatarSignature,
} from '../../../../infrastructure/storage/image-signature';
import { STORAGE_PORT, StoragePort } from '../../../../infrastructure/storage/storage.port';
import { AppError } from '../../../../shared/errors/app-error';
import { PublicMediaLedgerService } from '../../../media/public-media-ledger.service';
import { ProviderOnboardingWizardService } from '../provider-onboarding-wizard.service';
import {
  AVATAR_KEY_PREFIX,
  AvatarPolicyError,
  assertAvatarKey,
  assertAvatarWithinLimit,
  avatarOwnerRef,
} from './avatar-policy';

// Sprint 9B.17 — FINALIZE, the only point at which an uploaded avatar becomes
// a provider's avatar.
//
// WHY A FINALIZE STEP EXISTS AT ALL
//
// The browser uploads straight to storage. With S3 that PUT never touches this
// API — we signed a URL and heard nothing more. So at the moment the upload
// "succeeds" from the client's point of view, the server has verified nothing
// except that it once agreed to a content type and a size. Everything the
// client said about what it was going to send is a claim.
//
// This step is where the claims are replaced with facts: the object is read
// back from storage, its size is the size the BACKEND counted, and its type is
// whatever its leading bytes say. Only then does anything get linked.
//
// WHAT IT REFUSES, AND WHY EACH ONE MATTERS
//
//   not our namespace   an avatar pointing into the evidence namespace would
//                       publish a provider's passport next to their name
//   not our owner ref   otherwise one provider adopts another's uploaded file
//                       by guessing a key
//   nothing there       a dropped PUT must not leave a profile pointing at a
//                       404
//   too large           the declared size was a claim; this is the measurement
//   bytes disagree      a file declared PNG that is not a PNG is either a
//                       spoof or a corruption, and neither should be served
//                       from a public, year-cached URL

/** The ceiling for a stored avatar.
 *
 *  A constant rather than an operator setting, unlike the portfolio's: an
 *  avatar is one small square image that the client already downscales and
 *  re-encodes before upload, so there is no operational reason to tune it, and
 *  a settings row nobody changes is a migration and an admin screen for
 *  nothing. Generous enough that a phone photo that skipped compression still
 *  lands. */
export const AVATAR_MAX_BYTES = 5 * 1024 * 1024;

@Injectable()
export class ProviderAvatarService {
  private readonly log = new Logger(ProviderAvatarService.name);

  constructor(
    @Inject(STORAGE_PORT) private readonly storage: StoragePort,
    private readonly config: AppConfigService,
    private readonly ledger: PublicMediaLedgerService,
    private readonly wizard: ProviderOnboardingWizardService,
  ) {}

  /**
   * Verify an uploaded object and link it as this provider's avatar.
   *
   * Writes through `patchStep`, so the version contract, the 409-with-server-
   * state, the per-step field guard and the edit lock are the SAME ones every
   * other field goes through. A parallel write path would be a second place
   * for those rules to be got wrong.
   */
  async finalize(
    userId: string,
    input: { key: string; version: number },
  ): Promise<ProviderOnboardingDraftView> {
    const ownerRef = avatarOwnerRef(userId, String(this.config.get('JWT_ACCESS_SECRET')));

    try {
      assertAvatarKey(input.key, ownerRef);
    } catch (err) {
      throw this.toHttp(err);
    }

    const stored = await this.storage.readObjectHead(input.key, AVATAR_SIGNATURE_PROBE_BYTES);
    if (!stored) {
      this.log.warn({ msg: 'provider.avatar.finalize.missing', userId });
      throw new AppError(
        'VALIDATION_ERROR',
        'We could not find that upload. Please try again.',
        400,
        { reason: 'FILE_MISSING' },
      );
    }

    try {
      assertAvatarWithinLimit(stored.sizeBytes, AVATAR_MAX_BYTES);
    } catch (err) {
      throw this.toHttp(err);
    }

    // The declared type comes from the key's extension, which this server
    // synthesised from a validated content type at presign — never from the
    // request body. So this compares what we AGREED to store against what
    // actually arrived, and a client cannot make the two agree by lying twice.
    const declared = mimeForAvatarKey(input.key);
    const verdict = verifyAvatarSignature(declared ?? '', stored.head);
    if (!verdict.ok) {
      this.log.warn({
        msg: 'provider.avatar.finalize.content_rejected',
        userId,
        reason: verdict.code,
      });
      throw new AppError('VALIDATION_ERROR', 'That file is not a usable image.', 400, {
        reason: 'CONTENT_MISMATCH',
      });
    }

    const fileUrl = this.storage.publicUrlForKey(input.key);

    // Idempotent retry. A dropped response leaves the client unsure whether the
    // save landed, and its only sane move is to send the same request again. If
    // this avatar is already the stored one, that repeat is a no-op success
    // rather than a 409 about a version it was never told about.
    const current = await this.wizard.get(userId);
    if (current.data.profileImageUrl === fileUrl) {
      this.log.log({ msg: 'provider.avatar.finalize.noop', userId });
      return current;
    }

    // Sprint 09B.29 Phase 4 — CLAIM THE RESERVATION.
    //
    // The row was created at presign, before the upload URL existed. Claiming
    // it here is what turns an abandoned-upload candidate into an attached
    // asset, and the claim is conditional on owner + key + PUBLIC + unclaimed:
    // a client cannot finalize a key it was never issued, cannot claim another
    // provider's reservation, and two concurrent finalizations produce one
    // winner.
    //
    // A refusal is NOT fatal to the link. The bytes passed every check above
    // and the provider's photo should appear; what a missing claim means is
    // that the ledger row is absent or already used, and the sweep's job is to
    // find objects nobody claimed — not to hold up a valid upload. It is
    // logged so the case is visible rather than silent.
    const claimed = await this.ledger.claim({ userId, storageKey: input.key });
    if (!claimed) {
      this.log.warn({ msg: 'provider.avatar.finalize.unclaimed_reservation', userId });
    }

    // The photo being REPLACED becomes eligible for byte deletion. Intent
    // only — `retainUntil`, never `deletedAt`, which the cleanup sweep writes
    // after storage confirms the object is gone. Without this, every
    // replacement left its predecessor in the bucket for ever (O-2).
    const previousKey = keyFromPublicUrl(current.data.profileImageUrl ?? null);
    if (previousKey && previousKey !== input.key) {
      await this.ledger.retire({
        userId,
        storageKey: previousKey,
        reason: AVATAR_REPLACED_REASON,
      });
    }

    const view = await this.wizard.patchStep(userId, 'IDENTITY', {
      version: input.version,
      profileImageUrl: fileUrl,
    });
    this.log.log({ msg: 'provider.avatar.finalize.linked', userId, bytes: stored.sizeBytes });
    return view;
  }

  /** Detach the avatar. Routed through the same step write, so removal obeys
   *  the same version contract and edit lock as setting it. */
  async remove(userId: string, version: number): Promise<ProviderOnboardingDraftView> {
    const current = await this.wizard.get(userId);
    if (current.data.profileImageUrl === null) return current;

    // Sprint 09B.29 Phase 4 — retire the bytes as well as the pointer (O-3).
    //
    // Clearing `profileImageUrl` used to be the whole operation, so the object
    // stayed in the bucket permanently and stayed readable at its URL. The
    // provider had asked for their photo to be gone; only the reference went.
    //
    // Intent only. `PublicMediaCleanupService` writes `deletedAt`, after
    // storage has confirmed the object is actually absent — and the retirement
    // is scoped to a PUBLIC asset owned by this user, so it can never reach
    // another provider's media or an evidence row.
    //
    // Ordered BEFORE the patch so a failure to record the intent fails the
    // whole operation, rather than clearing the pointer and losing the only
    // handle on the bytes.
    const key = keyFromPublicUrl(current.data.profileImageUrl);
    if (key) {
      await this.ledger.retire({ userId, storageKey: key, reason: AVATAR_REMOVED_REASON });
    }

    return this.wizard.patchStep(userId, 'IDENTITY', { version, profileImageUrl: null });
  }

  private toHttp(err: unknown): AppError {
    if (err instanceof AvatarPolicyError) {
      return new AppError('VALIDATION_ERROR', err.message, 400, { reason: err.code });
    }
    return err as AppError;
  }
}

/**
 * The type a server-minted avatar key claims to hold.
 *
 * Keys are synthesised as `avatars/<ref>/<uuid>.<ext>` from a validated content
 * type, so the extension is ours, not the caller's. Returns null for anything
 * that does not end in an extension we mint, which `verifyAvatarSignature`
 * then refuses as a disallowed format.
 */
export function mimeForAvatarKey(key: string): string | null {
  const ext = key.slice(key.lastIndexOf('.') + 1).toLowerCase();
  const mime =
    ext === 'jpg' ? 'image/jpeg' : ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : '';
  return isAvatarMimeType(mime) ? mime : null;
}

/** Why a previous avatar's bytes became eligible for deletion. */
export const AVATAR_REPLACED_REASON = 'PROVIDER_REPLACED_AVATAR';
/** Why a removed avatar's bytes became eligible for deletion. */
export const AVATAR_REMOVED_REASON = 'PROVIDER_REMOVED_AVATAR';

/**
 * The storage key a stored avatar URL points at, or null.
 *
 * Sprint 09B.29 Phase 4. Reads from the `avatars/` prefix rather than parsing
 * the URL, because the URL shape is the ADAPTER's business and differs between
 * them: local disk serves `/v1/media/files/<key>`, S3 serves
 * `<bucket-or-cdn>/<key>`. Anchoring on the key prefix the server itself
 * minted gives one answer for both, and cannot be fooled into returning a key
 * outside the avatar namespace.
 *
 * Only used to RETIRE a previous object, and the retirement is scoped to the
 * owner in the ledger — so even a malformed stored URL cannot reach another
 * provider's media.
 */
export function keyFromPublicUrl(url: string | null): string | null {
  if (!url) return null;
  const at = url.indexOf(AVATAR_KEY_PREFIX);
  if (at < 0) return null;
  const raw = url.slice(at).split('?')[0];
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}
