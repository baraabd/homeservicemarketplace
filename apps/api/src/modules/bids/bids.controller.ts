import { Controller, Get, HttpCode, HttpStatus, Param, Query, UseGuards } from '@nestjs/common';
import type { BidListResponse, BidSummary } from '@homeservicemarketplace/contracts';

import { CurrentUser } from '../iam/authentication/decorators/current-user.decorator';
import { JwtAuthGuard } from '../iam/authentication/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../iam/authentication/types/authenticated-user';
import { BidsService } from './bids.service';
import { ListBidsQueryDto } from './dto/list-bids.query';

// /v1/me/requests/:requestId/bids — Seeker-facing read-only bid feed.
//
// Both routes are gated by JwtAuthGuard. There are no mutations in
// slice 2.1, so CSRF is not needed; accept-bid / withdraw-bid will
// add that protection when they ship.
//
// `seekerUserId` is sourced exclusively from the authenticated session
// via @CurrentUser. The path param `requestId` is the only client
// input; the service layer verifies ownership before returning bids,
// so a foreign requestId always yields 404 and never leaks the
// existence of any bids that may exist on it.
@UseGuards(JwtAuthGuard)
@Controller({ path: 'me/requests/:requestId/bids', version: '1' })
export class BidsController {
  constructor(private readonly bids: BidsService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('requestId') requestId: string,
    @Query() query: ListBidsQueryDto,
  ): Promise<BidListResponse> {
    return this.bids.listForRequest(user.id, requestId, query);
  }

  @Get(':bidId')
  @HttpCode(HttpStatus.OK)
  detail(
    @CurrentUser() user: AuthenticatedUser,
    @Param('requestId') requestId: string,
    @Param('bidId') bidId: string,
  ): Promise<BidSummary> {
    return this.bids.detail(user.id, requestId, bidId);
  }
}
