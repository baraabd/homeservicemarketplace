import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import type {
  MarkAllNotificationsReadResponse,
  MarkNotificationReadResponse,
  NotificationListResponse,
  NotificationUnreadCountResponse,
} from '@homeservicemarketplace/contracts';

import { CurrentUser } from '../iam/authentication/decorators/current-user.decorator';
import { CsrfGuard } from '../iam/authentication/guards/csrf.guard';
import { JwtAuthGuard } from '../iam/authentication/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../iam/authentication/types/authenticated-user';
import { ListNotificationsQueryDto } from './dto/list-notifications.query';
import { NotificationsService } from './notifications.service';

// /v1/me/notifications — Seeker-facing notification feed (Sprint 3,
// slice 3.1).
//
// Read endpoints require JwtAuthGuard. Mutating endpoints (mark-read,
// mark-all-read, delete) additionally require CsrfGuard so a stolen
// access cookie alone cannot drive notification state from a hostile
// origin.
//
// `userId` is sourced exclusively from the authenticated session via
// @CurrentUser. Path params (`notificationId`) are the only client
// input. The service layer verifies ownership before mutating, so a
// foreign notificationId always surfaces as 404 NOT_FOUND — never
// distinguishable from "doesn't exist". The wire DTOs do not declare
// `userId`, and `forbidNonWhitelisted: true` rejects payloads that try
// to smuggle one in via the query string.
@UseGuards(JwtAuthGuard)
@Controller({ path: 'me/notifications', version: '1' })
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListNotificationsQueryDto,
  ): Promise<NotificationListResponse> {
    return this.notifications.list(user.id, query);
  }

  @Get('unread-count')
  @HttpCode(HttpStatus.OK)
  unreadCount(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListNotificationsQueryDto,
  ): Promise<NotificationUnreadCountResponse> {
    // Sprint 5.5: optional `?experience=` scopes the count to one
    // user-experience drawer.
    return this.notifications.unreadCount(user.id, query.experience);
  }

  @UseGuards(CsrfGuard)
  @Post(':notificationId/read')
  @HttpCode(HttpStatus.OK)
  markRead(
    @CurrentUser() user: AuthenticatedUser,
    @Param('notificationId') notificationId: string,
  ): Promise<MarkNotificationReadResponse> {
    return this.notifications.markRead(user.id, notificationId);
  }

  @UseGuards(CsrfGuard)
  @Post('read-all')
  @HttpCode(HttpStatus.OK)
  markAllRead(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListNotificationsQueryDto,
  ): Promise<MarkAllNotificationsReadResponse> {
    // Sprint 5.5: optional `?experience=` scopes which unread rows
    // get flipped — the provider drawer's "mark all read" must NOT
    // silence the seeker's unread badge.
    return this.notifications.markAllRead(user.id, query.experience);
  }

  @UseGuards(CsrfGuard)
  @Delete(':notificationId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(
    @CurrentUser() user: AuthenticatedUser,
    @Param('notificationId') notificationId: string,
  ): Promise<void> {
    await this.notifications.delete(user.id, notificationId);
  }
}
