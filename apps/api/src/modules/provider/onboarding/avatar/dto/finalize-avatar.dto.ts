import { Type } from 'class-transformer';
import { IsInt, IsString, Matches, Min, MaxLength } from 'class-validator';

// Sprint 9B.17 — POST /v1/me/provider/onboarding/avatar body.
//
// Two fields, and neither of them is a URL. The client sends the KEY it was
// given at presign; the server recomputes the URL from it. Accepting a URL
// here would mean storing a pointer the server never validated, which is the
// whole defect this endpoint exists to remove.

export class FinalizeAvatarDto {
  /**
   * The storage key from the presign response.
   *
   * Shape-checked here and OWNERSHIP-checked in the service against a
   * recomputed owner ref — this pattern only rejects the obviously malformed,
   * and must never be mistaken for the authorization step. Backslashes,
   * whitespace and control characters are excluded so a key that could not have
   * come from presign is refused before it reaches storage.
   */
  @IsString()
  @MaxLength(300)
  @Matches(/^[A-Za-z0-9/_.-]+$/, {
    message: 'key must be a storage key issued by the presign endpoint',
  })
  key!: string;

  /** The version the client last read. Not optional, for the same reason the
   *  step patch requires it: an unversioned write is a silent overwrite by
   *  another name. */
  @Type(() => Number)
  @IsInt()
  @Min(0)
  version!: number;
}

/** POST /v1/me/provider/onboarding/avatar/remove body. */
export class RemoveAvatarDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  version!: number;
}
