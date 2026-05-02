import { IsOptional, IsString, Matches } from 'class-validator';
import type { AnalyticsDateRangeQuery } from '@homeservicemarketplace/contracts';

// Sprint 6.4 — date range for /v1/admin/analytics/{overview,revenue}.
//
// Both fields are optional and accepted as ISO 'YYYY-MM-DD' (UTC).
// The service layer applies a default-30-days window when missing
// AND caps the range at 365 days. Format validation lives at the
// DTO so an obviously-bad value never reaches the service.
export class AnalyticsDateRangeQueryDto implements AnalyticsDateRangeQuery {
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: '`from` must be ISO YYYY-MM-DD' })
  from?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: '`to` must be ISO YYYY-MM-DD' })
  to?: string;
}
