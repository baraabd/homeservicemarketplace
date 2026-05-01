import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import type { ListServiceRequestsQuery } from '@homeservicemarketplace/contracts';
import { ServiceRequestStatus } from '@homeservicemarketplace/database';

// Query-string DTO for GET /v1/me/requests. The global ValidationPipe
// is configured with `transform: true`, so the @Type / @IsInt pair
// coerces the string-from-querystring into a real number. `limit`
// is clamped server-side to keep response bodies bounded; the upper
// bound here is generous enough for any UI page size that's reasonable
// to render in one screen.
export class ListServiceRequestsQueryDto implements ListServiceRequestsQuery {
  @IsOptional()
  @IsEnum(ServiceRequestStatus)
  status?: ServiceRequestStatus;

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
