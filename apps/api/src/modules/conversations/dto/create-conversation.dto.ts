import { IsString, MaxLength, MinLength } from 'class-validator';
import type { CreateConversationRequest } from '@homeservicemarketplace/contracts';

// Body DTO for POST /v1/me/conversations. `bookingId` is the only
// accepted field — `forbidNonWhitelisted: true` rejects payloads that
// try to smuggle senderUserId / providerProfileId.
export class CreateConversationDto implements CreateConversationRequest {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  bookingId!: string;
}
