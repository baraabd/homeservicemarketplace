import { IsOptional, IsString, Length, Matches } from 'class-validator';
import type { MarkConversationReadRequest } from '@homeservicemarketplace/contracts';

// Body DTO for POST /v1/{me,provider}/conversations/:id/read (R17).
//
// `upToMessageId` names the newest message the reader was shown. Message ids
// are server-issued cuids; the bound and character class keep anything else
// out of the query and the logs.
export class MarkConversationReadDto implements MarkConversationReadRequest {
  @IsOptional()
  @IsString()
  @Length(1, 64)
  @Matches(/^[A-Za-z0-9_-]+$/)
  upToMessageId?: string;
}
