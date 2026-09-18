import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, IsUUID, Length, Max, Min } from 'class-validator';
import {
  DISPUTE_ISSUE_CODES, DISPUTE_REQUESTED_OUTCOMES,
  type CreateParticipantDisputeRequest,
} from '@homeservicemarketplace/contracts';

// Snapshot the contract choices as named enum members. Neither validation
// metadata nor a caller can extend the accepted set by mutating an array.
const issueCodes = Object.freeze(Object.fromEntries(DISPUTE_ISSUE_CODES.map((code) => [code, code])));
const requestedOutcomes = Object.freeze(Object.fromEntries(DISPUTE_REQUESTED_OUTCOMES.map((code) => [code, code])));

export class CreateParticipantDisputeDto implements CreateParticipantDisputeRequest {
  @IsString() @Length(1, 64) bookingId!: string;
  @IsUUID('4') idempotencyKey!: string;
  @IsString() @Length(1, 130) policyVersion!: string;
  @IsString() @IsEnum(issueCodes) issueCode!: CreateParticipantDisputeRequest['issueCode'];
  @IsString() @IsEnum(requestedOutcomes) requestedOutcome!: CreateParticipantDisputeRequest['requestedOutcome'];
  @IsString() @Length(20, 4000) statement!: string;
}
export class ListParticipantDisputesDto {
  @IsOptional() @IsString() @Length(1, 64) cursor?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) limit?: number;
}
