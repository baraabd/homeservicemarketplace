import { ArrayMaxSize, ArrayMinSize, IsArray, IsString, Length, Matches } from 'class-validator';
import type { MarkAllNotificationsReadRequest } from '@homeservicemarketplace/contracts';

/** R17-B — one read-all names at most this many notifications. */
export const MARK_ALL_READ_MAX_IDS = 100;

// Body DTO for POST /v1/me/notifications/read-all (R17-B).
//
// Required: the unread notifications the reader was shown, by id. Ids are
// server-issued cuids; the bound and character class keep anything else out
// of the query. A missing or empty list is refused rather than read as
// "everything", which is what the pre-R17-B bodyless call meant.
export class MarkAllNotificationsReadDto implements MarkAllNotificationsReadRequest {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MARK_ALL_READ_MAX_IDS)
  @IsString({ each: true })
  @Length(1, 64, { each: true })
  @Matches(/^[A-Za-z0-9_-]+$/, { each: true })
  ids!: string[];
}
