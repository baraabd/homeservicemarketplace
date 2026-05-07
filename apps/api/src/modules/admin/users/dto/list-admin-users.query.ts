import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import type { ListAdminUsersQuery } from '@homeservicemarketplace/contracts';
import { AccountStatus } from '@homeservicemarketplace/database';

export class ListAdminUsersQueryDto implements ListAdminUsersQuery {
  // Sprint 6.1 accepts BOTH `q` (legacy) and `query` (canonical) on
  // the wire and folds them in the service — `query` wins when both
  // are present. forbidNonWhitelisted: true rejects any other key.
  @IsOptional()
  @IsString()
  @Length(1, 128)
  q?: string;

  @IsOptional()
  @IsString()
  @Length(1, 128)
  query?: string;

  @IsOptional()
  @IsEnum(AccountStatus)
  status?: AccountStatus;

  @IsOptional()
  @IsString()
  @Length(1, 64)
  role?: string;

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
