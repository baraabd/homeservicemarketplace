import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import type { ListProviderBookingsQuery } from '@homeservicemarketplace/contracts';
import { BookingStatus } from '@homeservicemarketplace/database';

// GET /v1/me/provider/bookings query DTO. Only the four legal keys
// are accepted; `forbidNonWhitelisted: true` rejects any client-side
// providerId / userId injection.
export class ListProviderBookingsQueryDto implements ListProviderBookingsQuery {
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
  @Length(1, 64)
  cursor?: string;
}
