import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import type { SubmitOnboardingRequest } from '@homeservicemarketplace/contracts';

// Sprint 8 — POST /v1/me/provider/onboarding/submit body.
//
// Carries the version so a submission raised against a draft that has since
// changed in another tab is refused rather than committing content the
// provider never saw.
export class SubmitOnboardingDto implements SubmitOnboardingRequest {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  version!: number;

  /**
   * Optional client-generated key.
   *
   * Submission is idempotent WITHOUT it — re-submitting an already-submitted
   * application returns the existing outcome rather than transitioning twice,
   * because the state itself is the guard. The key is accepted so a client can
   * correlate a retry with its original request in logs; it is deliberately
   * not load-bearing, since a correctness property that depends on the client
   * remembering to send something is not a correctness property.
   */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  idempotencyKey?: string;
}
