import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import type {
  ListNotificationsQuery,
  NotificationExperience,
} from '@homeservicemarketplace/contracts';

const EXPERIENCES = ['seeker', 'provider', 'admin'] as const;

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

  // Sprint 5.5: scope the feed to one user-experience. Server
  // derives the match from the notification's deepLink prefix; no
  // schema column required.
  @IsOptional()
  @IsIn(EXPERIENCES)
  experience?: NotificationExperience;

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
