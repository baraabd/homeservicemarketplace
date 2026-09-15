import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import type { ListAdminProvidersQuery } from '@homeservicemarketplace/contracts';
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
