import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Max, Min } from 'class-validator';
import {
  DISPUTE_ISSUE_CODES, DISPUTE_REQUESTED_OUTCOMES,
  type CreateParticipantDisputeRequest,
} from '@homeservicemarketplace/contracts';

export class CreateParticipantDisputeDto implements CreateParticipantDisputeRequest {
  @IsString() @Length(1, 64) bookingId!: string;
  @IsUUID('4') idempotencyKey!: string;
  @IsString() @Length(1, 130) policyVersion!: string;
  @IsIn(DISPUTE_ISSUE_CODES) issueCode!: CreateParticipantDisputeRequest['issueCode'];
  @IsIn(DISPUTE_REQUESTED_OUTCOMES) requestedOutcome!: CreateParticipantDisputeRequest['requestedOutcome'];
  @IsString() @Length(20, 4000) statement!: string;
}
export class ListParticipantDisputesDto {
  @IsOptional() @IsString() @Length(1, 64) cursor?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) limit?: number;
}
