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
import type {
  BookingDetail,
  BookingListResponse,
  BookingTimelineResponse,
} from '@homeservicemarketplace/contracts';

import { CurrentUser } from '../iam/authentication/decorators/current-user.decorator';
import { CsrfGuard } from '../iam/authentication/guards/csrf.guard';
import { JwtAuthGuard } from '../iam/authentication/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../iam/authentication/types/authenticated-user';
import { BookingsService } from './bookings.service';
import { ListBookingsQueryDto } from './dto/list-bookings.query';

// /v1/me/bookings — Seeker-facing booking surface (Sprint 2, slice 2.3).
//
// Read endpoints require JwtAuthGuard. The cancel endpoint additionally
// requires CsrfGuard so a stolen access cookie alone cannot drive a
// cancellation from a hostile origin.
//
// `seekerUserId` is sourced exclusively from the authenticated session
// via @CurrentUser. Path params (`bookingId`) are the only client
// input; the service layer verifies ownership before mutating, so a
// foreign bookingId always surfaces as 404 NOT_FOUND — never
// distinguishable from "doesn't exist". The wire DTOs do not declare
// `seekerUserId`, and the global ValidationPipe's
// `forbidNonWhitelisted: true` rejects payloads that try to smuggle
// one in via the query string.
@UseGuards(JwtAuthGuard)
@Controller({ path: 'me/bookings', version: '1' })
export class BookingsController {
  constructor(private readonly bookings: BookingsService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListBookingsQueryDto,
  ): Promise<BookingListResponse> {
    return this.bookings.list(user.id, query);
  }

  @Get(':bookingId')
  @HttpCode(HttpStatus.OK)
  detail(
    @CurrentUser() user: AuthenticatedUser,
    @Param('bookingId') bookingId: string,
  ): Promise<BookingDetail> {
    return this.bookings.detail(user.id, bookingId);
  }

  @Get(':bookingId/timeline')
  @HttpCode(HttpStatus.OK)
  timeline(
    @CurrentUser() user: AuthenticatedUser,
    @Param('bookingId') bookingId: string,
  ): Promise<BookingTimelineResponse> {
    return this.bookings.timeline(user.id, bookingId);
  }

  @UseGuards(CsrfGuard)
  @Post(':bookingId/cancel')
  @HttpCode(HttpStatus.OK)
  cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('bookingId') bookingId: string,
  ): Promise<BookingDetail> {
    return this.bookings.cancel(user.id, bookingId);
  }
}
