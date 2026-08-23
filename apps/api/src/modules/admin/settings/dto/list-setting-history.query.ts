import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

// Sprint 8 — GET /v1/admin/settings/:key/history query.
//
// Cursor-paginated rather than offset: the table is append-only and a new row
// can land between two page reads, which is exactly the condition under which
// OFFSET silently repeats or skips a row.
export class ListSettingHistoryQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  cursor?: string;
}
