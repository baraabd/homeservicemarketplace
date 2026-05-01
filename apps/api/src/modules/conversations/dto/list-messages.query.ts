import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

// Query DTO for GET /v1/me/conversations/:id/messages. Cursor pages
// older messages (infinite-scroll-up); the response items are returned
// chronologically (oldest-first) regardless.
export class ListMessagesQueryDto {
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
