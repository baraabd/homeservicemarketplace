import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import type { ListAvailableJobsQuery } from '@homeservicemarketplace/contracts';

// Query-string DTO for GET /v1/me/provider/jobs/available. The global
// ValidationPipe is configured with `transform: true` and
// `forbidNonWhitelisted: true`, so the @Type / @IsInt pair coerces the
// string-from-querystring into a real number, and any client field
// outside this set (providerId, providerUserId, status, …) is
// rejected with a 400.
export class ListAvailableJobsQueryDto implements ListAvailableJobsQuery {
  @IsOptional()
  @IsString()
  @Length(1, 64)
  categoryId?: string;

  @IsOptional()
  @IsString()
  @Length(1, 64)
  city?: string;

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
