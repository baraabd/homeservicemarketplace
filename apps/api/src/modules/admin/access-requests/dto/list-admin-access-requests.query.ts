import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import type {
  AdminAccessRequestStatus,
  ListAdminAccessRequestsQuery,
} from '@homeservicemarketplace/contracts';

const STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'] as const;

export class ListAdminAccessRequestsQueryDto implements ListAdminAccessRequestsQuery {
  // Omitted → the service defaults to PENDING, i.e. the review queue.
  @IsOptional()
  @IsIn(STATUSES as unknown as string[])
  status?: AdminAccessRequestStatus;

  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
