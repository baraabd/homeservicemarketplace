import { Body, Controller, Get, Header, HttpCode, Param, Post, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../iam/authentication/decorators/current-user.decorator';
import { JwtAuthGuard } from '../iam/authentication/guards/jwt-auth.guard';
import { CsrfGuard } from '../iam/authentication/guards/csrf.guard';
import type { AuthenticatedUser } from '../iam/authentication/types/authenticated-user';
import { CreateParticipantDisputeDto, ListParticipantDisputesDto } from './dispute-intake.dto';
import { DisputeIntakeService } from './dispute-intake.service';
import { DisputePrivacyInterceptor } from './dispute-privacy.interceptor';

/** Participation is proved by database ownership on every read/write, never a client role. */
@Controller({ path: 'me/disputes', version: '1' })
@UseGuards(JwtAuthGuard)
@UseInterceptors(DisputePrivacyInterceptor)
export class DisputeIntakeController {
  constructor(private readonly disputes: DisputeIntakeService) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  list(@CurrentUser() actor: AuthenticatedUser, @Query() query: ListParticipantDisputesDto) {
    return this.disputes.list(actor.id, query);
  }
  @Get('bookings')
  @Header('Cache-Control', 'private, no-store')
  bookings(@CurrentUser() actor: AuthenticatedUser, @Query() query: ListParticipantDisputesDto) {
    return this.disputes.bookings(actor.id, query);
  }

  @Get('context/:bookingId')
  @Header('Cache-Control', 'private, no-store')
  context(@CurrentUser() actor: AuthenticatedUser, @Param('bookingId') bookingId: string) {
    return this.disputes.context(actor.id, bookingId);
  }
  @Get(':id')
  @Header('Cache-Control', 'private, no-store')
  detail(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string) {
    return this.disputes.detail(actor.id, id);
  }
  @Post()
  @HttpCode(200)
  @UseGuards(CsrfGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Header('Cache-Control', 'private, no-store')
  create(@CurrentUser() actor: AuthenticatedUser, @Body() body: CreateParticipantDisputeDto) {
    return this.disputes.create(actor.id, body);
  }
}
