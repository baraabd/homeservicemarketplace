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

// /v1/provider/bookings — canonical Provider booking lifecycle path
// (Sprint 5.4). Re-uses the existing ProviderBookingsService that
// the legacy /v1/me/provider/bookings controller also calls; only
// the URL prefix differs.
//
// Class-level guards: JwtAuthGuard + RolesGuard('provider') +
// ProviderCapabilityGuard. Mutations additionally require CsrfGuard.
// `providerUserId` is sourced from the session via @CurrentUser;
// the wire never accepts providerId / providerProfileId.
@UseGuards(JwtAuthGuard, RolesGuard, ProviderCapabilityGuard)
@Roles('provider')
// Sprint 9B.8 — the canonical twin of /me/provider/bookings. Both families must gate identically; a rule added to one and not the other is a silent authorization split.
@RequireCapability(ProviderCapability.ManageBookings)
@Controller({ path: 'provider/bookings', version: '1' })
export class ProviderBookingsCanonicalController {
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
