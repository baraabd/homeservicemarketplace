import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import type { SubmitBidRequest } from '@homeservicemarketplace/contracts';
import { PricingType } from '@homeservicemarketplace/database';

// POST /v1/me/provider/bids body. The wire deliberately does NOT
// declare providerId / providerUserId — the global ValidationPipe's
// `forbidNonWhitelisted: true` rejects those fields, and the service
// pulls identity from the session.
//
// K02 — `amountDecimal` is a major-unit decimal string ("100.25"). Shape
// and length only here; ProviderBidsService converts it exactly
// (parseApprovedBidAmount) and enforces the approved currency and range.
// The legacy integer `amount` is not whitelisted, so a pre-K02 client is
// refused with 400.
export class SubmitBidDto implements SubmitBidRequest {
  @IsString()
  @Length(1, 64)
  requestId!: string;

  @IsString()
  @Length(1, 32)
  amountDecimal!: string;

  @IsString()
  @Length(3, 3)
  currency!: string;

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
