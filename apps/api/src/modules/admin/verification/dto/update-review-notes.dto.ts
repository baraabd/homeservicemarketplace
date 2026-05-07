import { IsString, MaxLength } from 'class-validator';
import type { UpdateProviderReviewNotesRequest } from '@homeservicemarketplace/contracts';

// PATCH /v1/admin/providers/:providerProfileId/review-notes
//
// `notes` is required on the wire; pass an empty string to clear.
// Cap at 4 KB so a runaway paste can't bloat the row arbitrarily.
// forbidNonWhitelisted: true rejects any other body field, blocking
// sneaky writes to providerProfileId / userId / status.
export class UpdateReviewNotesDto implements UpdateProviderReviewNotesRequest {
  @IsString()
  @MaxLength(4000)
  notes!: string;
}
