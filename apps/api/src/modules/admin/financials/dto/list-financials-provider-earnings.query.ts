import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Length, Matches, Max, Min } from 'class-validator';
import type { ListAdminFinancialsProviderEarningsQuery } from '@homeservicemarketplace/contracts';

// GET /v1/admin/financials/provider-earnings — Prisma `groupBy`
// doesn't support cursor pagination, so the wire `cursor` is a
// numeric-string offset (e.g., '50' to skip the first 50 rows).
// The DTO enforces digits-only so we can safely parse it.
export class ListAdminFinancialsProviderEarningsQueryDto implements ListAdminFinancialsProviderEarningsQuery {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @IsString()
  @Length(1, 16)
  @Matches(/^\d+$/, { message: '`cursor` must be a non-negative integer string' })
  cursor?: string;
}
