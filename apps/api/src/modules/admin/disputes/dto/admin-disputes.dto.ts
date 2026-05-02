import { Type } from 'class-transformer';
import { IsEnum, IsIn, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import type {
  ListAdminDisputesQuery,
  OpenDisputeRequest,
  ResolveDisputeRequest,
} from '@homeservicemarketplace/contracts';

const DISPUTE_STATUS = [
  'OPEN',
  'IN_REVIEW',
  'RESOLVED_REFUND',
  'RESOLVED_PARTIAL',
  'RESOLVED_DENIED',
  'CANCELLED',
] as const;

export class ListAdminDisputesQueryDto implements ListAdminDisputesQuery {
  @IsOptional()
  @IsIn(DISPUTE_STATUS)
  status?: ListAdminDisputesQuery['status'];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @IsString()
  @Length(1, 64)
  cursor?: string;
}

export class OpenDisputeDto implements OpenDisputeRequest {
  @IsString()
  @Length(1, 64)
  bookingId!: string;

  @IsString()
  @Length(1, 64)
  openedById!: string;

  @IsString()
  @Length(1, 2048)
  reason!: string;
}

const RESOLVED_STATUSES = ['RESOLVED_REFUND', 'RESOLVED_PARTIAL', 'RESOLVED_DENIED'] as const;

export class ResolveDisputeDto implements ResolveDisputeRequest {
  @IsString()
  @Length(1, 2048)
  resolution!: string;

  @IsEnum(Object.fromEntries(RESOLVED_STATUSES.map((s) => [s, s])))
  status!: ResolveDisputeRequest['status'];
}
