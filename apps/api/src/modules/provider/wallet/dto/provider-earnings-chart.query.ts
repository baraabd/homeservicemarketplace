import { IsIn, IsOptional, IsString, Length } from 'class-validator';
import type { EarningsChartQuery, EarningsChartRange } from '@homeservicemarketplace/contracts';

const RANGE_VALUES: readonly EarningsChartRange[] = ['7d', '30d', '90d'] as const;

// GET /v1/provider/earnings/chart query DTO. Range is a closed enum
// (7d / 30d / 90d) with 30d as the default applied at the service
// layer; missing values are accepted, invalid values are rejected at
// the validator (no silent coercion to a default).
export class ProviderEarningsChartQueryDto implements EarningsChartQuery {
  @IsOptional()
  @IsIn(RANGE_VALUES as unknown as string[])
  range?: EarningsChartRange;

  // K02 — one currency per chart; approval is checked by the service.
  @IsOptional()
  @IsString()
  @Length(3, 3)
  currency?: string;
}
