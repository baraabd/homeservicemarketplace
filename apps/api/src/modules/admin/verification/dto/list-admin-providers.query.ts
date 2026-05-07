import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import type { ListAdminProvidersQuery } from '@homeservicemarketplace/contracts';
import { ProviderProfileStatus } from '@homeservicemarketplace/database';

export class ListAdminProvidersQueryDto implements ListAdminProvidersQuery {
  @IsOptional()
  @IsEnum(ProviderProfileStatus)
  status?: ProviderProfileStatus;

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
