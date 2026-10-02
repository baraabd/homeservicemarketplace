import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import type { Response } from 'express';
import type {
  AdminBookingReviewItem,
  AdminBookingReviewListResponse,
  BookingReviewStatusResponse,
  ListAdminBookingReviewsQuery,
  ModerateBookingReviewRequest,
  SubmitBookingReviewRequest,
  SubmitBookingReviewResponse,
} from '@homeservicemarketplace/contracts';

import { CurrentUser } from '../iam/authentication/decorators/current-user.decorator';
import { CsrfGuard } from '../iam/authentication/guards/csrf.guard';
import { JwtAuthGuard } from '../iam/authentication/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../iam/authentication/types/authenticated-user';
import { Permissions } from '../iam/authorization/decorators/permissions.decorator';
import { Roles } from '../iam/authorization/decorators/roles.decorator';
import { PermissionsGuard } from '../iam/authorization/guards/permissions.guard';
import { RolesGuard } from '../iam/authorization/guards/roles.guard';
import { AdminReviewsService, REVIEWS_MODERATE, REVIEWS_READ } from './admin-reviews.service';
import { BookingReviewsService } from './booking-reviews.service';

// The DTO's bounds are a blast radius: they stop an absurd payload being
// parsed. The rules themselves are in the services. With the global
// `forbidNonWhitelisted` pipe, a body that also names a reviewer, a provider,
// a booking or a state is refused here.

export class SubmitBookingReviewDto implements SubmitBookingReviewRequest {
  @IsInt()
  @Min(1)
  @Max(5)
  rating!: number;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  comment?: string | null;
}

export class ModerateBookingReviewDto implements ModerateBookingReviewRequest {
  @IsString()
  @MaxLength(2000)
  reason!: string;
}

export class ListAdminBookingReviewsDto implements ListAdminBookingReviewsQuery {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  providerProfileId?: string;

  @IsOptional()
  @IsIn(['PUBLISHED', 'HIDDEN'])
  state?: 'PUBLISHED' | 'HIDDEN';

  @IsOptional()
  @IsString()
  @MaxLength(64)
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

/** The seeker's own review of one of their bookings. */
@UseGuards(JwtAuthGuard)
@Controller({ path: 'me/bookings/:bookingId/review', version: '1' })
export class BookingReviewsController {
  constructor(private readonly reviews: BookingReviewsService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  status(
    @CurrentUser() user: AuthenticatedUser,
    @Param('bookingId') bookingId: string,
  ): Promise<BookingReviewStatusResponse> {
    return this.reviews.status(user.id, bookingId);
  }

  /** 201 when the review was created; 200 when it was already saved and this
   *  was a repeat of it. */
  @UseGuards(CsrfGuard)
  @Post()
  async submit(
    @CurrentUser() user: AuthenticatedUser,
    @Param('bookingId') bookingId: string,
    @Body() body: SubmitBookingReviewDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SubmitBookingReviewResponse> {
    const result = await this.reviews.submit(user.id, bookingId, body);
    res.status(result.replayed ? HttpStatus.OK : HttpStatus.CREATED);
    return result;
  }
}

/** Moderation. Administrators only; providers have no route here. */
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles('admin')
@Controller({ path: 'admin/reviews', version: '1' })
export class AdminReviewsController {
  constructor(private readonly reviews: AdminReviewsService) {}

  @Get()
  @Permissions(REVIEWS_READ)
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListAdminBookingReviewsDto,
  ): Promise<AdminBookingReviewListResponse> {
    return this.reviews.list(user.id, query);
  }

  @Post(':reviewId/hide')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CsrfGuard)
  @Permissions(REVIEWS_MODERATE)
  hide(
    @CurrentUser() user: AuthenticatedUser,
    @Param('reviewId') reviewId: string,
    @Body() body: ModerateBookingReviewDto,
  ): Promise<AdminBookingReviewItem> {
    return this.reviews.hide(user.id, reviewId, body.reason);
  }

  @Post(':reviewId/restore')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CsrfGuard)
  @Permissions(REVIEWS_MODERATE)
  restore(
    @CurrentUser() user: AuthenticatedUser,
    @Param('reviewId') reviewId: string,
    @Body() body: ModerateBookingReviewDto,
  ): Promise<AdminBookingReviewItem> {
    return this.reviews.restore(user.id, reviewId, body.reason);
  }
}
