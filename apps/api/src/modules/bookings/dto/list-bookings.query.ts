import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import type { ListBookingsQuery } from '@homeservicemarketplace/contracts';
import { BookingStatus } from '@homeservicemarketplace/contracts';

// Query-string DTO for GET /v1/me/bookings. All fields optional. Unknown
// values are rejected by class-validator with a 400 VALIDATION_ERROR.
// `forbidNonWhitelisted: true` (set globally) blocks IDOR vectors like
// ?seekerUserId=victim, since the field is not declared here.
export class ListBookingsQueryDto implements ListBookingsQuery {
  @IsOptional()
  @IsEnum(BookingStatus)
  status?: BookingStatus;

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
