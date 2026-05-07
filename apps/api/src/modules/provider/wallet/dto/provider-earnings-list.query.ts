import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import type { ListProviderEarningsTransactionsQuery } from '@homeservicemarketplace/contracts';

// GET /v1/provider/earnings/transactions query DTO. Canonical wallet
// endpoint; COMPLETED-only by definition (no status filter on the wire
// — `forbidNonWhitelisted: true` rejects any attempt to add one).
export class ProviderEarningsListQueryDto implements ListProviderEarningsTransactionsQuery {
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
