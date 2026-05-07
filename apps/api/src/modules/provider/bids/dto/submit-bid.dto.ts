import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import type { SubmitBidRequest } from '@homeservicemarketplace/contracts';
import { PricingType } from '@homeservicemarketplace/database';

// POST /v1/me/provider/bids body. The wire deliberately does NOT
// declare providerId / providerUserId — the global ValidationPipe's
// `forbidNonWhitelisted: true` rejects those fields, and the service
// pulls identity from the session.
//
// `amount` is the marketplace's integer currency unit (cents-equivalent
// in the schema). The 1..100_000_000 range is wide enough for every
// reasonable price and tight enough to reject overflow + fractional
// inputs at the boundary.
export class SubmitBidDto implements SubmitBidRequest {
  @IsString()
  @Length(1, 64)
  requestId!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100_000_000)
  amount!: number;

  @IsEnum(PricingType)
  pricingType!: PricingType;

  @IsOptional()
  @IsString()
  @Length(0, 1024)
  note?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(60 * 24 * 30) // 30 days in minutes — generous; ETA is in MINUTES
  responseTimeMinutes?: number | null;
}
