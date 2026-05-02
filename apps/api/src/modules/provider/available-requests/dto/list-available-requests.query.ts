import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import type { ProviderAvailableRequestsQuery } from '@homeservicemarketplace/contracts';

// GET /v1/provider/available-requests query DTO. Only the four
// legal keys (category | near | limit | cursor) are accepted; the
// global ValidationPipe's `forbidNonWhitelisted: true` rejects any
// providerId / providerProfileId / status injection from the wire.
export class ListAvailableRequestsQueryDto implements ProviderAvailableRequestsQuery {
  @IsOptional()
  @IsString()
  @Length(1, 64)
  category?: string;

  @IsOptional()
  @IsString()
  @Length(1, 64)
  near?: string;

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
