import { Type } from 'class-transformer';
import { IsEnum, IsIn, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import type {
  ListAdminDisputesQuery,
  OpenDisputeRequest,
  ResolveDisputeRequest,
  UpdateDisputeRequest,
} from '@homeservicemarketplace/contracts';

const DISPUTE_STATUS = [
  'OPEN',
  'IN_REVIEW',
  'RESOLVED_REFUND',
  'RESOLVED_PARTIAL',
  'RESOLVED_DENIED',
  'CANCELLED',
] as const;

const DISPUTE_PRIORITY = ['URGENT', 'HIGH', 'MEDIUM', 'LOW'] as const;

export class ListAdminDisputesQueryDto implements ListAdminDisputesQuery {
  @IsOptional()
  @IsIn(DISPUTE_STATUS)
  status?: ListAdminDisputesQuery['status'];

  @IsOptional()
  @IsIn(DISPUTE_PRIORITY)
  priority?: ListAdminDisputesQuery['priority'];

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

  // Sprint 6.3 — optional long-form description on open. The wire
  // accepts null to clear (the existing field is nullable).
  @IsOptional()
  @IsString()
  @Length(0, 4000)
  description?: string | null;

  @IsOptional()
  @IsIn(DISPUTE_PRIORITY)
  priority?: OpenDisputeRequest['priority'];
}

// Sprint 6.3 — PATCH /v1/admin/disputes/:id. Every field is optional;
// at-least-one is enforced at the service layer (after the DTO has
// rejected unknown keys via forbidNonWhitelisted: true).
export class UpdateDisputeDto implements UpdateDisputeRequest {
  @IsOptional()
  @IsIn(DISPUTE_STATUS)
  status?: UpdateDisputeRequest['status'];

  @IsOptional()
  @IsIn(DISPUTE_PRIORITY)
  priority?: UpdateDisputeRequest['priority'];

  @IsOptional()
  @IsString()
  @Length(0, 4000)
  description?: string | null;
}

const RESOLVED_STATUSES = ['RESOLVED_REFUND', 'RESOLVED_PARTIAL', 'RESOLVED_DENIED'] as const;

export class ResolveDisputeDto implements ResolveDisputeRequest {
  @IsString()
  @Length(1, 2048)
  resolution!: string;

  @IsEnum(Object.fromEntries(RESOLVED_STATUSES.map((s) => [s, s])))
  status!: ResolveDisputeRequest['status'];
}
