import { IsOptional, IsString, Length } from 'class-validator';
import type { DecideAdminAccessRequestRequest } from '@homeservicemarketplace/contracts';

// POST /v1/admin/access-requests/:id/approve | /reject
//
// The decision lives in the ROUTE, not the body, so no payload field can turn
// a rejection into an approval. The body carries only the reviewer's note.
export class DecideAdminAccessRequestDto implements DecideAdminAccessRequestRequest {
  @IsOptional()
  @IsString()
  @Length(1, 2000)
  decisionNote?: string;
}
