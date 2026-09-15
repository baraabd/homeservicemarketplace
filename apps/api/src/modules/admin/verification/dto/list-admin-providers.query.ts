import { Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';
import type {
  AdminProviderIdentityState,
  ListAdminProvidersQuery,
} from '@homeservicemarketplace/contracts';
import { ProviderProfileStatus } from '@homeservicemarketplace/database';

export class ListAdminProvidersQueryDto implements ListAdminProvidersQuery {
  @IsOptional()
  @IsIn([...Object.values(ProviderProfileStatus), 'ALL'])
  status?: ProviderProfileStatus | 'ALL';

  @IsOptional()
  @IsString()
  @Length(1, 200)
  query?: string;

  @IsOptional()
  @IsString()
  @Length(1, 64)
  userId?: string;

  @IsOptional()
  @IsIn(['SUBMITTED_OLDEST', 'UPDATED_NEWEST'])
  sort?: 'SUBMITTED_OLDEST' | 'UPDATED_NEWEST';

  @IsOptional()
  @IsIn(['ALL', 'UNASSIGNED', 'MINE'])
  assignment?: 'ALL' | 'UNASSIGNED' | 'MINE';

  @IsOptional()
  @IsIn(['UNVERIFIED', 'PENDING', 'VERIFIED', 'REJECTED', 'EXPIRED'])
  identityState?: AdminProviderIdentityState;

  @IsOptional()
  @IsIn(['PENDING', 'APPROVED', 'REJECTED'])
  portfolioState?: 'PENDING' | 'APPROVED' | 'REJECTED';

  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z]{2}$/)
  country?: string;

  @IsOptional()
  @IsDateString({ strict: true })
  submittedFrom?: string;

  @IsOptional()
  @IsDateString({ strict: true })
  submittedTo?: string;

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
