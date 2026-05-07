import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsBooleanString, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import type {
  MarkNotificationReadResponse,
  NotificationListResponse,
} from '@homeservicemarketplace/contracts';

import { CurrentUser } from '../../iam/authentication/decorators/current-user.decorator';
import { CsrfGuard } from '../../iam/authentication/guards/csrf.guard';
import { JwtAuthGuard } from '../../iam/authentication/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../../iam/authentication/types/authenticated-user';
import { Roles } from '../../iam/authorization/decorators/roles.decorator';
import { RolesGuard } from '../../iam/authorization/guards/roles.guard';
import { NotificationsService } from '../../notifications/notifications.service';

// Sprint 6.6 — admin notifications.
//
// Reuses the existing Notification table + NotificationsService —
// any notification whose `userId` matches the calling admin AND
// whose `deepLink` starts with `/admin/` is returned. The
// `experience=admin` filter on the notifications service is the
// existing knob (Sprint 5.5) that does this scoping.
//
// markRead is the same idempotent flow the seeker / provider apps
// use — only the owner can mark their own notification.
class ListAdminNotificationsQueryDto {
  @IsOptional()
  @IsBooleanString()
  unread?: string;

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

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
@Controller({ path: 'admin/notifications', version: '1' })
export class AdminNotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  list(
    @CurrentUser() admin: AuthenticatedUser,
    @Query() query: ListAdminNotificationsQueryDto,
  ): Promise<NotificationListResponse> {
    return this.notifications.list(admin.id, {
      unread: query.unread === 'true' ? true : query.unread === 'false' ? false : undefined,
      limit: query.limit,
      cursor: query.cursor,
      experience: 'admin',
    });
  }

  @UseGuards(CsrfGuard)
  @Post(':notificationId/read')
  @HttpCode(HttpStatus.OK)
  markRead(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('notificationId') notificationId: string,
  ): Promise<MarkNotificationReadResponse> {
    return this.notifications.markRead(admin.id, notificationId);
  }
}
