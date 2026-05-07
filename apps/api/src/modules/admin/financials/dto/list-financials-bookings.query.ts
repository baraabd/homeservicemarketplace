import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import type { ListAdminFinancialsBookingsQuery } from '@homeservicemarketplace/contracts';

// GET /v1/admin/financials/bookings — cursor-paginated. Cursor is the
// last seen booking id. forbidNonWhitelisted blocks any other key.
export class ListAdminFinancialsBookingsQueryDto implements ListAdminFinancialsBookingsQuery {
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
