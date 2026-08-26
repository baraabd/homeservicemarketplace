import { RequireCapability } from '../guards/require-capability.decorator';
import { ProviderCapability } from '@homeservicemarketplace/contracts';
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
  ListProviderBookingsResponse,
  ProviderBookingDetail,
  ProviderBookingMutationResponse,
  ProviderBookingTimelineResponse,
} from '@homeservicemarketplace/contracts';

import { CurrentUser } from '../../iam/authentication/decorators/current-user.decorator';
import { CsrfGuard } from '../../iam/authentication/guards/csrf.guard';
import { JwtAuthGuard } from '../../iam/authentication/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../../iam/authentication/types/authenticated-user';
import { Roles } from '../../iam/authorization/decorators/roles.decorator';
import { RolesGuard } from '../../iam/authorization/guards/roles.guard';
import { ProviderCapabilityGuard } from '../guards/provider-capability.guard';
import { ListProviderBookingsQueryDto } from './dto/list-provider-bookings.query';
import { ProviderBookingsService } from './provider-bookings.service';

// /v1/me/provider/bookings — Provider booking lifecycle (Sprint 5
// slice 5.4).
//
// Class-level guards (in order):
//   1. JwtAuthGuard
//   2. RolesGuard('provider')
//   3. ProviderCapabilityGuard
//
// Mutating routes (start / complete / cancel) additionally use
// CsrfGuard so a stolen access cookie alone cannot drive a booking
// transition from a hostile origin.
//
// `providerUserId` is sourced exclusively from the authenticated
// session via @CurrentUser. Path params are the only client input.
@UseGuards(JwtAuthGuard, RolesGuard, ProviderCapabilityGuard)
@Roles('provider')
// Sprint 9B.8 — an accepted booking is an obligation to a seeker, not marketplace browsing. Rank 4 (RESTRICTED) grants MANAGE_BOOKINGS precisely so a restriction does not strand the customer on the other end.
@RequireCapability(ProviderCapability.ManageBookings)
@Controller({ path: 'me/provider/bookings', version: '1' })
export class ProviderBookingsController {
  constructor(private readonly bookings: ProviderBookingsService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListProviderBookingsQueryDto,
  ): Promise<ListProviderBookingsResponse> {
    return this.bookings.list(user.id, query);
  }

  @Get(':bookingId')
  @HttpCode(HttpStatus.OK)
  detail(
    @CurrentUser() user: AuthenticatedUser,
    @Param('bookingId') bookingId: string,
  ): Promise<ProviderBookingDetail> {
    return this.bookings.detail(user.id, bookingId);
  }

  @Get(':bookingId/timeline')
  @HttpCode(HttpStatus.OK)
  timeline(
    @CurrentUser() user: AuthenticatedUser,
    @Param('bookingId') bookingId: string,
  ): Promise<ProviderBookingTimelineResponse> {
    return this.bookings.timeline(user.id, bookingId);
  }

  @UseGuards(CsrfGuard)
  @Post(':bookingId/start')
  @HttpCode(HttpStatus.OK)
  start(
    @CurrentUser() user: AuthenticatedUser,
    @Param('bookingId') bookingId: string,
  ): Promise<ProviderBookingMutationResponse> {
    return this.bookings.start(user.id, bookingId);
  }

  @UseGuards(CsrfGuard)
  @Post(':bookingId/complete')
  @HttpCode(HttpStatus.OK)
  complete(
    @CurrentUser() user: AuthenticatedUser,
    @Param('bookingId') bookingId: string,
  ): Promise<ProviderBookingMutationResponse> {
    return this.bookings.complete(user.id, bookingId);
  }

  @UseGuards(CsrfGuard)
  @Post(':bookingId/cancel')
  @HttpCode(HttpStatus.OK)
  cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('bookingId') bookingId: string,
  ): Promise<ProviderBookingMutationResponse> {
    return this.bookings.cancel(user.id, bookingId);
  }
}
