import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import type { ListMyBidsQuery } from '@homeservicemarketplace/contracts';
import { BidStatus } from '@homeservicemarketplace/database';

// GET /v1/me/provider/bids query. The DTO declares only the four
// legal keys; `forbidNonWhitelisted: true` rejects any client-side
// providerId / userId injection.
export class ListMyBidsQueryDto implements ListMyBidsQuery {
  @IsOptional()
  @IsEnum(BidStatus)
  status?: BidStatus;

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
