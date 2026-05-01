import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import type { ListNotificationsQuery } from '@homeservicemarketplace/contracts';

// Query-string DTO for GET /v1/me/notifications. All fields optional.
// `forbidNonWhitelisted: true` (set globally) blocks IDOR vectors like
// ?userId=victim, since the field is not declared here.
export class ListNotificationsQueryDto implements ListNotificationsQuery {
  // Coerce "true" / "false" strings to booleans — express query strings
  // arrive as strings even when the type system says otherwise.
  @IsOptional()
  @Transform(({ value }) => {
    if (value === true || value === 'true') return true;
    if (value === false || value === 'false') return false;
    return value;
  })
  @IsBoolean()
  unread?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @IsString()
  cursor?: string;
}
